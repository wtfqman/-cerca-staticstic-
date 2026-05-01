export type TelegramDocumentLike = {
  file_name?: string;
  mime_type?: string;
};

export const isPdfTelegramDocument = (document: TelegramDocumentLike) =>
  (document.mime_type ?? '').toLowerCase() === 'application/pdf' ||
  (document.file_name ?? '').toLowerCase().endsWith('.pdf');

