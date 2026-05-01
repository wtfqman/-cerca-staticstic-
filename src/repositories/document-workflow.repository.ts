import {
  CreatorDocumentWorkflowStatus,
  DocumentWorkflowCampaignStatus,
  DocumentWorkflowCampaignType,
  DocumentWorkflowQueue,
  PaymentDocumentStatus,
  PaymentDocumentType,
  Prisma
} from '@prisma/client';

import { prisma } from '../lib/prisma';

const workflowStateInclude = Prisma.validator<Prisma.CreatorDocumentWorkflowStateInclude>()({
  campaign: true,
  creator: {
    include: {
      creatorProfile: true
    }
  },
  documents: {
    include: {
      document: {
        include: {
          signatureUploads: {
            orderBy: { uploadedAt: 'desc' }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  },
  paymentUploads: {
    orderBy: { uploadedAt: 'desc' }
  }
});

export type DocumentWorkflowStateWithRelations = Prisma.CreatorDocumentWorkflowStateGetPayload<{
  include: typeof workflowStateInclude;
}>;

export class DocumentWorkflowRepository {
  async upsertCampaign(input: {
    key: string;
    type: DocumentWorkflowCampaignType;
    status: DocumentWorkflowCampaignStatus;
    title: string;
    description?: string;
    contractDate?: Date;
    periodMonths: string[];
    createdByUserId?: string;
    activatedAt?: Date;
  }) {
    return prisma.documentWorkflowCampaign.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        type: input.type,
        status: input.status,
        title: input.title,
        description: input.description,
        contractDate: input.contractDate,
        periodMonths: input.periodMonths,
        createdByUserId: input.createdByUserId,
        activatedAt: input.activatedAt
      },
      update: {
        status: input.status,
        title: input.title,
        description: input.description,
        contractDate: input.contractDate,
        periodMonths: input.periodMonths,
        createdByUserId: input.createdByUserId,
        activatedAt: input.activatedAt
      }
    });
  }

  async findCampaignByKey(key: string) {
    return prisma.documentWorkflowCampaign.findUnique({
      where: { key }
    });
  }

  async ensureState(input: {
    campaignId: string;
    creatorUserId: string;
  }) {
    return prisma.creatorDocumentWorkflowState.upsert({
      where: {
        campaignId_creatorUserId: {
          campaignId: input.campaignId,
          creatorUserId: input.creatorUserId
        }
      },
      create: {
        campaignId: input.campaignId,
        creatorUserId: input.creatorUserId,
        status: CreatorDocumentWorkflowStatus.ACTIVE
      },
      update: {
        status: CreatorDocumentWorkflowStatus.ACTIVE
      },
      include: workflowStateInclude
    });
  }

  async findStateById(id: string) {
    return prisma.creatorDocumentWorkflowState.findUnique({
      where: { id },
      include: workflowStateInclude
    });
  }

  async findState(campaignId: string, creatorUserId: string) {
    return prisma.creatorDocumentWorkflowState.findUnique({
      where: {
        campaignId_creatorUserId: {
          campaignId,
          creatorUserId
        }
      },
      include: workflowStateInclude
    });
  }

  async findStateByCampaignKey(campaignKey: string, creatorUserId: string) {
    return prisma.creatorDocumentWorkflowState.findFirst({
      where: {
        creatorUserId,
        campaign: {
          key: campaignKey
        }
      },
      include: workflowStateInclude
    });
  }

  async findStatesByDocumentId(documentId: string) {
    return prisma.creatorDocumentWorkflowState.findMany({
      where: {
        documents: {
          some: { documentId }
        }
      },
      include: workflowStateInclude
    });
  }

  async linkDocument(input: {
    workflowStateId: string;
    documentId: string;
    queue: DocumentWorkflowQueue;
    required?: boolean;
  }) {
    return prisma.documentWorkflowDocument.upsert({
      where: {
        workflowStateId_documentId: {
          workflowStateId: input.workflowStateId,
          documentId: input.documentId
        }
      },
      create: {
        workflowStateId: input.workflowStateId,
        documentId: input.documentId,
        queue: input.queue,
        required: input.required ?? true
      },
      update: {
        queue: input.queue,
        required: input.required ?? true
      }
    });
  }

  async updateState(
    id: string,
    data: Prisma.CreatorDocumentWorkflowStateUpdateInput
  ) {
    return prisma.creatorDocumentWorkflowState.update({
      where: { id },
      data,
      include: workflowStateInclude
    });
  }

  async createPaymentUpload(input: {
    workflowStateId: string;
    creatorUserId: string;
    monthKey?: string;
    type: PaymentDocumentType;
    status?: PaymentDocumentStatus;
    telegramFileId?: string;
    telegramDocumentId?: string;
    originalFileName: string;
    mimeType?: string;
    filePath?: string;
    uploadedAt?: Date;
    receiptExpectedAt?: Date | null;
    receiptReminderDueAt?: Date | null;
    receiptReminderSentAt?: Date | null;
  }) {
    return prisma.paymentDocumentUpload.create({
      data: {
        workflowStateId: input.workflowStateId,
        creatorUserId: input.creatorUserId,
        monthKey: input.monthKey,
        type: input.type,
        status: input.status ?? PaymentDocumentStatus.UPLOADED,
        telegramFileId: input.telegramFileId,
        telegramDocumentId: input.telegramDocumentId,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        filePath: input.filePath,
        uploadedAt: input.uploadedAt,
        receiptExpectedAt: input.receiptExpectedAt,
        receiptReminderDueAt: input.receiptReminderDueAt,
        receiptReminderSentAt: input.receiptReminderSentAt
      }
    });
  }

  async updatePaymentUpload(id: string, data: Prisma.PaymentDocumentUploadUpdateInput) {
    return prisma.paymentDocumentUpload.update({
      where: { id },
      data
    });
  }

  async clearInvoiceReceiptReminderDue(input: {
    workflowStateId: string;
    creatorUserId: string;
    monthKey?: string | null;
    receiptUploadedAt: Date;
  }) {
    return prisma.paymentDocumentUpload.updateMany({
      where: {
        workflowStateId: input.workflowStateId,
        creatorUserId: input.creatorUserId,
        monthKey: input.monthKey ?? null,
        type: PaymentDocumentType.INVOICE,
        status: { not: PaymentDocumentStatus.REJECTED },
        uploadedAt: {
          lte: input.receiptUploadedAt
        }
      },
      data: {
        receiptReminderDueAt: null
      }
    });
  }

  async listReceiptReminderDue(now: Date) {
    return prisma.creatorDocumentWorkflowState.findMany({
      where: {
        status: CreatorDocumentWorkflowStatus.ACTIVE,
        OR: [
          {
            paymentUploads: {
              some: {
                type: PaymentDocumentType.INVOICE,
                status: { not: PaymentDocumentStatus.REJECTED },
                receiptExpectedAt: { not: null },
                receiptReminderDueAt: {
                  lte: now
                },
                receiptReminderSentAt: null
              }
            }
          },
          {
            invoiceUploadedAt: { not: null },
            receiptExpectedAt: { not: null },
            receiptUploadedAt: null,
            receiptReminderSentAt: null,
            receiptReminderDueAt: {
              lte: now
            },
            paymentUploads: {
              some: {
                type: PaymentDocumentType.INVOICE,
                status: { not: PaymentDocumentStatus.REJECTED }
              }
            }
          }
        ]
      },
      include: workflowStateInclude,
      orderBy: { receiptReminderDueAt: 'asc' }
    });
  }

  async markReceiptReminderSent(id: string, sentAt: Date) {
    return prisma.creatorDocumentWorkflowState.update({
      where: { id },
      data: {
        receiptReminderSentAt: sentAt
      }
    });
  }

  async markPaymentUploadReceiptReminderSent(id: string, sentAt: Date) {
    return prisma.paymentDocumentUpload.update({
      where: { id },
      data: {
        receiptReminderSentAt: sentAt
      }
    });
  }
}
