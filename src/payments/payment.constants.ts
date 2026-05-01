export const CREATOR_INVOICE_MESSAGE_SURCHARGE = 1_000;

export const getCreatorInvoiceDisplayAmount = (baseAmount: number) =>
  baseAmount + CREATOR_INVOICE_MESSAGE_SURCHARGE;
