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

  async listLatestPaymentUploadsForCreatorsMonth(creatorUserIds: string[], monthKey: string) {
    if (!creatorUserIds.length) {
      return [];
    }

    return prisma.paymentDocumentUpload.findMany({
      where: {
        creatorUserId: {
          in: creatorUserIds
        },
        monthKey,
        status: {
          not: PaymentDocumentStatus.REJECTED
        }
      },
      orderBy: [
        { creatorUserId: 'asc' },
        { type: 'asc' },
        { uploadedAt: 'desc' }
      ]
    });
  }

  async listPaymentUploadsForExport(input: {
    type: PaymentDocumentType;
    monthKey?: string;
    includeAlreadyForwarded?: boolean;
  }) {
    return prisma.paymentDocumentUpload.findMany({
      where: {
        type: input.type,
        monthKey: input.monthKey,
        status: {
          not: PaymentDocumentStatus.REJECTED
        },
        ...(input.includeAlreadyForwarded ? {} : { forwardedChatId: null })
      },
      include: {
        creator: {
          include: {
            creatorProfile: true,
            creatorAssignments: {
              where: { isActive: true },
              include: {
                teamLead: {
                  include: {
                    teamLeadProfile: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [
        { monthKey: 'asc' },
        { creatorUserId: 'asc' },
        { uploadedAt: 'desc' }
      ]
    });
  }

  async markPaymentUploadsSuperseded(uploadIds: string[], marker: string) {
    if (!uploadIds.length) {
      return { count: 0 };
    }

    return prisma.paymentDocumentUpload.updateMany({
      where: {
        id: { in: uploadIds },
        forwardedChatId: null
      },
      data: {
        forwardedChatId: marker,
        forwardedMessageId: null,
        forwardedAt: new Date()
      }
    });
  }

  async updatePaymentUploadForwardInfo(id: string, forwardedChatId: string, forwardedMessageId: number) {
    return prisma.paymentDocumentUpload.update({
      where: { id },
      data: {
        forwardedChatId,
        forwardedMessageId,
        forwardedAt: new Date()
      }
    });
  }

  async findReceiptForInvoice(input: {
    creatorUserId: string;
    monthKey?: string | null;
    invoiceUploadedAt: Date;
  }) {
    return prisma.paymentDocumentUpload.findFirst({
      where: {
        creatorUserId: input.creatorUserId,
        monthKey: input.monthKey ?? null,
        type: PaymentDocumentType.RECEIPT,
        status: {
          not: PaymentDocumentStatus.REJECTED
        },
        uploadedAt: {
          gte: input.invoiceUploadedAt
        }
      },
      orderBy: {
        uploadedAt: 'desc'
      }
    });
  }

  async findPendingReceiptInvoiceForCreator(creatorUserId: string) {
    const uploads = await prisma.paymentDocumentUpload.findMany({
      where: {
        creatorUserId,
        status: {
          not: PaymentDocumentStatus.REJECTED
        },
        type: {
          in: [PaymentDocumentType.INVOICE, PaymentDocumentType.RECEIPT]
        }
      },
      orderBy: {
        uploadedAt: 'desc'
      }
    });
    const latestInvoicesByMonth = new Map<string, typeof uploads[number]>();

    for (const upload of uploads) {
      if (upload.type !== PaymentDocumentType.INVOICE) {
        continue;
      }

      const key = upload.monthKey ?? '';

      if (!latestInvoicesByMonth.has(key)) {
        latestInvoicesByMonth.set(key, upload);
      }
    }

    return [...latestInvoicesByMonth.values()].find((invoiceUpload) =>
      !uploads.some(
        (upload) =>
          upload.type === PaymentDocumentType.RECEIPT &&
          upload.monthKey === invoiceUpload.monthKey &&
          upload.uploadedAt >= invoiceUpload.uploadedAt
      )
    ) ?? null;
  }

  async hasReceiptForCreatorMonth(creatorUserId: string, monthKey: string) {
    const receipt = await prisma.paymentDocumentUpload.findFirst({
      where: {
        creatorUserId,
        monthKey,
        type: PaymentDocumentType.RECEIPT,
        status: {
          not: PaymentDocumentStatus.REJECTED
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(receipt);
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
