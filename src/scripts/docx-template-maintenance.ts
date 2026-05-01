import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import { google } from 'googleapis';

import {
  DOCX_DOCUMENT_TEMPLATE_ROOT,
  type ResolvedDocxDocumentTemplate,
  resolveDocxDocumentTemplate
} from '../documents/docx-template.resolver';
import {
  DOCX_TEMPLATE_MANIFEST_PATH,
  APPROVED_DOCX_EXAMPLE_SOURCE_KIND,
  GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND,
  isAllowedDocxTemplateSourceKind,
  normalizeDocxTemplateRelativePath,
  readDocxTemplateManifest,
  type DocxTemplateManifest,
  type DocxTemplateManifestEntry
} from '../documents/docx-template-manifest';
import { validateDocxDocumentTemplate } from '../documents/docx-template.validator';
import { DocumentType, LegalType } from '@prisma/client';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DEFAULT_SOURCES_FILE = path.join(DOCX_DOCUMENT_TEMPLATE_ROOT, 'sources.local.json');

type TemplateDefinition = {
  key: string;
  type: DocumentType;
  legalType: LegalType;
  sourceKind: string;
  envNames: string[];
};

const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: 'package.self-employed',
    type: DocumentType.CONTRACT,
    legalType: LegalType.SELF_EMPLOYED,
    sourceKind: GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND,
    envNames: ['DOC_TEMPLATE_PACKAGE_SELF_EMPLOYED']
  },
  {
    key: 'package.ip',
    type: DocumentType.CONTRACT,
    legalType: LegalType.IP,
    sourceKind: GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND,
    envNames: ['DOC_TEMPLATE_PACKAGE_IP']
  },
  {
    key: 'nda.self-employed',
    type: DocumentType.NDA,
    legalType: LegalType.SELF_EMPLOYED,
    sourceKind: APPROVED_DOCX_EXAMPLE_SOURCE_KIND,
    envNames: ['DOC_TEMPLATE_NDA_SELF_EMPLOYED', 'DOC_TEMPLATE_NDA_EXAMPLE']
  },
  {
    key: 'nda.ip',
    type: DocumentType.NDA,
    legalType: LegalType.IP,
    sourceKind: APPROVED_DOCX_EXAMPLE_SOURCE_KIND,
    envNames: ['DOC_TEMPLATE_NDA_IP', 'DOC_TEMPLATE_NDA_EXAMPLE']
  }
];

type SourceMap = Record<string, string>;

const sha256 = (buffer: Buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex');

const normalizePrivateKey = (value?: string) => value?.replace(/\\n/g, '\n');

const parseGoogleDocId = (value: string) => {
  const normalized = value.trim();
  const documentMatch = normalized.match(/\/document\/d\/([A-Za-z0-9_-]+)/);

  if (documentMatch) {
    return documentMatch[1];
  }

  if (/^[A-Za-z0-9_-]{20,}$/.test(normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported Google Docs source: ${value}`);
};

const readJsonIfExists = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const resolveTemplate = (definition: TemplateDefinition): ResolvedDocxDocumentTemplate =>
  resolveDocxDocumentTemplate({
    type: definition.type,
    legalType: definition.legalType
  });

const ensureDocxBufferLooksValid = (buffer: Buffer, label: string) => {
  let zip: AdmZip;

  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error(`${label} is not a readable DOCX archive`);
  }

  for (const entryPath of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!zip.getEntry(entryPath)) {
      throw new Error(`${label} is missing ${entryPath}`);
    }
  }

  const documentXml = zip.readAsText('word/document.xml');

  if (!/<w:body\b/.test(documentXml)) {
    throw new Error(`${label} does not contain word/document.xml body`);
  }
};

const buildAuthClient = async () => {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (credentialsPath) {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(process.cwd(), credentialsPath),
      scopes: [DRIVE_READONLY_SCOPE]
    });

    return auth.getClient();
  }

  if (serviceAccountEmail && privateKey) {
    const auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: [DRIVE_READONLY_SCOPE]
    });

    await auth.authorize();
    return auth;
  }

  return null;
};

const downloadGoogleDocAsDocx = async (documentId: string, authClient: Awaited<ReturnType<typeof buildAuthClient>>) => {
  if (authClient) {
    try {
      const drive = google.drive({
        version: 'v3',
        auth: authClient as never
      });
      const response = await drive.files.export(
        {
          fileId: documentId,
          mimeType: DOCX_MIME_TYPE
        },
        {
          responseType: 'arraybuffer'
        }
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      console.warn(
        `Google Drive API export failed for ${documentId}; trying public DOCX export. ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  const response = await fetch(`https://docs.google.com/document/d/${documentId}/export?format=docx`);

  if (!response.ok) {
    throw new Error(
      `Google Docs export failed for ${documentId}: ${response.status} ${response.statusText}. ` +
        'Share the document with the service account or make the document exportable.'
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

const readApprovedLocalDocx = async (source: string) => {
  const filePath = path.resolve(process.cwd(), source);
  const buffer = await fs.readFile(filePath);

  ensureDocxBufferLooksValid(buffer, filePath);

  return buffer;
};

const readSourceMap = async () => {
  const sourcesFile = path.resolve(process.cwd(), process.env.DOC_TEMPLATE_SOURCES_FILE ?? DEFAULT_SOURCES_FILE);
  const sourcesFromFile = (await readJsonIfExists<SourceMap>(sourcesFile)) ?? {};
  const sources: SourceMap = {};

  for (const definition of TEMPLATE_DEFINITIONS) {
    const template = resolveTemplate(definition);
    const normalizedRelativePath = normalizeDocxTemplateRelativePath(template.relativePath);
    const envValue = definition.envNames
      .map((envName) => process.env[envName])
      .find((value) => value?.trim());
    const value =
      envValue ??
      sourcesFromFile[definition.key] ??
      sourcesFromFile[normalizedRelativePath];

    if (value?.trim()) {
      sources[definition.key] = value.trim();
    }
  }

  return { sources, sourcesFile };
};

const buildManifestEntry = (
  buffer: Buffer,
  previousEntry: DocxTemplateManifestEntry | null,
  sourceInfo?: { sourceKind: string; sourceLabel: string }
): DocxTemplateManifestEntry => {
  const sourceKind = sourceInfo?.sourceKind ?? previousEntry?.sourceKind;

  if (!isAllowedDocxTemplateSourceKind(sourceKind)) {
    throw new Error(
      'DOCX template manifest can only register approved package/NDA sources. ' +
        'Run npm run templates:import-google-docs with DOC_TEMPLATE_PACKAGE_* and DOC_TEMPLATE_NDA_* sources first.'
    );
  }

  return {
    sourceKind,
    sourceLabel: sourceInfo?.sourceLabel ?? previousEntry?.sourceLabel ?? 'Approved DOCX template source',
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    updatedAt: new Date().toISOString()
  };
};

const refreshManifest = async (sourceInfoMap: Record<string, { sourceKind: string; sourceLabel: string }> = {}) => {
  const currentManifest = readDocxTemplateManifest();
  const nextManifest: DocxTemplateManifest = {
    version: currentManifest.version,
    description: currentManifest.description,
    templates: {}
  };

  for (const definition of TEMPLATE_DEFINITIONS) {
    const template = resolveTemplate(definition);
    const relativePath = normalizeDocxTemplateRelativePath(template.relativePath);
    const buffer = await fs.readFile(template.templatePath);

    ensureDocxBufferLooksValid(buffer, relativePath);

    nextManifest.templates[relativePath] = buildManifestEntry(
      buffer,
      currentManifest.templates[relativePath] ?? null,
      sourceInfoMap[relativePath]
    );
  }

  await fs.writeFile(DOCX_TEMPLATE_MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  console.log(`DOCX template manifest refreshed: ${DOCX_TEMPLATE_MANIFEST_PATH}`);
};

const importTemplateSources = async () => {
  const { sources, sourcesFile } = await readSourceMap();
  const sourceEntries = Object.entries(sources);

  if (sourceEntries.length === 0) {
    throw new Error(
      `No template sources configured. Set DOC_TEMPLATE_* env vars or create ${sourcesFile}.`
    );
  }

  const authClient = await buildAuthClient();
  const sourceInfoMap: Record<string, { sourceKind: string; sourceLabel: string }> = {};

  for (const [definitionKey, source] of sourceEntries) {
    const definition = TEMPLATE_DEFINITIONS.find((item) => item.key === definitionKey);

    if (!definition) {
      continue;
    }

    const template = resolveTemplate(definition);
    const relativePath = normalizeDocxTemplateRelativePath(template.relativePath);
    const buffer = definition.sourceKind === GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND
      ? await downloadGoogleDocAsDocx(parseGoogleDocId(source), authClient)
      : await readApprovedLocalDocx(source);
    const sourceLabel = definition.sourceKind === GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND
      ? `Google Docs export (${definition.key})`
      : `Approved DOCX example (${definition.key})`;

    ensureDocxBufferLooksValid(buffer, sourceLabel);
    await fs.mkdir(path.dirname(template.templatePath), { recursive: true });
    await fs.writeFile(template.templatePath, buffer);
    sourceInfoMap[relativePath] = {
      sourceKind: definition.sourceKind,
      sourceLabel
    };
    console.log(`Imported ${definition.key} -> ${relativePath}`);
  }

  await refreshManifest(sourceInfoMap);
};

const validateTemplates = async () => {
  for (const definition of TEMPLATE_DEFINITIONS) {
    const template = resolveTemplate(definition);
    const validated = validateDocxDocumentTemplate(template);

    console.log(
      `${normalizeDocxTemplateRelativePath(template.relativePath)} OK ${validated.sha256.slice(0, 12)}`
    );
  }
};

const main = async () => {
  dotenv.config();

  const command = process.argv[2] ?? 'validate';

  if (command === 'import-google-docs') {
    await importTemplateSources();
    return;
  }

  if (command === 'refresh-manifest') {
    await refreshManifest();
    return;
  }

  if (command === 'validate') {
    await validateTemplates();
    return;
  }

  throw new Error(
    `Unknown command: ${command}. Use import-google-docs, refresh-manifest, or validate.`
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
