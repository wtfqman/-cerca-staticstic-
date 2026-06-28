import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import {
  DocumentStatus,
  DocumentType,
  PrismaClient,
  type LegalType,
  type SocialPlatform,
  type User
} from '@prisma/client';
import pdfParse from 'pdf-parse';

import { getDocumentScopeKey } from '../documents/document.constants';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1R7vLWqz2B99YDnI5hvYu8Yts_27byhObC5rvBJbmAIM/export?format=csv';
const DEFAULT_LINKS_FILE = path.resolve(
  process.cwd(),
  'storage',
  'imports',
  'signed-contract-links-2026-06-27.txt'
);
const CLOUD_FOLDER_API_URL = 'https://cloud.mail.ru/api/v2/folder';
const CLOUD_DISPATCHER_API_URL = 'https://cloud.mail.ru/api/v2/dispatcher';
const IMPORT_SOURCE = 'signed_contract_pdf_import_2026_06';
const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? process.env.STORAGE_DIR ?? './storage');

type CliArgs = {
  apply: boolean;
  sheetUrl: string;
  linksFile?: string;
  links: string[];
  syncSheets: boolean;
  allowUnverifiedPdf: boolean;
  writePdfText: boolean;
  limit?: number;
};

type SheetCreatorRow = {
  fullName: string;
  nickname: string;
  contractStartDate: Date;
  contractStartDateKey: string;
  contractRequired: boolean;
  ndaRequired: boolean;
  thirdPartySigner?: string;
  checked?: string;
};

type CloudPdf = {
  sourceUrl: string;
  folderName: string;
  fileName: string;
  weblink: string;
  size: number;
  type: DocumentType;
};

type CreatorMatch = {
  user: CreatorUser;
  matchedBy: string;
};

type CreatorUser = User & {
  creatorProfile: {
    legalType: LegalType | null;
    fullName: string | null;
    contractStartDate: Date | null;
  } | null;
  socialAccounts: Array<{
    platform: SocialPlatform;
    handleOrUrl: string;
    isActive: boolean;
  }>;
};

type PlannedImport = {
  pdf: CloudPdf;
  sheetRow?: SheetCreatorRow;
  sheetMatchedBy?: string;
  pdfInspection?: PdfInspection;
  creatorMatch?: CreatorMatch;
  existingDocument?: {
    id: string;
    status: DocumentStatus;
    fileName: string;
    signedUploadedAt: Date | null;
  } | null;
  result: 'READY' | 'SKIPPED' | 'IMPORTED' | 'FAILED';
  details: string;
};

type PdfInspection = {
  status: 'OK' | 'WARNING' | 'ERROR';
  issues: string[];
  textLength: number;
  pageCount: number;
  expectedDateFound: boolean | null;
  expectedPersonFound: boolean | null;
  detectedDates: string[];
  detectedInns: string[];
  detectedPassportNumbers: string[];
  taxFlags: string[];
  text?: string;
};

const csvEscape = (value: unknown) => {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const sanitizeFileNamePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const sanitizeScopeDir = (value: string) => `scope_${sanitizeFileNamePart(value)}`;
const buildTimestamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const getDocumentBaseName = (type: DocumentType) => {
  switch (type) {
    case DocumentType.CONTRACT:
      return 'contract';
    case DocumentType.NDA:
      return 'nda';
    default:
      return type.toLowerCase();
  }
};

const saveSignedPdf = async (params: {
  creatorUserId: string;
  type: DocumentType;
  buffer: Buffer;
  scopeKey: string;
  uploadedAt: Date;
}) => {
  const fileName = `${getDocumentBaseName(params.type)}_signed_${buildTimestamp(params.uploadedAt)}.pdf`;
  const targetDir = path.join(
    STORAGE_ROOT,
    'signed',
    `creator_${params.creatorUserId}`,
    sanitizeScopeDir(params.scopeKey)
  );
  const filePath = path.join(targetDir, fileName);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(filePath, params.buffer);

  return {
    fileName,
    filePath
  };
};

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {
    apply: false,
    sheetUrl: DEFAULT_SHEET_URL,
    links: [],
    syncSheets: false,
    allowUnverifiedPdf: false,
    writePdfText: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];

    if (item === '--apply') {
      args.apply = true;
      continue;
    }

    if (item === '--sync-sheets') {
      args.syncSheets = true;
      continue;
    }

    if (item === '--allow-unverified-pdf') {
      args.allowUnverifiedPdf = true;
      continue;
    }

    if (item === '--write-pdf-text') {
      args.writePdfText = true;
      continue;
    }

    if (item === '--sheet-url' && next) {
      args.sheetUrl = normalizeSheetUrl(next);
      index += 1;
      continue;
    }

    if (item.startsWith('--sheet-url=')) {
      args.sheetUrl = normalizeSheetUrl(item.slice('--sheet-url='.length));
      continue;
    }

    if (item === '--sheet-id' && next) {
      args.sheetUrl = normalizeSheetUrl(next);
      index += 1;
      continue;
    }

    if (item.startsWith('--sheet-id=')) {
      args.sheetUrl = normalizeSheetUrl(item.slice('--sheet-id='.length));
      continue;
    }

    if (item === '--links-file' && next) {
      args.linksFile = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (item.startsWith('--links-file=')) {
      args.linksFile = path.resolve(process.cwd(), item.slice('--links-file='.length));
      continue;
    }

    if (item === '--link' && next) {
      args.links.push(next);
      index += 1;
      continue;
    }

    if (item.startsWith('--link=')) {
      args.links.push(item.slice('--link='.length));
      continue;
    }

    if (item === '--limit' && next) {
      args.limit = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (item.startsWith('--limit=')) {
      args.limit = Number.parseInt(item.slice('--limit='.length), 10);
      continue;
    }

    throw new Error(`Unknown argument: ${item}`);
  }

  return args;
};

const normalizeSheetUrl = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = match?.[1] ?? (/^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null);

  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` : trimmed;
};

const normalizeComparable = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9a-zа-я@._/-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeName = (value: string) =>
  normalizeComparable(value)
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUsername = (value: string) => {
  const trimmed = value.trim();
  const instagramMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  const telegramMatch = trimmed.match(/t\.me\/([^/?#]+)/i);
  const raw = instagramMatch?.[1] ?? telegramMatch?.[1] ?? trimmed.replace(/^@/, '');

  return raw
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim();
};

const unique = <T>(items: T[]) => Array.from(new Set(items));

const RUSSIAN_MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
] as const;

const formatDateVariants = (dateKey: string) => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return [];
  }

  const [, year, month, day] = match;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const monthName = RUSSIAN_MONTHS_GENITIVE[monthNumber - 1];

  return unique([
    `${day}.${month}.${year}`,
    `${dayNumber}.${monthNumber}.${year}`,
    `${dayNumber}.${month}.${year}`,
    `${day}.${monthNumber}.${year}`,
    monthName ? `${dayNumber} ${monthName} ${year}` : '',
    monthName ? `${day} ${monthName} ${year}` : '',
    monthName ? `${dayNumber} ${monthName}` : '',
    monthName ? `${day} ${monthName}` : ''
  ].filter(Boolean));
};

const normalizePdfText = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePdfTextForName = (value: string) =>
  normalizePdfText(value)
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findExpectedDate = (text: string, expectedDateKey?: string) => {
  if (!expectedDateKey) {
    return null;
  }

  const normalizedText = normalizePdfText(text);

  return formatDateVariants(expectedDateKey).some((variant) =>
    normalizedText.includes(normalizePdfText(variant))
  );
};

const findExpectedPerson = (text: string, candidates: string[]) => {
  const normalizedText = normalizePdfTextForName(text);
  const normalizedCandidates = unique(
    candidates
      .map(normalizeName)
      .filter((candidate) => candidate.length >= 5)
  );

  if (normalizedCandidates.length === 0) {
    return null;
  }

  return normalizedCandidates.some((candidate) => normalizedText.includes(candidate));
};

const detectDates = (text: string) => {
  const normalizedText = normalizePdfText(text);
  const numericDates = Array.from(normalizedText.matchAll(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g))
    .map((match) => match[0]);
  const longDatePattern = new RegExp(
    `\\b\\d{1,2}\\s+(?:${RUSSIAN_MONTHS_GENITIVE.join('|')})\\s+\\d{4}\\b`,
    'g'
  );
  const longDates = Array.from(normalizedText.matchAll(longDatePattern)).map((match) => match[0]);

  return unique([...numericDates, ...longDates]).slice(0, 30);
};

const detectInns = (text: string) =>
  unique(Array.from(text.matchAll(/(?<!\d)(?:\d[\s-]?){10,12}(?!\d)/g))
    .map((match) => match[0].replace(/\D/g, ''))
    .filter((digits) => digits.length === 10 || digits.length === 12))
    .slice(0, 20);

const detectPassportNumbers = (text: string) =>
  unique(Array.from(text.matchAll(/(?<!\d)(\d{2}\s?\d{2})\s*(?:N|№|No\.?)?\s*(\d{6})(?!\d)/gi))
    .map((match) => `${match[1].replace(/\D/g, '')} ${match[2]}`))
    .slice(0, 20);

const detectTaxFlags = (text: string) => {
  const normalizedText = normalizePdfText(text);
  const flags: string[] = [];

  if (/самозанят|профессиональн\w*\s+доход|нпд/.test(normalizedText)) {
    flags.push('SELF_EMPLOYED_OR_NPD');
  }

  if (/\bусн\b|упрощенн\w+\s+систем\w+/.test(normalizedText)) {
    flags.push('USN');
  }

  if (/\bндс\b/.test(normalizedText)) {
    flags.push('NDS');
  }

  if (/индивидуальн\w+\s+предпринимател/.test(normalizedText)) {
    flags.push('IP');
  }

  return flags;
};

const inspectPdf = async (
  buffer: Buffer,
  input: {
    pdf: CloudPdf;
    sheetRow?: SheetCreatorRow;
    sheetMatchedBy?: string;
    writePdfText: boolean;
  }
): Promise<PdfInspection> => {
  const issues: string[] = [];

  try {
    const parsed = await pdfParse(buffer);
    const text = parsed.text ?? '';
    const textLength = normalizePdfText(text).length;
    const expectedDateFound = findExpectedDate(text, input.sheetRow?.contractStartDateKey);
    const personCandidates = [
      input.sheetRow?.fullName,
      input.sheetRow?.thirdPartySigner,
      input.pdf.folderName,
      ...extractCreatorNameCandidatesFromPdf(input.pdf)
    ].filter((value): value is string => Boolean(value?.trim()));
    const expectedPersonFound = findExpectedPerson(text, personCandidates);

    if (textLength < 100) {
      issues.push('PDF text is empty or unreadable; manual/OCR check is required.');
    }

    if (expectedDateFound === false) {
      issues.push(`Expected contract date ${input.sheetRow?.contractStartDateKey} was not found in PDF text.`);
    }

    if (expectedPersonFound === false) {
      issues.push('Expected creator/signer name was not found in PDF text.');
    }

    const hasBlockingIssue = textLength < 100 || expectedDateFound === false;

    return {
      status: hasBlockingIssue ? 'ERROR' : issues.length > 0 ? 'WARNING' : 'OK',
      issues,
      textLength,
      pageCount: parsed.numpages ?? 0,
      expectedDateFound,
      expectedPersonFound,
      detectedDates: detectDates(text),
      detectedInns: detectInns(text),
      detectedPassportNumbers: detectPassportNumbers(text),
      taxFlags: detectTaxFlags(text),
      text: input.writePdfText ? text : undefined
    };
  } catch (error) {
    return {
      status: 'ERROR',
      issues: [error instanceof Error ? error.message : String(error)],
      textLength: 0,
      pageCount: 0,
      expectedDateFound: input.sheetRow ? false : null,
      expectedPersonFound: input.sheetRow ? false : null,
      detectedDates: [],
      detectedInns: [],
      detectedPassportNumbers: [],
      taxFlags: []
    };
  }
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const fetchText = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return buffer.toString('utf8').replace(/^\uFEFF/, '');
};

const isYes = (value: string | undefined) => normalizeComparable(value ?? '') === 'да';

const parseContractStartDate = (value: string): { date: Date; key: string } | null => {
  const normalized = value.trim();
  const russianDate = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (russianDate) {
    const [, day, month, year] = russianDate;
    const key = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    return {
      date: toDateOnly(key),
      key
    };
  }

  const isoDate = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (isoDate) {
    const [, year, month, day] = isoDate;
    const key = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    return {
      date: toDateOnly(key),
      key
    };
  }

  const month = normalizeComparable(value);
  const monthMap: Record<string, string> = {
    март: '2026-03',
    марта: '2026-03',
    апрель: '2026-04',
    апреля: '2026-04',
    май: '2026-05',
    мая: '2026-05',
    июнь: '2026-06',
    июня: '2026-06'
  };
  const monthKey = monthMap[month];

  if (!monthKey) {
    return null;
  }

  const key = `${monthKey}-01`;

  return {
    date: toDateOnly(key),
    key
  };
};

const loadSheetRows = async (sheetUrl: string) => {
  const csv = await fetchText(sheetUrl);
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim().length > 0));
  const [headers = [], ...dataRows] = rows;
  const headerIndex = new Map(headers.map((header, index) => [normalizeComparable(header), index]));

  const column = (...names: string[]) => {
    for (const name of names) {
      const index = headerIndex.get(normalizeComparable(name));

      if (index !== undefined) {
        return index;
      }
    }

    return -1;
  };

  const fullNameColumn = column('ФИО Креатор', 'ФИО Креатор ');
  const nicknameColumn = column('Ник');
  const monthColumn = column('Месяц начала договора');
  const contractColumn = column('Договор');
  const ndaColumn = column('Договор NDA');
  const thirdPartyColumn = column('Договор на др.человека');
  const checkedColumn = column('ПРОВЕРЕНО');

  if (fullNameColumn < 0 || monthColumn < 0) {
    throw new Error('Sheet must contain creator full name and contract month columns.');
  }

  const result: SheetCreatorRow[] = [];

  for (const row of dataRows) {
    const fullName = row[fullNameColumn]?.trim() ?? '';
    const parsedDate = parseContractStartDate(row[monthColumn]?.trim() ?? '');

    if (!fullName || !parsedDate) {
      continue;
    }

    result.push({
      fullName,
      nickname: nicknameColumn >= 0 ? row[nicknameColumn]?.trim() ?? '' : '',
      contractStartDate: parsedDate.date,
      contractStartDateKey: parsedDate.key,
      contractRequired: contractColumn >= 0 ? isYes(row[contractColumn]) : false,
      ndaRequired: ndaColumn >= 0 ? isYes(row[ndaColumn]) : false,
      thirdPartySigner: thirdPartyColumn >= 0 ? row[thirdPartyColumn]?.trim() || undefined : undefined,
      checked: checkedColumn >= 0 ? row[checkedColumn]?.trim() || undefined : undefined
    });
  }

  return result;
};

const readLinks = async (args: CliArgs) => {
  const links = [...args.links];
  const linksFile = args.linksFile ?? DEFAULT_LINKS_FILE;

  try {
    const fileText = await fs.readFile(linksFile, 'utf8');
    links.push(
      ...fileText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    );
  } catch (error) {
    if (args.links.length > 0 || args.linksFile) {
      throw error;
    }
  }

  return Array.from(new Set(links)).slice(0, args.limit);
};

const parseCloudWeblink = (url: string) => {
  const match = url.match(/cloud\.mail\.ru\/public\/([^/?#]+)\/([^/?#]+)(?:\/([^?#]+))?/i);

  if (!match) {
    throw new Error(`Unsupported cloud.mail.ru public URL: ${url}`);
  }

  const [, first, second, rest] = match;

  return [first, second, rest].filter(Boolean).map((part) => decodeURIComponent(part)).join('/');
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
};

type CloudFolderResponse = {
  body: {
    name?: string;
    type?: string;
    kind?: string;
    weblink?: string;
    size?: number;
    list?: Array<{
      name: string;
      weblink: string;
      size: number;
      type: string;
      kind: string;
    }>;
  };
};

type CloudDispatcherResponse = {
  body: {
    weblink_get?: Array<{
      url: string;
    }>;
  };
};

const classifyDocumentType = (fileName: string) => {
  const normalized = normalizeComparable(fileName);

  if (!normalized.endsWith('.pdf')) {
    return null;
  }

  if (/\bnda\b/i.test(fileName)) {
    return DocumentType.NDA;
  }

  if (normalized.includes('договор')) {
    return DocumentType.CONTRACT;
  }

  return null;
};

const loadCloudPdfs = async (links: string[]): Promise<CloudPdf[]> => {
  const pdfs: CloudPdf[] = [];

  for (const sourceUrl of links) {
    const weblink = parseCloudWeblink(sourceUrl);
    const metadata = await fetchJson<CloudFolderResponse>(
      `${CLOUD_FOLDER_API_URL}?weblink=${encodeURIComponent(weblink)}`
    );
    const folderName = metadata.body.name?.trim() || weblink.split('/').at(-1) || weblink;
    const files = metadata.body.type === 'file'
      ? [{
          name: metadata.body.name ?? folderName,
          weblink: metadata.body.weblink ?? weblink,
          size: metadata.body.size ?? 0,
          type: 'file',
          kind: 'file'
        }]
      : metadata.body.list ?? [];

    for (const file of files) {
      if (file.type !== 'file' && file.kind !== 'file') {
        continue;
      }

      const type = classifyDocumentType(file.name);

      if (!type) {
        continue;
      }

      pdfs.push({
        sourceUrl,
        folderName,
        fileName: file.name,
        weblink: file.weblink,
        size: file.size,
        type
      });
    }
  }

  return pdfs;
};

const getCloudDownloadBase = async () => {
  const dispatcher = await fetchJson<CloudDispatcherResponse>(CLOUD_DISPATCHER_API_URL);
  const url = dispatcher.body.weblink_get?.[0]?.url;

  if (!url) {
    throw new Error('cloud.mail.ru dispatcher did not return a weblink_get URL.');
  }

  return url.replace(/\/$/, '');
};

const downloadCloudPdf = async (baseUrl: string, pdf: CloudPdf) => {
  const response = await fetch(`${baseUrl}/${encodeURI(pdf.weblink)}`);

  if (!response.ok) {
    throw new Error(`Download failed for ${pdf.fileName}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length !== pdf.size) {
    throw new Error(`Downloaded size mismatch for ${pdf.fileName}: ${buffer.length} !== ${pdf.size}`);
  }

  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`Downloaded file is not a PDF: ${pdf.fileName}`);
  }

  return buffer;
};

const extractCreatorNameFromPdf = (pdf: CloudPdf) => {
  const fileNameWithoutExtension = pdf.fileName.replace(/\.pdf$/i, '');
  const fromFileName = fileNameWithoutExtension
    .replace(/\s+договор\s+nda$/i, '')
    .replace(/\s+договор$/i, '')
    .trim();

  return pdf.folderName.trim() || fromFileName;
};

const extractCreatorNameCandidatesFromPdf = (pdf: CloudPdf) => {
  const fileNameWithoutExtension = pdf.fileName.replace(/\.pdf$/i, '');
  const fromFileName = fileNameWithoutExtension
    .replace(/\s+договор\s+nda(?:\s+\(\d+\))?$/i, '')
    .replace(/\s+договор(?:\s+\(\d+\))?$/i, '')
    .trim();
  const folderName = pdf.folderName.trim();
  const folderWithoutHint = folderName.replace(/\s*\(.+\)\s*$/, '').trim();

  return Array.from(new Set([folderName, fromFileName, folderWithoutHint].filter(Boolean)));
};

const addToMultiMap = <T>(map: Map<string, T[]>, key: string, value: T) => {
  if (!key) {
    return;
  }

  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
};

const pickUnique = <T>(map: Map<string, T[]>, key: string) => {
  const values = map.get(key) ?? [];

  return values.length === 1 ? values[0] : null;
};

const loadCreatorLookup = async () => {
  const users = await prisma.user.findMany({
    include: {
      creatorProfile: {
        select: {
          legalType: true,
          fullName: true,
          contractStartDate: true
        }
      },
      socialAccounts: {
        select: {
          platform: true,
          handleOrUrl: true,
          isActive: true
        }
      }
    }
  }) as CreatorUser[];
  const byName = new Map<string, CreatorUser[]>();
  const byUsername = new Map<string, CreatorUser[]>();
  const bySocial = new Map<string, CreatorUser[]>();

  for (const user of users.filter((item) => item.creatorProfile)) {
    addToMultiMap(byName, normalizeName(user.creatorProfile?.fullName ?? ''), user);
    addToMultiMap(byUsername, normalizeUsername(user.username ?? ''), user);

    for (const account of user.socialAccounts.filter((item) => item.isActive)) {
      addToMultiMap(bySocial, normalizeUsername(account.handleOrUrl), user);
    }
  }

  return {
    byName,
    byUsername,
    bySocial
  };
};

const findCreator = (
  row: SheetCreatorRow,
  lookup: Awaited<ReturnType<typeof loadCreatorLookup>>
): CreatorMatch | null => {
  const byName = pickUnique(lookup.byName, normalizeName(row.fullName));

  if (byName) {
    return { user: byName, matchedBy: 'profile.fullName' };
  }

  const username = normalizeUsername(row.nickname);
  const byUsername = pickUnique(lookup.byUsername, username);

  if (byUsername) {
    return { user: byUsername, matchedBy: 'telegram username' };
  }

  const bySocial = pickUnique(lookup.bySocial, username);

  if (bySocial) {
    return { user: bySocial, matchedBy: 'social account' };
  }

  return null;
};

const buildImportPlan = async (
  pdfs: CloudPdf[],
  sheetRows: SheetCreatorRow[],
  args: Pick<CliArgs, 'allowUnverifiedPdf' | 'writePdfText'>
): Promise<PlannedImport[]> => {
  const sheetByName = new Map(sheetRows.map((row) => [normalizeName(row.fullName), row]));
  const sheetByThirdPartyName = new Map<string, SheetCreatorRow[]>();
  const creatorLookup = await loadCreatorLookup();
  const downloadBase = await getCloudDownloadBase();
  const plans: PlannedImport[] = [];

  for (const row of sheetRows) {
    addToMultiMap(sheetByThirdPartyName, normalizeName(row.thirdPartySigner ?? ''), row);
  }

  const findSheetRowForPdf = (pdf: CloudPdf) => {
    const candidates = extractCreatorNameCandidatesFromPdf(pdf);

    for (const candidate of candidates) {
      const row = sheetByName.get(normalizeName(candidate));

      if (row) {
        return { row, matchedBy: `creator name: ${candidate}` };
      }
    }

    for (const candidate of candidates) {
      const row = pickUnique(sheetByThirdPartyName, normalizeName(candidate));

      if (row) {
        return { row, matchedBy: `third-party signer: ${candidate}` };
      }
    }

    return null;
  };

  for (const pdf of pdfs) {
    const sourceName = extractCreatorNameFromPdf(pdf);
    const sheetMatch = findSheetRowForPdf(pdf);
    const sheetRow = sheetMatch?.row;
    let pdfInspection: PdfInspection | undefined;

    try {
      const buffer = await downloadCloudPdf(downloadBase, pdf);
      pdfInspection = await inspectPdf(buffer, {
        pdf,
        sheetRow,
        sheetMatchedBy: sheetMatch?.matchedBy,
        writePdfText: args.writePdfText
      });
    } catch (error) {
      pdfInspection = {
        status: 'ERROR',
        issues: [error instanceof Error ? error.message : String(error)],
        textLength: 0,
        pageCount: 0,
        expectedDateFound: sheetRow ? false : null,
        expectedPersonFound: sheetRow ? false : null,
        detectedDates: [],
        detectedInns: [],
        detectedPassportNumbers: [],
        taxFlags: []
      };
    }

    const creatorMatch = sheetRow ? findCreator(sheetRow, creatorLookup) ?? undefined : undefined;
    const scopeKey = getDocumentScopeKey(pdf.type);
    const existingDocument = creatorMatch
      ? await prisma.document.findUnique({
          where: {
            creatorUserId_type_scopeKey: {
              creatorUserId: creatorMatch.user.id,
              type: pdf.type,
              scopeKey
            }
          },
          select: {
            id: true,
            status: true,
            fileName: true,
            signedUploadedAt: true
          }
        })
      : null;
    const requiredBySheet = pdf.type === DocumentType.CONTRACT
      ? sheetRow?.contractRequired
      : sheetRow?.ndaRequired;

    if (!sheetRow) {
      plans.push({
        pdf,
        pdfInspection,
        result: 'SKIPPED',
        details: `No sheet row matched source name "${sourceName}".`
      });
      continue;
    }

    if (!creatorMatch) {
      plans.push({
        pdf,
        sheetRow,
        sheetMatchedBy: sheetMatch?.matchedBy,
        pdfInspection,
        result: 'SKIPPED',
        details: `No database creator matched "${sheetRow.fullName}" / "${sheetRow.nickname}".`
      });
      continue;
    }

    if (!creatorMatch.user.creatorProfile?.legalType) {
      plans.push({
        pdf,
        sheetRow,
        sheetMatchedBy: sheetMatch?.matchedBy,
        pdfInspection,
        creatorMatch,
        existingDocument,
        result: 'SKIPPED',
        details: 'Creator profile has no legalType.'
      });
      continue;
    }

    if (pdfInspection.status === 'ERROR' && !args.allowUnverifiedPdf) {
      plans.push({
        pdf,
        sheetRow,
        sheetMatchedBy: sheetMatch?.matchedBy,
        pdfInspection,
        creatorMatch,
        existingDocument,
        result: 'SKIPPED',
        details: `PDF verification failed: ${pdfInspection.issues.join('; ')}`
      });
      continue;
    }

    plans.push({
      pdf,
      sheetRow,
      sheetMatchedBy: sheetMatch?.matchedBy,
      pdfInspection,
      creatorMatch,
      existingDocument,
      result: 'READY',
      details: requiredBySheet === false
        ? 'Ready, but the source sheet does not mark this document type as required.'
        : 'Ready.'
    });
  }

  return plans;
};

const buildPayload = (plan: PlannedImport, importedAt: Date) => ({
  source: IMPORT_SOURCE,
  importedSignedPdf: {
    sourceUrl: plan.pdf.sourceUrl,
    cloudWeblink: plan.pdf.weblink,
    originalFileName: plan.pdf.fileName,
    size: plan.pdf.size,
    sheetFullName: plan.sheetRow?.fullName,
    sheetNickname: plan.sheetRow?.nickname,
    thirdPartySigner: plan.sheetRow?.thirdPartySigner,
    importedAt: importedAt.toISOString()
  },
  contractDate: plan.sheetRow?.contractStartDateKey,
  documentDate: plan.sheetRow?.contractStartDateKey,
  generatedDate: plan.sheetRow?.contractStartDateKey
});

const applyImportPlan = async (plans: PlannedImport[]) => {
  const downloadBase = await getCloudDownloadBase();
  const importedAt = new Date();
  const importedDocumentIds: string[] = [];

  for (const plan of plans) {
    if (plan.result !== 'READY' || !plan.sheetRow || !plan.creatorMatch) {
      continue;
    }

    try {
      const buffer = await downloadCloudPdf(downloadBase, plan.pdf);
      const scopeKey = getDocumentScopeKey(plan.pdf.type);
      const creatorUserId = plan.creatorMatch.user.id;
      const stored = await saveSignedPdf({
        creatorUserId,
        type: plan.pdf.type,
        buffer,
        scopeKey,
        uploadedAt: importedAt
      });
      const payloadJson = JSON.parse(JSON.stringify(buildPayload(plan, importedAt)));
      const legalType = plan.creatorMatch.user.creatorProfile!.legalType!;

      const document = await prisma.$transaction(async (tx) => {
        await tx.creatorProfile.update({
          where: {
            userId: creatorUserId
          },
          data: {
            contractStartDate: plan.sheetRow!.contractStartDate
          }
        });

        const existing = await tx.document.findUnique({
          where: {
            creatorUserId_type_scopeKey: {
              creatorUserId,
              type: plan.pdf.type,
              scopeKey
            }
          }
        });
        const nextStatus = existing?.status === DocumentStatus.FORWARDED_TO_CHAT
          ? DocumentStatus.FORWARDED_TO_CHAT
          : DocumentStatus.SIGNED_UPLOADED;
        const documentRecord = await tx.document.upsert({
          where: {
            creatorUserId_type_scopeKey: {
              creatorUserId,
              type: plan.pdf.type,
              scopeKey
            }
          },
          create: {
            creatorUserId,
            type: plan.pdf.type,
            legalType,
            scopeKey,
            status: nextStatus,
            filePath: stored.filePath,
            fileName: plan.pdf.fileName,
            payloadJson,
            generatedAt: importedAt,
            signedUploadedAt: importedAt
          },
          update: {
            legalType,
            monthKey: null,
            periodStart: null,
            periodEnd: null,
            status: nextStatus,
            filePath: stored.filePath,
            fileName: plan.pdf.fileName,
            payloadJson,
            signedUploadedAt: existing?.signedUploadedAt ?? importedAt
          }
        });
        const existingUpload = await tx.documentSignatureUpload.findFirst({
          where: {
            documentId: documentRecord.id,
            originalFileName: plan.pdf.fileName
          }
        });

        if (!existingUpload) {
          await tx.documentSignatureUpload.create({
            data: {
              documentId: documentRecord.id,
              creatorUserId,
              originalFileName: plan.pdf.fileName,
              mimeType: 'application/pdf',
              filePath: stored.filePath,
              uploadedAt: importedAt
            }
          });
        }

        return documentRecord;
      });

      importedDocumentIds.push(document.id);
      plan.existingDocument = {
        id: document.id,
        status: document.status,
        fileName: document.fileName,
        signedUploadedAt: document.signedUploadedAt
      };
      plan.result = 'IMPORTED';
      plan.details = `Imported to ${stored.filePath}`;
    } catch (error) {
      plan.result = 'FAILED';
      plan.details = error instanceof Error ? error.message : String(error);
    }
  }

  return importedDocumentIds;
};

const writeReport = async (plans: PlannedImport[], args: CliArgs) => {
  const reportDir = path.resolve(process.cwd(), 'storage', 'imports');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const reportPath = path.join(reportDir, `signed-contract-import-report-${timestamp}.csv`);
  const headers = [
    'result',
    'details',
    'documentType',
    'cloudFolder',
    'fileName',
    'size',
    'pdfInspectionStatus',
    'pdfInspectionIssues',
    'pdfTextLength',
    'pdfPageCount',
    'pdfExpectedDateFound',
    'pdfExpectedPersonFound',
    'pdfDetectedDates',
    'pdfDetectedInns',
    'pdfDetectedPassportNumbers',
    'pdfTaxFlags',
    'sheetFullName',
    'sheetMatchedBy',
    'sheetNickname',
    'contractStartDate',
    'creatorUserId',
    'creatorDbName',
    'matchedBy',
    'existingDocumentId',
    'existingStatus',
    'sourceUrl'
  ];
  const rows = plans.map((plan) => [
    plan.result,
    plan.details,
    plan.pdf.type,
    plan.pdf.folderName,
    plan.pdf.fileName,
    plan.pdf.size,
    plan.pdfInspection?.status,
    plan.pdfInspection?.issues.join('; '),
    plan.pdfInspection?.textLength,
    plan.pdfInspection?.pageCount,
    plan.pdfInspection?.expectedDateFound,
    plan.pdfInspection?.expectedPersonFound,
    plan.pdfInspection?.detectedDates.join(' | '),
    plan.pdfInspection?.detectedInns.join(' | '),
    plan.pdfInspection?.detectedPassportNumbers.join(' | '),
    plan.pdfInspection?.taxFlags.join(' | '),
    plan.sheetRow?.fullName,
    plan.sheetMatchedBy,
    plan.sheetRow?.nickname,
    plan.sheetRow?.contractStartDateKey,
    plan.creatorMatch?.user.id,
    plan.creatorMatch?.user.creatorProfile?.fullName,
    plan.creatorMatch?.matchedBy,
    plan.existingDocument?.id,
    plan.existingDocument?.status,
    plan.pdf.sourceUrl
  ]);

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(
    reportPath,
    [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n'),
    'utf8'
  );

  let textReportPath: string | null = null;

  if (args.writePdfText) {
    textReportPath = path.join(reportDir, `signed-contract-import-pdf-text-${timestamp}.json`);
    await fs.writeFile(
      textReportPath,
      JSON.stringify(
        plans.map((plan) => ({
          result: plan.result,
          documentType: plan.pdf.type,
          cloudFolder: plan.pdf.folderName,
          fileName: plan.pdf.fileName,
          sheetFullName: plan.sheetRow?.fullName,
          sheetMatchedBy: plan.sheetMatchedBy,
          sheetNickname: plan.sheetRow?.nickname,
          contractStartDate: plan.sheetRow?.contractStartDateKey,
          inspection: plan.pdfInspection
        })),
        null,
        2
      ),
      'utf8'
    );
  }

  const ready = plans.filter((plan) => plan.result === 'READY').length;
  const imported = plans.filter((plan) => plan.result === 'IMPORTED').length;
  const skipped = plans.filter((plan) => plan.result === 'SKIPPED').length;
  const failed = plans.filter((plan) => plan.result === 'FAILED').length;
  const pdfOk = plans.filter((plan) => plan.pdfInspection?.status === 'OK').length;
  const pdfWarnings = plans.filter((plan) => plan.pdfInspection?.status === 'WARNING').length;
  const pdfErrors = plans.filter((plan) => plan.pdfInspection?.status === 'ERROR').length;

  console.log(
    [
      args.apply ? 'Signed contract import finished.' : 'Signed contract import dry run finished.',
      `PDFs found: ${plans.length}`,
      `PDF verification OK: ${pdfOk}`,
      `PDF verification warnings: ${pdfWarnings}`,
      `PDF verification errors: ${pdfErrors}`,
      `Ready: ${ready}`,
      `Imported: ${imported}`,
      `Skipped: ${skipped}`,
      `Failed: ${failed}`,
      `Report: ${reportPath}`,
      textReportPath ? `PDF text report: ${textReportPath}` : null
    ]
      .filter(Boolean)
      .join('\n')
  );

  return reportPath;
};

const syncImportedDocuments = async (documentIds: string[]) => {
  if (documentIds.length === 0) {
    return;
  }

  const { container } = await import('../container');

  await container.services.googleSheetsSyncService.safeSyncDocuments(documentIds);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const links = await readLinks(args);

  if (links.length === 0) {
    throw new Error(
      `No cloud.mail.ru links provided. Use --links-file <path> or create ${DEFAULT_LINKS_FILE}.`
    );
  }

  const [sheetRows, cloudPdfs] = await Promise.all([
    loadSheetRows(args.sheetUrl),
    loadCloudPdfs(links)
  ]);
  const plans = await buildImportPlan(cloudPdfs, sheetRows, args);
  const importedDocumentIds = args.apply ? await applyImportPlan(plans) : [];

  if (args.apply && args.syncSheets) {
    await syncImportedDocuments(importedDocumentIds);
  }

  await writeReport(plans, args);
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
