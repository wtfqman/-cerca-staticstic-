import { DocumentType } from '@prisma/client';
import pdfParse from 'pdf-parse';

import { getDocumentTitle } from './document.constants';

const MIN_EXTRACTED_TEXT_LENGTH = 40;

const normalizePdfText = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

const firstMarkerIndex = (text: string, markers: string[]) => {
  const indexes = markers
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);

  return indexes.length ? Math.min(...indexes) : null;
};

const detectSignedPdfDocumentType = (text: string): DocumentType | null => {
  const candidates = [
    {
      type: DocumentType.CONTRACT,
      index: firstMarkerIndex(text, ['договор №', 'договор no', 'возмездного оказания услуг'])
    },
    {
      type: DocumentType.NDA,
      index: firstMarkerIndex(text, ['соглашение о конфиденциальности', 'соглашение о неразглашении'])
    },
    {
      type: DocumentType.ASSIGNMENT,
      index: firstMarkerIndex(text, [
        'задание заказчика',
        'предмет задания',
        'приложение №1',
        'приложение № 1',
        'приложение no1',
        'приложение no 1',
        'приложение n1'
      ])
    },
    {
      type: DocumentType.ACT_1000,
      index: firstMarkerIndex(text, [
        'акт передачи прав на 1000',
        'акт передачи прав на 1 000',
        'акт об оказании услуг на 1000',
        'акт об оказании услуг на 1 000',
        'акт на 1000',
        'акт на 1 000'
      ])
    },
    {
      type: DocumentType.ACT,
      index: firstMarkerIndex(text, [
        'акт оказанных услуг',
        'акт сдачи-приемки',
        'приложение №2',
        'приложение № 2',
        'приложение no2',
        'приложение no 2'
      ])
    },
    {
      type: DocumentType.RIGHTS_TRANSFER,
      index: firstMarkerIndex(text, [
        'передача прав',
        'передаче прав',
        'передачи прав',
        'приложение №3',
        'приложение № 3',
        'приложение no3',
        'приложение no 3'
      ])
    }
  ].filter((candidate): candidate is { type: DocumentType; index: number } => candidate.index !== null);

  return candidates.sort((left, right) => left.index - right.index)[0]?.type ?? null;
};

const looksLikeAct1000 = (text: string) =>
  /\b1\s?000\b/.test(text) || /\b1000\b/.test(text) || text.includes('одна тысяча');

export class SignedPdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignedPdfValidationError';
  }
}

export const assertSignedPdfMatchesDocument = async (input: {
  buffer: Buffer;
  expectedType: DocumentType;
}) => {
  let text = '';

  try {
    const parsed = await pdfParse(input.buffer);
    text = normalizePdfText(parsed.text ?? '');
  } catch {
    throw new SignedPdfValidationError(
      `Не смог прочитать текст PDF. Загрузи именно тот подписанный PDF для слота «${getDocumentTitle(input.expectedType)}», который бот прислал.`
    );
  }

  if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
    throw new SignedPdfValidationError(
      `PDF не похож на текстовый подписанный документ. Загрузи PDF для слота «${getDocumentTitle(input.expectedType)}», который бот прислал.`
    );
  }

  const detectedType = detectSignedPdfDocumentType(text);

  if (!detectedType) {
    throw new SignedPdfValidationError(
      `Не смог распознать тип PDF. Выбери правильный слот и загрузи подписанный документ «${getDocumentTitle(input.expectedType)}».`
    );
  }

  if (
    detectedType !== input.expectedType &&
    !(
      input.expectedType === DocumentType.ACT_1000 &&
      (detectedType === DocumentType.ACT || detectedType === DocumentType.RIGHTS_TRANSFER) &&
      looksLikeAct1000(text)
    )
  ) {
    throw new SignedPdfValidationError(
      `Похоже, это «${getDocumentTitle(detectedType)}», а выбран слот «${getDocumentTitle(input.expectedType)}». Выбери правильную кнопку и загрузи файл туда.`
    );
  }
};
