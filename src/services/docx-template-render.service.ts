import AdmZip from 'adm-zip';
import { DocumentType, LegalType } from '@prisma/client';

import { resolveDocxDocumentTemplate } from '../documents/docx-template.resolver';
import {
  CURRENT_DOCX_RENDER_PIPELINE_VERSION,
  normalizeDocxTemplateRelativePath
} from '../documents/docx-template-manifest';
import { validateDocxDocumentTemplate } from '../documents/docx-template.validator';
import {
  type DocumentPersonGrammar,
  normalizeDocumentPersonGender,
  resolveDocumentPersonGrammar
} from '../documents/document-person-grammar';
import { getCurrentDocumentLayoutRevision } from '../documents/document-layout-revisions';
import { DocxPdfService } from './docx-pdf.service';

type ReplacementFields = {
  type: DocumentType;
  legalType: LegalType;
  fullName: string;
  personGrammar: DocumentPersonGrammar;
  signatureName: string;
  inn: string;
  ogrnip: string;
  phone: string;
  email: string;
  registrationAddress: string;
  passportSeries: string;
  passportNumber: string;
  passportSpaced: string;
  passportCompact: string;
  passportIssuedAt: string;
  passportIssuedBy: string;
  passportDepartmentCode: string;
  bankName: string;
  bankAccount: string;
  bankBik: string;
  bankCorrAccount: string;
  contractNumber: string;
  contractDate: string;
  documentDate: string;
  assignmentDate: string;
  actDate: string;
  rightsTransferDate: string;
  periodStartDate: string;
  periodEndDate: string;
  rawViewsFormatted: string;
  actualVideoCountFormatted: string;
  fixedSalaryText: string;
  variablePartText: string;
  totalPaymentText: string;
};

type TextReplacement = string | ((substring: string, ...args: string[]) => string);

interface ParagraphTextNode {
  start: number;
  end: number;
  openTag: string;
  text: string;
  closeTag: string;
  textStart: number;
  textEnd: number;
}

export interface RenderedDocxDocument {
  pdfBuffer: Buffer;
  docxBuffer: Buffer;
  payloadJson: Record<string, unknown>;
}

interface ParagraphLayoutOptions {
  alignment?: 'left' | 'center' | 'right' | 'both';
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  suppressBorders?: boolean;
  suppressIndentation?: boolean;
  suppressNumbering?: boolean;
  suppressStyle?: boolean;
  suppressTabs?: boolean;
  spacing?: {
    before?: number;
    after?: number;
    line?: number;
    lineRule?: 'auto' | 'exact';
  };
}

const WORD_DOCUMENT_XML = 'word/document.xml';
const PARAGRAPH_RE = /<w:p\b[\s\S]*?<\/w:p>/g;
const TEXT_NODE_RE = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
const BODY_RE = /(<w:body\b[^>]*>)([\s\S]*?)(<\/w:body>)/;
const PARAGRAPH_PROPERTIES_RE = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/;
const TABLE_ROW_RE = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const TABLE_ROW_PROPERTIES_RE = /<w:trPr\b[^>]*>[\s\S]*?<\/w:trPr>/;
const TEXT_RUN_RE = /(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/;
const GENERATED_PAGE_SIZE_XML = '<w:pgSz w:h="16840" w:w="11900" w:orient="portrait"/>';
const GENERATED_PAGE_MARGINS_XML =
  '<w:pgMar w:bottom="851" w:top="1134" w:left="1134" w:right="850" w:header="708" w:footer="708"/>';
const NDA_CONFIDENTIAL_INFORMATION_LIST_HEADING = 'Перечень';
const PAGE_BREAK_PARAGRAPH_XML = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const CUSTOMER_SIGNATURE_NAME = '/Григорян А.С./';
const SIGNATURE_LINE = '______________________';
const MONTHS_GENITIVE = [
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
];

const EMPTY_FIELD = 'не указано';

const xmlDecode = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const xmlEncode = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
};

const readPersonGrammar = (source: Record<string, unknown>, fullName: string) => {
  const rawGrammar = asRecord(source.personGrammar);

  return resolveDocumentPersonGrammar({
    fullName,
    gender: normalizeDocumentPersonGender(asString(source.personGender) || asString(rawGrammar.gender))
  });
};

const formatInteger = (value: number | null) =>
  value === null ? '' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);

const parseRuDate = (value: string) => {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { day, month, year };
};

const formatQuotedDate = (value: string) => {
  const parsed = parseRuDate(value);

  if (!parsed) {
    return value || EMPTY_FIELD;
  }

  return `«${String(parsed.day).padStart(2, '0')}» ${MONTHS_GENITIVE[parsed.month - 1]} ${parsed.year} г.`;
};

const formatLongDate = (value: string) => {
  const parsed = parseRuDate(value);

  if (!parsed) {
    return value || EMPTY_FIELD;
  }

  return `${String(parsed.day).padStart(2, '0')} ${MONTHS_GENITIVE[parsed.month - 1]} ${parsed.year} г.`;
};

const formatDayMonth = (value: string) => {
  const parsed = parseRuDate(value);

  if (!parsed) {
    return value || EMPTY_FIELD;
  }

  return `${String(parsed.day).padStart(2, '0')} ${MONTHS_GENITIVE[parsed.month - 1]}`;
};

const formatContractReference = (fields: Pick<ReplacementFields, 'contractNumber' | 'contractDate'>) =>
  `№ ${fields.contractNumber} от ${formatQuotedDate(fields.contractDate)}`;

const replaceStaleContractReferenceDates = (paragraph: string, fields: ReplacementFields) => {
  if (!fields.contractDate || !fields.documentDate || fields.contractDate === fields.documentDate) {
    return paragraph;
  }

  let result = paragraph;
  const contractReference = formatContractReference(fields);
  const staleQuotedDocumentReference = `№ ${fields.contractNumber} от ${formatQuotedDate(fields.documentDate)}`;
  const staleDottedDocumentReference = `№ ${fields.contractNumber} от ${fields.documentDate} г.`;
  const staleEmptyQuotedDocumentReference = `№ ${EMPTY_FIELD} от ${formatQuotedDate(fields.documentDate)}`;
  const staleEmptyDottedDocumentReference = `№ ${EMPTY_FIELD} от ${fields.documentDate} г.`;

  result = replaceTextInParagraph(result, staleQuotedDocumentReference, contractReference);
  result = replaceTextInParagraph(result, staleDottedDocumentReference, contractReference);
  result = replaceTextInParagraph(result, staleEmptyQuotedDocumentReference, contractReference);
  result = replaceTextInParagraph(result, staleEmptyDottedDocumentReference, contractReference);

  return result;
};

const formatPassportSpaced = (series: string, number: string) => {
  if (!series || !number) {
    return EMPTY_FIELD;
  }

  const normalizedSeries = series.replace(/\D/g, '');
  const formattedSeries =
    normalizedSeries.length === 4
      ? `${normalizedSeries.slice(0, 2)} ${normalizedSeries.slice(2)}`
      : series;

  return `${formattedSeries} № ${number}`;
};

const formatPassportCompact = (series: string, number: string) =>
  series && number ? `${series.replace(/\s+/g, '')} №${number}` : EMPTY_FIELD;

const buildSignatureName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '/___________________/';
  }

  const [lastName, firstName, middleName] = parts;
  const initials = [firstName, middleName]
    .filter(Boolean)
    .map((part) => `${part[0]?.toLocaleUpperCase('ru-RU')}.`)
    .join('');

  return `/${lastName}${initials ? ` ${initials}` : ''}/`;
};

const textFromXml = (xml: string) =>
  [...xml.matchAll(TEXT_NODE_RE)]
    .map((match) => xmlDecode(match[0].replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '')))
    .join('');

const withXmlSpacePreserve = (openTag: string) =>
  openTag.includes('xml:space=') ? openTag : openTag.replace('<w:t', '<w:t xml:space="preserve"');

const parseParagraphTextNodes = (paragraph: string): ParagraphTextNode[] => {
  const nodes: ParagraphTextNode[] = [];
  let textOffset = 0;

  for (const match of paragraph.matchAll(TEXT_NODE_RE)) {
    if (match.index === undefined) {
      continue;
    }

    const node = match[0];
    const nodeMatch = node.match(/^(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)$/);

    if (!nodeMatch) {
      continue;
    }

    const [, openTag, encodedText, closeTag] = nodeMatch;
    const text = xmlDecode(encodedText);

    nodes.push({
      start: match.index,
      end: match.index + node.length,
      openTag,
      text,
      closeTag,
      textStart: textOffset,
      textEnd: textOffset + text.length
    });

    textOffset += text.length;
  }

  return nodes;
};

const textFromParagraphNodes = (nodes: ParagraphTextNode[]) =>
  nodes.map((node) => node.text).join('');

const cloneRegexWithoutGlobal = (pattern: RegExp) =>
  new RegExp(pattern.source, pattern.flags.replace(/g/g, ''));

const expandRegexReplacement = (
  matchedText: string,
  pattern: RegExp,
  replacement: TextReplacement
) => matchedText.replace(cloneRegexWithoutGlobal(pattern), replacement as string);

const findReplacementMatch = (
  text: string,
  pattern: string | RegExp,
  replacement: TextReplacement
) => {
  if (typeof pattern === 'string') {
    const start = text.indexOf(pattern);

    if (start < 0) {
      return null;
    }

    return {
      start,
      end: start + pattern.length,
      value: typeof replacement === 'function' ? replacement(pattern) : replacement
    };
  }

  const match = cloneRegexWithoutGlobal(pattern).exec(text);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
    value: expandRegexReplacement(match[0], pattern, replacement)
  };
};

const replaceParagraphTextRange = (
  paragraph: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string
) => {
  const nodes = parseParagraphTextNodes(paragraph);
  const affectedNodes = nodes.filter((node) => node.textStart < rangeEnd && node.textEnd > rangeStart);

  if (affectedNodes.length === 0) {
    return paragraph;
  }

  const firstNode = affectedNodes[0];
  const lastNode = affectedNodes[affectedNodes.length - 1];
  const edits = affectedNodes.map((node) => {
    const localStart = Math.max(rangeStart - node.textStart, 0);
    const localEnd = Math.min(rangeEnd - node.textStart, node.text.length);
    let nextText = '';

    if (node === firstNode && node === lastNode) {
      nextText = `${node.text.slice(0, localStart)}${replacement}${node.text.slice(localEnd)}`;
    } else if (node === firstNode) {
      nextText = `${node.text.slice(0, localStart)}${replacement}`;
    } else if (node === lastNode) {
      nextText = node.text.slice(localEnd);
    }

    return {
      start: node.start,
      end: node.end,
      value: `${withXmlSpacePreserve(node.openTag)}${xmlEncode(nextText)}${node.closeTag}`
    };
  });

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) => `${current.slice(0, edit.start)}${edit.value}${current.slice(edit.end)}`,
      paragraph
    );
};

const replaceTextInParagraph = (
  paragraph: string,
  pattern: string | RegExp,
  replacement: TextReplacement
) => {
  const replaceAll = typeof pattern === 'string' || pattern.global;
  let result = paragraph;
  let guard = 0;

  while (guard < 100) {
    guard += 1;

    const nodes = parseParagraphTextNodes(result);
    const text = textFromParagraphNodes(nodes);
    const match = findReplacementMatch(text, pattern, replacement);

    if (!match) {
      break;
    }

    if (text.slice(match.start, match.end) === match.value) {
      break;
    }

    result = replaceParagraphTextRange(result, match.start, match.end, match.value);

    if (!replaceAll) {
      break;
    }
  }

  return result;
};

const findNextTag = (source: string, tagName: string, cursor: number) => {
  const pattern = new RegExp(`<w:${tagName}(?:\\s|>)`, 'g');
  pattern.lastIndex = cursor;
  const match = pattern.exec(source);

  return match?.index ?? -1;
};

const splitTopLevelBodyBlocks = (bodyInner: string) => {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < bodyInner.length) {
    const candidates = [
      { tag: 'p', start: findNextTag(bodyInner, 'p', cursor), endTag: '</w:p>' },
      { tag: 'tbl', start: findNextTag(bodyInner, 'tbl', cursor), endTag: '</w:tbl>' },
      { tag: 'sectPr', start: findNextTag(bodyInner, 'sectPr', cursor), endTag: '</w:sectPr>' }
    ].filter((candidate) => candidate.start >= 0);

    if (candidates.length === 0) {
      break;
    }

    const next = candidates.sort((left, right) => left.start - right.start)[0];
    const end = bodyInner.indexOf(next.endTag, next.start);

    if (end < 0) {
      throw new Error(`DOCX body block is not closed: ${next.tag}`);
    }

    blocks.push(bodyInner.slice(next.start, end + next.endTag.length));
    cursor = end + next.endTag.length;
  }

  return blocks;
};

const removeXmlTag = (xml: string, tagName: string) =>
  xml.replace(new RegExp(`<w:${tagName}\\b[^>]*/>|<w:${tagName}\\b[^>]*>[\\s\\S]*?</w:${tagName}>`, 'g'), '');

const renderSpacing = (spacing: NonNullable<ParagraphLayoutOptions['spacing']>) => {
  const attributes = [
    spacing.before !== undefined ? `w:before="${spacing.before}"` : null,
    spacing.after !== undefined ? `w:after="${spacing.after}"` : null,
    spacing.line !== undefined ? `w:line="${spacing.line}"` : null,
    spacing.lineRule ? `w:lineRule="${spacing.lineRule}"` : null
  ].filter(Boolean);

  return attributes.length > 0 ? `<w:spacing ${attributes.join(' ')}/>` : '';
};

const renderParagraphAlignment = (alignment: NonNullable<ParagraphLayoutOptions['alignment']>) =>
  `<w:jc w:val="${alignment}"/>`;

const updateParagraphProperties = (
  paragraph: string,
  updater: (paragraphProperties: string) => string
) => {
  const match = paragraph.match(PARAGRAPH_PROPERTIES_RE);

  if (match) {
    return paragraph.replace(match[0], updater(match[0]));
  }

  return paragraph.replace(/(<w:p\b[^>]*>)/, `$1${updater('<w:pPr></w:pPr>')}`);
};

const setParagraphLayout = (paragraph: string, options: ParagraphLayoutOptions) =>
  updateParagraphProperties(paragraph, (paragraphProperties) => {
    let next = paragraphProperties;

    for (const tagName of ['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'spacing']) {
      next = removeXmlTag(next, tagName);
    }

    if (options.alignment) {
      next = removeXmlTag(next, 'jc');
    }

    if (options.suppressBorders) {
      next = removeXmlTag(next, 'pBdr');
    }

    if (options.suppressIndentation) {
      next = removeXmlTag(next, 'ind');
    }

    if (options.suppressNumbering) {
      next = removeXmlTag(next, 'numPr');
    }

    if (options.suppressStyle) {
      next = removeXmlTag(next, 'pStyle');
    }

    if (options.suppressTabs) {
      next = removeXmlTag(next, 'tabs');
    }

    const additions = [
      options.alignment ? renderParagraphAlignment(options.alignment) : '',
      options.keepNext ? '<w:keepNext/>' : '',
      options.keepLines ? '<w:keepLines/>' : '',
      options.widowControl ? '<w:widowControl w:val="1"/>' : '',
      options.spacing ? renderSpacing(options.spacing) : ''
    ].join('');

    return next.replace('</w:pPr>', `${additions}</w:pPr>`);
  });

const setParagraphPageBreakBefore = (paragraph: string) =>
  updateParagraphProperties(paragraph, (paragraphProperties) =>
    removeXmlTag(paragraphProperties, 'pageBreakBefore').replace('</w:pPr>', '<w:pageBreakBefore/></w:pPr>')
  );

const removeParagraphTabs = (paragraph: string) =>
  paragraph.replace(/<w:tab\b[^>]*\/>/g, '');

const updateBodyBlocks = (xml: string, updater: (blocks: string[]) => string[]) => {
  const bodyMatch = xml.match(BODY_RE);

  if (!bodyMatch || bodyMatch.index === undefined) {
    return xml;
  }

  const [, bodyOpen, bodyInner, bodyClose] = bodyMatch;
  const blocks = updater(splitTopLevelBodyBlocks(bodyInner));
  const updatedBody = `${bodyOpen}${blocks.join('')}${bodyClose}`;

  return `${xml.slice(0, bodyMatch.index)}${updatedBody}${xml.slice(bodyMatch.index + bodyMatch[0].length)}`;
};

const findLastTableBlockIndex = (blocks: string[]) => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].startsWith('<w:tbl')) {
      return index;
    }
  }

  return -1;
};

const ensureRowCantSplit = (row: string) => {
  const match = row.match(TABLE_ROW_PROPERTIES_RE);

  if (match) {
    const properties = removeXmlTag(match[0], 'cantSplit').replace('</w:trPr>', '<w:cantSplit/></w:trPr>');

    return row.replace(match[0], properties);
  }

  return row.replace(/(<w:tr\b[^>]*>)/, '$1<w:trPr><w:cantSplit/></w:trPr>');
};

const normalizeTableRows = (table: string) =>
  table.replace(TABLE_ROW_RE, ensureRowCantSplit);

const removeTableBorders = (table: string) =>
  removeXmlTag(removeXmlTag(table, 'tblBorders'), 'tcBorders');

const replaceFirstTextRunWithBreak = (paragraph: string, firstLine: string, secondLine: string) =>
  paragraph.replace(
    TEXT_RUN_RE,
    (_match, openTag: string, closeTag: string) =>
      `${openTag}${xmlEncode(firstLine)}${closeTag}<w:br/>${openTag}${xmlEncode(secondLine)}${closeTag}`
  );

const normalizeSignatureLineParagraph = (paragraph: string, fields: ReplacementFields) => {
  const text = textFromXml(paragraph).replace(/\s+/g, ' ').trim();
  const customerPattern = new RegExp(`_+\\s*${escapeRegExp(CUSTOMER_SIGNATURE_NAME)}`);

  if (customerPattern.test(text)) {
    return replaceFirstTextRunWithBreak(paragraph, SIGNATURE_LINE, CUSTOMER_SIGNATURE_NAME);
  }

  if (/^_+\s*\/_+\/$/.test(text)) {
    return replaceFirstTextRunWithBreak(paragraph, SIGNATURE_LINE, fields.signatureName);
  }

  return paragraph;
};

const normalizeSignatureTable = (table: string, fields: ReplacementFields) => {
  const withRowsKeptTogether = normalizeTableRows(table);

  return withRowsKeptTogether.replace(PARAGRAPH_RE, (paragraph) =>
    setParagraphLayout(
      normalizeSignatureLineParagraph(paragraph, fields),
      {
        keepNext: true,
        keepLines: true,
        widowControl: true,
        spacing: {
          before: 0,
          after: 0,
          line: 240,
          lineRule: 'auto'
        }
      }
    )
  );
};

const normalizeSignatureBlockLayout = (xml: string, fields: ReplacementFields) =>
  updateBodyBlocks(xml, (blocks) => {
    const signatureTableIndex = findLastTableBlockIndex(blocks);

    if (signatureTableIndex < 0) {
      return blocks;
    }

    return blocks.map((block, index) => {
      if (index === signatureTableIndex) {
        return normalizeSignatureTable(block, fields);
      }

      if (index === signatureTableIndex - 1 || index === signatureTableIndex - 2) {
        const isEmpty = textFromXml(block).trim().length === 0;

        return block.startsWith('<w:p')
          ? setParagraphLayout(block, {
              keepNext: true,
              keepLines: true,
              widowControl: true,
              spacing: {
                before: isEmpty ? 0 : 120,
                after: isEmpty ? 0 : 60,
                line: 240,
                lineRule: 'auto'
              }
            })
          : block;
      }

      return block;
    });
  });

const isAssignmentHeading = (text: string, index: number) => {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  if (index <= 4) {
    return true;
  }

  return (
    normalized.length <= 90 &&
    /[A-Za-zА-Яа-яЁё]/.test(normalized) &&
    normalized === normalized.toLocaleUpperCase('ru-RU')
  );
};

const ASSIGNMENT_SECTION_HEADING_NUMBERS = new Map([
  ['ПРЕДМЕТ ЗАДАНИЯ', 1],
  ['ОБЪЕМ УСЛУГ', 2],
  ['ПОРЯДОК РАЗМЕЩЕНИЯ', 3],
  ['ПОРЯДОК ВЗАИМОДЕЙСТВИЯ', 4],
  ['СРОК ИСПОЛНЕНИЯ', 5],
  ['ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ', 6],
  ['АДРЕСА, РЕКВИЗИТЫ И ПОДПИСИ СТОРОН:', 7]
]);

const getNumberedAssignmentHeadingText = (text: string) => {
  const normalized = text.replace(/^\d+\.\s*/, '').trim();
  const sectionNumber = ASSIGNMENT_SECTION_HEADING_NUMBERS.get(normalized);

  return sectionNumber ? `${sectionNumber}. ${normalized}` : text;
};

const normalizeAssignmentHeadingText = (paragraph: string) => {
  const text = textFromXml(paragraph);
  const trimmed = text.trim();
  const numberedHeading = getNumberedAssignmentHeadingText(trimmed);

  if (numberedHeading === trimmed) {
    return paragraph;
  }

  const headingStart = text.indexOf(trimmed);

  if (headingStart < 0) {
    return paragraph;
  }

  return replaceParagraphTextRange(paragraph, headingStart, headingStart + trimmed.length, numberedHeading);
};

const setAssignmentHeadingLayout = (paragraph: string) =>
  setParagraphLayout(removeParagraphTabs(normalizeAssignmentHeadingText(paragraph)), {
    alignment: 'center',
    keepNext: true,
    keepLines: true,
    widowControl: true,
    suppressBorders: true,
    suppressIndentation: true,
    suppressNumbering: true,
    suppressStyle: true,
    suppressTabs: true,
    spacing: {
      before: 120,
      after: 80,
      line: 264,
      lineRule: 'auto'
    }
  });

const normalizeAssignmentTable = (table: string) =>
  removeTableBorders(normalizeTableRows(table)).replace(PARAGRAPH_RE, (paragraph) => {
    const text = textFromXml(paragraph).replace(/\s+/g, ' ').trim();

    if (isAssignmentHeading(text, 99)) {
      return setAssignmentHeadingLayout(paragraph);
    }

    return setParagraphLayout(paragraph, {
      keepLines: true,
      widowControl: true,
      suppressBorders: true,
      spacing: {
        before: 0,
        after: 0,
        line: 240,
        lineRule: 'auto'
      }
    });
  });

const normalizeAssignmentLayout = (xml: string, fields: ReplacementFields) => {
  const normalizedXml = xml
    .replace(/<w:pgSz\b[^>]*\/>/, GENERATED_PAGE_SIZE_XML)
    .replace(/<w:pgMar\b[^>]*\/>/, GENERATED_PAGE_MARGINS_XML);

  return updateBodyBlocks(normalizedXml, (blocks) => {
    const signatureTableIndex = findLastTableBlockIndex(blocks);

    return blocks.map((block, index) => {
      if (index === signatureTableIndex) {
        return normalizeSignatureTable(block, fields);
      }

      if (block.startsWith('<w:tbl')) {
        return normalizeAssignmentTable(block);
      }

      if (!block.startsWith('<w:p')) {
        return block;
      }

      const text = textFromXml(block).replace(/\s+/g, ' ').trim();
      const isSignatureLeadIn = index === signatureTableIndex - 1 || index === signatureTableIndex - 2;
      const isEmpty = text.length === 0;
      const isHeading = isAssignmentHeading(text, index);
      const previousText = index > 0 ? textFromXml(blocks[index - 1]).replace(/\s+/g, ' ').trim() : '';
      const nextText = index < blocks.length - 1 ? textFromXml(blocks[index + 1]).replace(/\s+/g, ' ').trim() : '';
      const isHeadingSpacer = isEmpty && Boolean(nextText) && isAssignmentHeading(previousText, index - 1);

      if (isSignatureLeadIn) {
        return setParagraphLayout(block, {
          keepNext: true,
          keepLines: true,
          widowControl: true,
          spacing: {
            before: isEmpty ? 0 : 120,
            after: isEmpty ? 0 : 60,
            line: 240,
            lineRule: 'auto'
          }
        });
      }

      if (isEmpty) {
        return setParagraphLayout(block, {
          keepNext: isHeadingSpacer,
          widowControl: true,
          spacing: {
            before: 0,
            after: 0,
            line: 240,
            lineRule: 'auto'
          }
        });
      }

      if (isHeading) {
        return setAssignmentHeadingLayout(block);
      }

      return setParagraphLayout(block, {
        keepLines: true,
        widowControl: true,
        spacing: {
          before: 0,
          after: 40,
          line: 264,
          lineRule: 'auto'
        }
      });
    });
  });
};

const normalizeNdaLayout = (xml: string) => {
  let headingFound = false;

  const normalizedXml = updateBodyBlocks(xml, (blocks) =>
    blocks.flatMap((block) => {
      if (headingFound) {
        return [block];
      }

      const text = textFromXml(block).replace(/\s+/g, ' ').trim();

      if (!text.startsWith(NDA_CONFIDENTIAL_INFORMATION_LIST_HEADING)) {
        return [block];
      }

      headingFound = true;

      if (block.startsWith('<w:p')) {
        return [setParagraphPageBreakBefore(block)];
      }

      return [PAGE_BREAK_PARAGRAPH_XML, block];
    })
  );

  if (!headingFound) {
    throw new Error('NDA confidential information list heading was not found in DOCX template.');
  }

  return normalizedXml;
};

const normalizeGeneratedDocumentLayout = (xml: string, fields: ReplacementFields) => {
  if (fields.type === DocumentType.ASSIGNMENT) {
    return normalizeAssignmentLayout(xml, fields);
  }

  if (fields.type === DocumentType.NDA) {
    return normalizeNdaLayout(xml);
  }

  if (fields.type === DocumentType.CONTRACT) {
    return normalizeSignatureBlockLayout(xml, fields);
  }

  return xml;
};

const buildDocxBufferWithDocumentXml = (sourceZip: AdmZip, documentXml: string) => {
  const outputZip = new AdmZip();
  const replacementBuffer = Buffer.from(documentXml, 'utf8');

  for (const entry of sourceZip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    outputZip.addFile(
      entry.entryName,
      entry.entryName === WORD_DOCUMENT_XML ? replacementBuffer : entry.getData()
    );
  }

  return outputZip.toBuffer();
};

export class DocxTemplateRenderService {
  constructor(private readonly docxPdfService: DocxPdfService) {}

  assertTemplateAvailable(input: {
    type: DocumentType;
    legalType: LegalType;
  }) {
    const template = resolveDocxDocumentTemplate({
      type: input.type,
      legalType: input.legalType
    });
    const validatedTemplate = validateDocxDocumentTemplate(template);

    if (template.section) {
      const zip = new AdmZip(validatedTemplate.buffer);
      this.extractSection(zip.readAsText(WORD_DOCUMENT_XML), template.section);
    }
  }

  async render(input: {
    type: DocumentType;
    legalType: LegalType;
    payload: Record<string, unknown>;
  }): Promise<RenderedDocxDocument> {
    const template = resolveDocxDocumentTemplate({
      type: input.type,
      legalType: input.legalType
    });

    const validatedTemplate = validateDocxDocumentTemplate(template);
    const zip = new AdmZip(validatedTemplate.buffer);
    const documentXml = zip.readAsText(WORD_DOCUMENT_XML);
    const fields = this.buildReplacementFields(input.payload, input.type, input.legalType);
    const sourceXml = template.section ? this.extractSection(documentXml, template.section) : documentXml;
    const finalXml = normalizeGeneratedDocumentLayout(this.replaceVariables(sourceXml, fields), fields);
    const docxBuffer = buildDocxBufferWithDocumentXml(zip, finalXml);
    const pdfBuffer = await this.docxPdfService.renderPdfFromDocx(docxBuffer);
    const layoutRevision = getCurrentDocumentLayoutRevision(input.type);

    return {
      pdfBuffer,
      docxBuffer,
      payloadJson: {
        ...input.payload,
        docxTemplate: {
          source: normalizeDocxTemplateRelativePath(template.relativePath),
          sourceKind: validatedTemplate.sourceKind,
          sourceLabel: validatedTemplate.sourceLabel,
          sha256: validatedTemplate.sha256,
          updatedAt: validatedTemplate.updatedAt,
          pipelineVersion: CURRENT_DOCX_RENDER_PIPELINE_VERSION,
          ...(layoutRevision === null ? {} : { layoutRevision }),
          section: template.section ?? null
        }
      }
    };
  }

  private buildReplacementFields(
    payload: Record<string, unknown>,
    type: DocumentType,
    legalType: LegalType
  ): ReplacementFields {
    const creator = asRecord(payload.creator);
    const payment = asRecord(payload.payment);
    const source = Object.keys(creator).length > 0 ? creator : payload;
    const fullName = asString(source.creatorFullName) || EMPTY_FIELD;
    const passportSeries = asString(source.passportSeries);
    const passportNumber = asString(source.passportNumber);
    const fixedSalary = asNumber(payment.fixedSalaryPart);
    const variablePart = asNumber(payment.variablePart);
    const totalPayment = asNumber(payment.totalPayment);
    const personGrammar = readPersonGrammar(source, fullName);

    return {
      type,
      legalType,
      fullName,
      personGrammar,
      signatureName: buildSignatureName(fullName),
      inn: asString(source.inn) || EMPTY_FIELD,
      ogrnip: asString(source.ogrnip) || EMPTY_FIELD,
      phone: asString(source.phone) || EMPTY_FIELD,
      email: asString(source.email) || EMPTY_FIELD,
      registrationAddress: asString(source.registrationAddress) || EMPTY_FIELD,
      passportSeries: passportSeries || EMPTY_FIELD,
      passportNumber: passportNumber || EMPTY_FIELD,
      passportSpaced: formatPassportSpaced(passportSeries, passportNumber),
      passportCompact: formatPassportCompact(passportSeries, passportNumber),
      passportIssuedAt: asString(source.passportIssuedAt) || EMPTY_FIELD,
      passportIssuedBy: asString(source.passportIssuedByInstrumental) || EMPTY_FIELD,
      passportDepartmentCode: asString(source.passportDepartmentCode) || EMPTY_FIELD,
      bankName: asString(source.bankName) || EMPTY_FIELD,
      bankAccount: asString(source.bankAccount) || EMPTY_FIELD,
      bankBik: asString(source.bankBik) || EMPTY_FIELD,
      bankCorrAccount: asString(source.bankCorrAccount) || EMPTY_FIELD,
      contractNumber: asString(payload.contractNumber) || EMPTY_FIELD,
      contractDate: asString(payload.contractDate) || asString(payload.documentDate),
      documentDate: asString(payload.documentDate) || asString(payload.generatedDate),
      assignmentDate: asString(payload.assignmentDate) || asString(payload.documentDate),
      actDate: asString(payload.actDate) || asString(payload.documentDate),
      rightsTransferDate: asString(payload.rightsTransferDate) || asString(payload.documentDate),
      periodStartDate: asString(payload.periodStartDate),
      periodEndDate: asString(payload.periodEndDate),
      rawViewsFormatted: asString(payload.rawViewsFormatted) || formatInteger(asNumber(payment.rawViews)),
      actualVideoCountFormatted:
        formatInteger(asNumber(payment.actualVideoCount)) || asString(asRecord(payload.aggregation).actualVideoCount),
      fixedSalaryText: this.formatMoneyText(fixedSalary, asString(payload.fixedSalaryWords)),
      variablePartText: this.formatMoneyText(variablePart, asString(payload.variablePartWords)),
      totalPaymentText: this.formatMoneyText(totalPayment, asString(payload.totalPaymentWords))
    };
  }

  private formatMoneyText(value: number | null, words: string) {
    const numeric = formatInteger(value);

    if (!numeric && !words) {
      return '';
    }

    if (!words) {
      return `${numeric} руб.`;
    }

    return numeric ? `${numeric} (${words})` : words;
  }

  private replaceVariables(xml: string, fields: ReplacementFields) {
    return xml.replace(PARAGRAPH_RE, (paragraph) => {
      return this.replaceParagraphVariables(paragraph, fields);
    });
  }

  private replaceParagraphVariables(paragraph: string, fields: ReplacementFields) {
    if (!textFromXml(paragraph)) {
      return paragraph;
    }

    let result = paragraph;
    const primaryDate = this.resolvePrimaryDateForParagraph(textFromXml(result), fields);
    const primaryQuotedDate = formatQuotedDate(primaryDate);
    const primaryLongDate = formatLongDate(primaryDate);

    result = this.replaceKnownPersonNames(result, fields);
    result = this.replacePersonGrammar(result, fields);
    result = replaceTextInParagraph(result, /(ДОГОВОР №\s*)_+/gi, `$1${fields.contractNumber}`);
    result = replaceTextInParagraph(result, /(Договор[^№\n]{0,120}№)\s*_+/g, `$1 ${fields.contractNumber}`);
    result = replaceTextInParagraph(result, /(Задание заказчика №)\s*_+/g, `$1 ${fields.contractNumber}`);
    result = replaceTextInParagraph(result, /№\s*_+/g, `№ ${fields.contractNumber}`);
    result = replaceStaleContractReferenceDates(result, fields);
    result = replaceTextInParagraph(
      result,
      /№\s*(?:не\s+указано|_+)\s*от\s*«?\d{1,2}»?\s+[А-Яа-яЁё]+\s+\d{4}\s*г\.?/g,
      formatContractReference(fields)
    );
    result = replaceTextInParagraph(
      result,
      /№\s*(?:не\s+указано|_+)\s*от\s*\d{2}\.\d{2}\.\d{4}\s*г\.?/g,
      formatContractReference(fields)
    );
    result = replaceTextInParagraph(
      result,
      new RegExp(
        `№\\s*${escapeRegExp(fields.contractNumber)}\\s*от\\s*«?\\d{1,2}»?\\s+[А-Яа-яЁё]+\\s+\\d{4}\\s*г\\.?`,
        'g'
      ),
      formatContractReference(fields)
    );
    result = replaceTextInParagraph(
      result,
      new RegExp(`№\\s*${escapeRegExp(fields.contractNumber)}\\s*от\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*г\\.?`, 'g'),
      formatContractReference(fields)
    );
    result = replaceTextInParagraph(result, /№\s*не\s+указано/g, `№ ${fields.contractNumber}`);
    result = replaceStaleContractReferenceDates(result, fields);

    if (fields.periodStartDate && fields.periodEndDate) {
      result = replaceTextInParagraph(
        result,
        /в период с «_+»\s+[А-Яа-яЁё]+\s+\d{4}\s+г\.?\s+по\s+«_+»\s+[А-Яа-яЁё]+\s+\d{4}\s+г\.?/g,
        `в период с ${formatQuotedDate(fields.periodStartDate)} по ${formatQuotedDate(fields.periodEndDate)}`
      );
      result = replaceTextInParagraph(
        result,
        /в период с \d{2}\s+[А-Яа-яЁё]+\s+по\s+\d{2}\s+[А-Яа-яЁё]+/g,
        `в период с ${formatDayMonth(fields.periodStartDate)} по ${formatDayMonth(fields.periodEndDate)}`
      );
    }

    result = replaceTextInParagraph(
      result,
      /«_+»\s+(?:[А-Яа-яЁё]+|_+)\s+\d{4}\s*(?:года|г\.?)/g,
      primaryQuotedDate
    );
    result = replaceTextInParagraph(result, /05\.05\.2025\s*г\.?/g, `${fields.documentDate || primaryDate} г.`);
    result = replaceTextInParagraph(result, /05[\s\u00a0]+мая[\s\u00a0]+2025[\s\u00a0]*г\.?/g, primaryLongDate);
    result = replaceStaleContractReferenceDates(result, fields);

    result = this.replacePassportAndContacts(result, fields);
    result = this.replaceRequisites(result, fields);
    result = this.replaceMonthlyValues(result, fields);

    return result;
  }

  private resolvePrimaryDateForParagraph(text: string, fields: ReplacementFields) {
    const referencesContract = /договор/i.test(text);

    if (fields.type === DocumentType.ASSIGNMENT && !referencesContract) {
      return fields.assignmentDate || fields.documentDate || fields.contractDate;
    }

    if (fields.type === DocumentType.ACT && !referencesContract) {
      return fields.actDate || fields.documentDate || fields.contractDate;
    }

    if (fields.type === DocumentType.RIGHTS_TRANSFER && !referencesContract) {
      return fields.rightsTransferDate || fields.documentDate || fields.contractDate;
    }

    return fields.contractDate || fields.documentDate;
  }

  private replaceKnownPersonNames(text: string, fields: ReplacementFields) {
    const nameTokens = [
      'Иванов Иван Иванович',
      'Иванову Ивану Ивановичу',
      'Иванович Иванович Иванович',
      'Иванова Ваня Ивановна',
      'Аверьянова Анна Николаевна'
    ];

    let result = text;

    for (const token of nameTokens) {
      result = replaceTextInParagraph(result, token, fields.fullName);
    }

    result = replaceTextInParagraph(result, /\/Иванова В\.И\.?\//g, fields.signatureName);
    result = replaceTextInParagraph(result, /\/Аверьянова А\.Н\.?\//g, fields.signatureName);

    return result;
  }

  private replacePersonGrammar(text: string, fields: ReplacementFields) {
    const { personGrammar } = fields;

    let result = text;

    result = replaceTextInParagraph(result, 'Гражданину РФ', personGrammar.citizenDativeLabel);
    result = replaceTextInParagraph(result, 'Гражданке', personGrammar.citizenDativeLabel);
    result = replaceTextInParagraph(result, 'Гражданин РФ', personGrammar.citizenLabel);
    result = replaceTextInParagraph(result, 'Гражданка', personGrammar.citizenLabel);
    result = replaceTextInParagraph(result, 'именуемый', personGrammar.referredAs);
    result = replaceTextInParagraph(result, 'именуемая', personGrammar.referredAs);
    result = replaceTextInParagraph(result, 'являющийся', personGrammar.selfEmployedTaxpayerParticiple);
    result = replaceTextInParagraph(result, 'являющаяся', personGrammar.selfEmployedTaxpayerParticiple);

    return result;
  }

  private replacePassportAndContacts(text: string, fields: ReplacementFields) {
    let result = text;

    result = replaceTextInParagraph(result, '11 11 № 111111', fields.passportSpaced);
    result = replaceTextInParagraph(result, '1111 №111111', fields.passportCompact);
    result = replaceTextInParagraph(result, '40 10 № 555555', fields.passportSpaced);
    result = replaceTextInParagraph(result, '01.01.2000', fields.passportIssuedAt);
    result = replaceTextInParagraph(result, '10.01.2020', fields.passportIssuedAt);
    result = replaceTextInParagraph(result, '01.03.2020г.', `${fields.passportIssuedAt} г.`);
    result = replaceTextInParagraph(result, 'ГУ МВД России по Московской области в г. Москва', fields.passportIssuedBy);
    result = replaceTextInParagraph(result, 'ГУ МВД РОССИИ ПО Московской области', fields.passportIssuedBy);
    result = replaceTextInParagraph(result, 'ГУ МВД России по Московской области', fields.passportIssuedBy);
    result = replaceTextInParagraph(result, /код подразделения\s+000000/g, `код подразделения ${fields.passportDepartmentCode}`);
    result = replaceTextInParagraph(result, /код подр\.\s*500-027/g, `код подр. ${fields.passportDepartmentCode}`);
    result = replaceTextInParagraph(result, 'г. Москва ул Ленина д1 кв 1', fields.registrationAddress);
    result = replaceTextInParagraph(result, /^РОССИЯ,\s*$/g, fields.registrationAddress);
    result = replaceTextInParagraph(result, '+7 (999) 999-99-99', fields.phone);
    result = replaceTextInParagraph(result, '+7 99990000000', fields.phone);
    result = replaceTextInParagraph(result, '+7 ', fields.phone);
    result = replaceTextInParagraph(result, 'почта@gmail.com', fields.email);

    return result;
  }

  private replaceRequisites(text: string, fields: ReplacementFields) {
    let result = text;

    result = replaceTextInParagraph(result, /(ИНН:\s*)1{10,12}/g, `$1${fields.inn}`);
    result = replaceTextInParagraph(result, /(ИНН:\s*)$/g, `$1${fields.inn}`);
    result = replaceTextInParagraph(result, /(ОГРНИП:\s*)1{13,15}/g, `$1${fields.ogrnip}`);
    result = replaceTextInParagraph(result, /(ОГРНИП:\s*)$/g, `$1${fields.ogrnip}`);
    result = replaceTextInParagraph(result, /АО «ТБанк»/g, fields.bankName);

    if (/рас\/с:/.test(textFromXml(result))) {
      result = replaceTextInParagraph(result, /1{20}/g, fields.bankAccount);
    }

    if (/корр\/с:/.test(textFromXml(result))) {
      result = replaceTextInParagraph(result, /1{20}/g, fields.bankCorrAccount);
    }

    if (/БИК:/.test(textFromXml(result))) {
      result = replaceTextInParagraph(result, /(БИК:\s*)1{9}/g, `$1${fields.bankBik}`);
    }

    return result;
  }

  private replaceMonthlyValues(text: string, fields: ReplacementFields) {
    let result = text;

    if (fields.actualVideoCountFormatted) {
      result = replaceTextInParagraph(result, /__\s+единиц контента/g, `${fields.actualVideoCountFormatted} единиц контента`);
    }

    if (fields.rawViewsFormatted) {
      result = replaceTextInParagraph(result, /1000000\s+просмотров/g, `${fields.rawViewsFormatted} просмотров`);
    }

    if (fields.fixedSalaryText) {
      result = replaceTextInParagraph(result, /35000\s+\(тридцать пять\)\s+руб\./g, fields.fixedSalaryText);
    }

    if (fields.variablePartText) {
      result = replaceTextInParagraph(result, /6000\s+\(шесть тысяч\)\s+руб\./g, fields.variablePartText);
    }

    if (fields.totalPaymentText) {
      result = replaceTextInParagraph(result, /41000\s+\(сорок одна тысяча\)\s+руб\./g, fields.totalPaymentText);
    }

    return result;
  }

  private extractSection(
    xml: string,
    section: {
      startAfterMarker?: string;
      startAfterMarkers?: string[];
      startMarker: string;
      endAfterMarker?: string;
      endMarker?: string;
      endMarkerOptional?: boolean;
      forbiddenExactBlockTexts?: string[];
      forbiddenMarkers?: string[];
    }
  ) {
    const bodyMatch = xml.match(BODY_RE);

    if (!bodyMatch || bodyMatch.index === undefined) {
      throw new Error('DOCX template body was not found');
    }

    const [, bodyOpen, bodyInner, bodyClose] = bodyMatch;
    const blocks = splitTopLevelBodyBlocks(bodyInner);
    const sectionProperties = blocks.find((block) => block.startsWith('<w:sectPr')) ?? '';
    const contentBlocks = blocks.filter((block) => !block.startsWith('<w:sectPr'));
    const startAfterMarkers = section.startAfterMarkers ?? (section.startAfterMarker ? [section.startAfterMarker] : []);
    let startAfterIndex = -1;

    for (const marker of startAfterMarkers) {
      const markerIndex = contentBlocks.findIndex(
        (block, index) => index >= startAfterIndex && textFromXml(block).includes(marker)
      );

      if (markerIndex < 0) {
        throw new Error(`DOCX section start-after marker not found: ${marker}`);
      }

      startAfterIndex = markerIndex;
    }

    const startIndex = contentBlocks.findIndex(
      (block, index) => index >= startAfterIndex && textFromXml(block).includes(section.startMarker)
    );

    if (startIndex < 0) {
      throw new Error(`DOCX section start marker not found: ${section.startMarker}`);
    }

    const endAfterIndex = section.endAfterMarker
      ? contentBlocks.findIndex(
          (block, index) => index >= startIndex && textFromXml(block).includes(section.endAfterMarker!)
        )
      : startIndex;

    if (section.endAfterMarker && endAfterIndex < 0) {
      throw new Error(`DOCX section end-after marker not found: ${section.endAfterMarker}`);
    }

    const endIndex = section.endMarker
      ? contentBlocks.findIndex(
          (block, index) => index > endAfterIndex && textFromXml(block).includes(section.endMarker!)
        )
      : contentBlocks.length;

    if (endIndex < 0 && !section.endMarkerOptional) {
      throw new Error(`DOCX section end marker not found: ${section.endMarker}`);
    }

    const selectedBlocks = contentBlocks.slice(startIndex, endIndex < 0 ? contentBlocks.length : endIndex);
    const selectedText = selectedBlocks.map(textFromXml).join('');

    for (const marker of section.forbiddenMarkers ?? []) {
      if (selectedText.includes(marker)) {
        throw new Error(`DOCX section boundary leaked forbidden marker: ${marker}`);
      }
    }

    for (const forbiddenText of section.forbiddenExactBlockTexts ?? []) {
      const leakedBlock = selectedBlocks.some((block) => textFromXml(block).trim() === forbiddenText);

      if (leakedBlock) {
        throw new Error(`DOCX section boundary leaked forbidden block: ${forbiddenText}`);
      }
    }

    const newBodyInner = `${selectedBlocks.join('')}${sectionProperties}`;
    const newXml = `${xml.slice(0, bodyMatch.index)}${bodyOpen}${newBodyInner}${bodyClose}${xml.slice(
      bodyMatch.index + bodyMatch[0].length
    )}`;

    return newXml;
  }
}
