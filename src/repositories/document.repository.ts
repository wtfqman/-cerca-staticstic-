import { DocumentStatus, DocumentType, LegalType, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

const creatorWithAssignmentsInclude = Prisma.validator<Prisma.UserInclude>()({
  creatorProfile: true,
  creatorAssignments: {
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: {
      teamLead: {
        include: {
          teamLeadProfile: true
        }
      }
    }
  }
});

const signatureUploadsInclude = Prisma.validator<Prisma.DocumentInclude>()({
  signatureUploads: {
    orderBy: { uploadedAt: 'desc' }
  }
});

const documentWithRelationsInclude = Prisma.validator<Prisma.DocumentInclude>()({
  creator: {
    include: creatorWithAssignmentsInclude
  },
  signatureUploads: {
    orderBy: { uploadedAt: 'desc' }
  }
});

const signatureUploadWithDocumentInclude = Prisma.validator<Prisma.DocumentSignatureUploadInclude>()({
  creator: {
    include: creatorWithAssignmentsInclude
  },
  document: {
    include: documentWithRelationsInclude
  }
});

const signedDocumentStatuses = new Set<DocumentStatus>([
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT
]);

const signatureUploadCandidateStatuses = [
  DocumentStatus.GENERATED,
  DocumentStatus.SENT_TO_CREATOR,
  DocumentStatus.VIEWED_BY_CREATOR,
  DocumentStatus.SIGNED_UPLOADED,
  DocumentStatus.FORWARDED_TO_CHAT,
  DocumentStatus.FAILED
] as const;

export interface UpsertDocumentInput {
  creatorUserId: string;
  type: DocumentType;
  legalType: LegalType;
  scopeKey: string;
  monthKey?: string;
  periodStart?: Date;
  periodEnd?: Date;
  status?: DocumentStatus;
  filePath: string;
  fileName: string;
  payloadJson: unknown;
}

export class DocumentRepository {
  async upsertDocument(input: UpsertDocumentInput) {
    const where = {
      creatorUserId_type_scopeKey: {
        creatorUserId: input.creatorUserId,
        type: input.type,
        scopeKey: input.scopeKey
      }
    };
    const existingDocument = await prisma.document.findUnique({
      where,
      select: { status: true }
    });
    const updateStatus =
      input.status ?? (existingDocument && signedDocumentStatuses.has(existingDocument.status)
        ? existingDocument.status
        : DocumentStatus.GENERATED);

    return prisma.document.upsert({
      where,
      create: {
        ...input,
        payloadJson: JSON.parse(JSON.stringify(input.payloadJson)),
        status: input.status ?? DocumentStatus.GENERATED,
        generatedAt: new Date()
      },
      update: {
        legalType: input.legalType,
        monthKey: input.monthKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        filePath: input.filePath,
        fileName: input.fileName,
        payloadJson: JSON.parse(JSON.stringify(input.payloadJson)),
        status: updateStatus,
        generatedAt: new Date()
      },
      include: signatureUploadsInclude
    });
  }

  async findById(id: string) {
    return prisma.document.findUnique({
      where: { id },
      include: documentWithRelationsInclude
    });
  }

  async findByCreatorAndMessage(creatorUserId: string, telegramMessageId: number) {
    return prisma.document.findFirst({
      where: {
        creatorUserId,
        telegramMessageId
      },
      include: {
        creator: {
          include: creatorWithAssignmentsInclude
        }
      }
    });
  }

  async listByCreator(creatorUserId: string) {
    return prisma.document.findMany({
      where: { creatorUserId },
      include: signatureUploadsInclude,
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }

  async listPendingSignatureByCreator(creatorUserId: string) {
    return prisma.document.findMany({
      where: {
        creatorUserId,
        status: {
          in: [DocumentStatus.GENERATED, DocumentStatus.SENT_TO_CREATOR, DocumentStatus.VIEWED_BY_CREATOR]
        }
      },
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }

  async listSignatureUploadCandidatesByCreator(creatorUserId: string) {
    return prisma.document.findMany({
      where: {
        creatorUserId,
        status: {
          in: [...signatureUploadCandidateStatuses]
        }
      },
      include: signatureUploadsInclude,
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }

  async listByCreatorAndMonth(creatorUserId: string, monthKey: string) {
    return prisma.document.findMany({
      where: {
        creatorUserId,
        monthKey
      },
      include: signatureUploadsInclude,
      orderBy: { generatedAt: 'asc' }
    });
  }

  async listByCreatorIdsAndMonth(creatorIds: string[], monthKey: string) {
    return prisma.document.findMany({
      where: {
        creatorUserId: { in: creatorIds },
        monthKey
      },
      include: documentWithRelationsInclude,
      orderBy: [{ creatorUserId: 'asc' }, { generatedAt: 'asc' }]
    });
  }

  async listByIds(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    return prisma.document.findMany({
      where: {
        id: { in: ids }
      },
      include: documentWithRelationsInclude,
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }

  async updateStatus(id: string, status: DocumentStatus, extra: Partial<{
    sentAt: Date;
    forwardedAt: Date;
    signedUploadedAt: Date;
    telegramMessageId: number;
    viewedAt: Date;
  }> = {}) {
    return prisma.document.update({
      where: { id },
      data: {
        status,
        ...extra
      }
    });
  }

  async createSignatureUpload(input: {
    documentId: string;
    creatorUserId: string;
    telegramFileId?: string;
    telegramDocumentId?: string;
    originalFileName: string;
    mimeType?: string;
    filePath: string;
    uploadedAt?: Date;
    forwardedChatId?: string;
    forwardedMessageId?: number;
  }) {
    return prisma.documentSignatureUpload.create({
      data: input
    });
  }

  async updateSignatureForwardInfo(id: string, forwardedChatId: string, forwardedMessageId: number) {
    return prisma.documentSignatureUpload.update({
      where: { id },
      data: {
        forwardedChatId,
        forwardedMessageId
      }
    });
  }

  async markSignatureUploadsSuperseded(ids: string[], marker: string) {
    if (!ids.length) {
      return { count: 0 };
    }

    return prisma.documentSignatureUpload.updateMany({
      where: {
        id: { in: ids },
        forwardedChatId: null
      },
      data: {
        forwardedChatId: marker,
        forwardedMessageId: null
      }
    });
  }

  async listUnforwardedSignatureUploads() {
    return prisma.documentSignatureUpload.findMany({
      where: {
        forwardedChatId: null
      },
      include: signatureUploadWithDocumentInclude,
      orderBy: [{ creatorUserId: 'asc' }, { uploadedAt: 'asc' }]
    });
  }

  async listAllDocuments() {
    return prisma.document.findMany({
      include: documentWithRelationsInclude,
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }

  async listForSheetSync(filters: {
    creatorUserId?: string;
    creatorIds?: string[];
    monthKey?: string;
    documentIds?: string[];
  } = {}) {
    return prisma.document.findMany({
      where: {
        creatorUserId: filters.creatorUserId,
        monthKey: filters.monthKey,
        ...(filters.creatorIds?.length ? { creatorUserId: { in: filters.creatorIds } } : {}),
        ...(filters.documentIds?.length ? { id: { in: filters.documentIds } } : {})
      },
      include: documentWithRelationsInclude,
      orderBy: [{ monthKey: 'desc' }, { generatedAt: 'desc' }]
    });
  }
}
