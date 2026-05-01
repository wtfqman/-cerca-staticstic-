import crypto from 'node:crypto';
import fs from 'node:fs';

import AdmZip from 'adm-zip';

import type { ResolvedDocxDocumentTemplate } from './docx-template.resolver';
import {
  isAllowedDocxTemplateSourceKind,
  getDocxTemplateManifestEntry
} from './docx-template-manifest';

const REQUIRED_DOCX_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml'
] as const;

const TEXT_NODE_RE = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;

export interface ValidatedDocxTemplate {
  buffer: Buffer;
  sha256: string;
  sizeBytes: number;
  sourceKind: string;
  sourceLabel: string;
  updatedAt: string;
}

const xmlDecode = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const textFromXml = (xml: string) =>
  [...xml.matchAll(TEXT_NODE_RE)]
    .map((match) => xmlDecode(match[0].replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '')))
    .join('');

const sha256 = (buffer: Buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex');

export const validateDocxDocumentTemplate = (
  template: ResolvedDocxDocumentTemplate
): ValidatedDocxTemplate => {
  if (!fs.existsSync(template.templatePath)) {
    throw new Error(`DOCX template not found: ${template.relativePath}`);
  }

  const manifestEntry = getDocxTemplateManifestEntry(template.relativePath);

  if (!manifestEntry) {
    throw new Error(
      `DOCX template is not registered in manifest: ${template.relativePath}. ` +
        'Run npm run templates:refresh-manifest after importing a normalized template.'
    );
  }

  if (!isAllowedDocxTemplateSourceKind(manifestEntry.sourceKind)) {
    throw new Error(
      `DOCX template source is not approved: ${template.relativePath}. ` +
        'Run npm run templates:import-google-docs with the approved package/NDA sources before generating documents.'
    );
  }

  const buffer = fs.readFileSync(template.templatePath);
  const actualSha256 = sha256(buffer);

  if (actualSha256 !== manifestEntry.sha256) {
    throw new Error(
      `DOCX template checksum mismatch: ${template.relativePath}. ` +
        'The file was changed outside the controlled import pipeline. ' +
        'Import the Google Docs version again or run npm run templates:refresh-manifest after manual verification.'
    );
  }

  if (buffer.byteLength !== manifestEntry.sizeBytes) {
    throw new Error(
      `DOCX template size mismatch: ${template.relativePath}. ` +
        'The file on disk does not match the registered normalized template.'
    );
  }

  let zip: AdmZip;

  try {
    zip = new AdmZip(buffer);
  } catch (error) {
    throw new Error(`DOCX template is not a readable DOCX archive: ${template.relativePath}`);
  }

  for (const entryPath of REQUIRED_DOCX_ENTRIES) {
    if (!zip.getEntry(entryPath)) {
      throw new Error(`DOCX template is missing ${entryPath}: ${template.relativePath}`);
    }
  }

  const documentXml = zip.readAsText('word/document.xml');

  if (!/<w:body\b/.test(documentXml)) {
    throw new Error(`DOCX template body was not found: ${template.relativePath}`);
  }

  if (template.section) {
    const documentText = textFromXml(documentXml);
    const markers = [
      template.section.startAfterMarker,
      ...(template.section.startAfterMarkers ?? []),
      template.section.startMarker,
      template.section.endAfterMarker,
      template.section.endMarkerOptional ? undefined : template.section.endMarker
    ].filter(Boolean);

    for (const marker of markers) {
      if (!documentText.includes(marker!)) {
        throw new Error(`DOCX template marker was not found in ${template.relativePath}: ${marker}`);
      }
    }
  }

  return {
    buffer,
    sha256: actualSha256,
    sizeBytes: buffer.byteLength,
    sourceKind: manifestEntry.sourceKind,
    sourceLabel: manifestEntry.sourceLabel,
    updatedAt: manifestEntry.updatedAt
  };
};
