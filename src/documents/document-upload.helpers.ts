export type TelegramDocumentLike = {
  file_name?: string;
  mime_type?: string;
};

export const isPdfTelegramDocument = (document: TelegramDocumentLike) =>
  (document.mime_type ?? '').toLowerCase() === 'application/pdf' ||
  (document.file_name ?? '').toLowerCase().endsWith('.pdf');

export const isJpegTelegramDocument = (document: TelegramDocumentLike) =>
  ['image/jpeg', 'image/jpg'].includes((document.mime_type ?? '').toLowerCase()) ||
  /\.(jpe?g)$/i.test(document.file_name ?? '');

export const isPngTelegramDocument = (document: TelegramDocumentLike) =>
  (document.mime_type ?? '').toLowerCase() === 'image/png' ||
  (document.file_name ?? '').toLowerCase().endsWith('.png');

export const isReceiptTelegramDocument = (document: TelegramDocumentLike) =>
  isPdfTelegramDocument(document) || isJpegTelegramDocument(document) || isPngTelegramDocument(document);

export const looksLikePdfBuffer = (buffer: Buffer) => buffer.subarray(0, 4).toString('utf8') === '%PDF';

export const looksLikeJpegBuffer = (buffer: Buffer) =>
  buffer.length >= 3 &&
  buffer[0] === 0xff &&
  buffer[1] === 0xd8 &&
  buffer[2] === 0xff;

export const looksLikePngBuffer = (buffer: Buffer) =>
  buffer.length >= 8 &&
  buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

export const looksLikeReceiptBuffer = (buffer: Buffer) =>
  looksLikePdfBuffer(buffer) || looksLikeJpegBuffer(buffer) || looksLikePngBuffer(buffer);
