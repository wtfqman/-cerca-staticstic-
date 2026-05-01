import fs from 'node:fs';
import path from 'node:path';

import { DOCX_DOCUMENT_TEMPLATE_ROOT } from './docx-template.resolver';

export const GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND = 'google-docs-exported-docx';
export const APPROVED_DOCX_EXAMPLE_SOURCE_KIND = 'approved-docx-example';
export const CURRENT_DOCX_RENDER_PIPELINE_VERSION = 2;

const ALLOWED_DOCX_TEMPLATE_SOURCE_KINDS = new Set([
  GOOGLE_DOCS_EXPORTED_DOCX_SOURCE_KIND,
  APPROVED_DOCX_EXAMPLE_SOURCE_KIND
]);

export const isAllowedDocxTemplateSourceKind = (value: unknown): value is string =>
  typeof value === 'string' && ALLOWED_DOCX_TEMPLATE_SOURCE_KINDS.has(value);

export interface DocxTemplateManifestEntry {
  sourceKind: string;
  sourceLabel: string;
  sha256: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface DocxTemplateManifest {
  version: number;
  description: string;
  templates: Record<string, DocxTemplateManifestEntry>;
}

export const DOCX_TEMPLATE_MANIFEST_PATH = path.join(DOCX_DOCUMENT_TEMPLATE_ROOT, 'manifest.json');

export const normalizeDocxTemplateRelativePath = (relativePath: string) =>
  relativePath.replace(/\\/g, '/');

export const readDocxTemplateManifest = (): DocxTemplateManifest => {
  try {
    return JSON.parse(fs.readFileSync(DOCX_TEMPLATE_MANIFEST_PATH, 'utf8')) as DocxTemplateManifest;
  } catch (error) {
    throw new Error(`DOCX template manifest cannot be read: ${DOCX_TEMPLATE_MANIFEST_PATH}`);
  }
};

export const getDocxTemplateManifestEntry = (relativePath: string) =>
  readDocxTemplateManifest().templates[normalizeDocxTemplateRelativePath(relativePath)] ?? null;
