import type { SocialPlatform } from '@prisma/client';

export interface PeriodRange {
  monthKey?: string;
  dateFrom: string;
  dateTo: string;
}

export interface PlatformStatSummary {
  platform: SocialPlatform;
  videoCount: number;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
}

export interface WeeklyStatSummary {
  reportId: string;
  creatorUserId: string;
  monthKey: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  totalVideoCount: number;
  isReviewedByTeamLead: boolean;
  reviewedByTeamLeadId?: string;
  reviewedByTeamLeadName?: string;
  reviewedAt?: string;
  attachmentCount: number;
  attachments: Array<{
    id: string;
    telegramFileId: string;
    telegramFileUniqueId?: string;
    filePath?: string;
    sortOrder: number;
    uploadedAt: string;
  }>;
  items: PlatformStatSummary[];
  totals: Omit<PlatformStatSummary, 'platform'>;
}

export interface WeeklyReportReviewSummary {
  reportId: string;
  creatorUserId: string;
  monthKey: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  isReviewedByTeamLead: boolean;
  reviewedByTeamLeadId?: string;
  reviewedByTeamLeadName?: string;
  reviewedAt?: string;
  attachmentCount: number;
  totalVideoCount: number;
  isTemporaryReachBackfill?: boolean;
  totals: Omit<PlatformStatSummary, 'platform'>;
  items: PlatformStatSummary[];
}

export interface MonthlyAggregationSummary {
  creatorUserId: string;
  monthKey: string;
  period: PeriodRange;
  weeklyReportCount: number;
  isTemporaryReachBackfill?: boolean;
  totals: Omit<PlatformStatSummary, 'platform'>;
  platformBreakdown: PlatformStatSummary[];
  monthlyVideoCount: number;
  monthlyVideoSubmitted: boolean;
}

export interface RoundingSummary {
  rawViews: number;
  roundedViews: number;
  roundingApplied: boolean;
  roundingReason: string;
  step: number;
  upThreshold: number;
}

export interface PaymentCalculationSummary extends RoundingSummary {
  monthKey: string;
  creatorUserId: string;
  targetVideoCount: number;
  baseSalary: number;
  fixedRatePerVideo?: number;
  fixedSalaryCap?: number;
  actualVideoCount: number;
  fixedSalaryPart: number;
  viewSteps: number;
  appliedRate: number;
  variablePart: number;
  totalPayment: number;
  platformBreakdown: PlatformStatSummary[];
  generatedAt: string;
}

export interface CreatorReportSummary {
  creatorUserId: string;
  monthKey?: string;
  label: string;
  aggregation: MonthlyAggregationSummary;
  payment: PaymentCalculationSummary;
  weeklyReports: WeeklyReportReviewSummary[];
}

export interface TeamLeadCreatorReportEntry {
  creatorUserId: string;
  creatorName: string;
  monthKey: string;
  totals: Omit<PlatformStatSummary, 'platform'>;
  totalPayment: number;
  weeklyReportCount?: number;
  monthlyVideoCount?: number;
  monthlyVideoSubmitted?: boolean;
  payment?: PaymentCalculationSummary;
  baseTotalPayment?: number;
  invoiceSurcharge?: number;
  invoiceTotalPayment?: number;
  invoiceUploadedAt?: string | null;
  invoiceFileName?: string | null;
  receiptUploadedAt?: string | null;
  receiptFileName?: string | null;
  calculationError?: string;
}

export interface TeamLeadGroupReportSummary {
  teamLeadUserId: string;
  monthKey: string;
  totals: Omit<PlatformStatSummary, 'platform'>;
  totalPayment: number;
  creators: TeamLeadCreatorReportEntry[];
  weeklyReports: WeeklyReportReviewSummary[];
}

export interface AdminReportSummary {
  monthKey: string;
  totals: Omit<PlatformStatSummary, 'platform'>;
  totalPayment: number;
  creators: TeamLeadCreatorReportEntry[];
  teamLeads: Array<{
    teamLeadUserId: string;
    teamLeadName: string;
    creatorCount: number;
    totalPayment: number;
  }>;
}

export type WeeklyDisciplineStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'NO_DATA';

export interface CreatorWeeklyDisciplineSummary {
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  weekStart: string;
  weekEnd: string;
  monthKey: string;
  status: WeeklyDisciplineStatus;
  itemCount: number;
  reportId?: string;
  submittedAt?: string;
  updatedAt?: string;
}

export interface CreatorMonthlyVideoStatusSummary {
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  status: 'SUBMITTED' | 'MISSING';
  videoCount?: number;
  submittedAt?: string;
  updatedAt?: string;
}

export interface RequiredDocumentStatusSummary {
  type: string;
  monthKey?: string;
  required: boolean;
  generated: boolean;
  signed: boolean;
  status: string;
  fileName?: string;
}

export interface CreatorDocumentStatusSummary {
  creatorUserId: string;
  creatorName: string;
  teamLeadName: string;
  monthKey: string;
  oneOff: RequiredDocumentStatusSummary[];
  monthly: RequiredDocumentStatusSummary[];
  missingGeneratedCount: number;
  missingSignedCount: number;
  hasMissingSignedDocuments: boolean;
}

export interface DailyPublicationAttentionItem {
  creatorUserId: string;
  creatorName: string;
  checkDate: string;
  status: string;
}

export interface TeamLeadAttentionSummary {
  teamLeadUserId: string;
  monthKey: string;
  weekStart: string;
  weekEnd: string;
  creatorsTotal: number;
  missingPublicationConfirmations: DailyPublicationAttentionItem[];
  weeklyStatsAttention: CreatorWeeklyDisciplineSummary[];
  monthlyVideoMissing: CreatorMonthlyVideoStatusSummary[];
  documentsMissing: CreatorDocumentStatusSummary[];
}

export interface AdminDashboardSummary {
  monthKey: string;
  weekStart: string;
  weekEnd: string;
  activeCreators: number;
  teamLeads: number;
  weeklyReportsSubmitted: number;
  weeklyReportsAbsent: number;
  monthlyVideosSubmitted: number;
  monthlyVideosMissing: number;
  documentsGenerated: number;
  documentsSigned: number;
  documentsNotReturned: number;
  totalPayment: number;
}

export interface BulkOperationResult {
  operation: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  details: string[];
}
