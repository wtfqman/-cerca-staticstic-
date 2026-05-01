import { config } from './config';
import { CreatorProfileRepository } from './repositories/creator-profile.repository';
import { CreatorProfileChangeRequestRepository } from './repositories/creator-profile-change-request.repository';
import { DailyCheckRepository } from './repositories/daily-check.repository';
import { DocumentRepository } from './repositories/document.repository';
import { DocumentWorkflowRepository } from './repositories/document-workflow.repository';
import { MonthlyVideoRepository } from './repositories/monthly-video.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { PaymentSnapshotRepository } from './repositories/payment-snapshot.repository';
import { TeamLeadRepository } from './repositories/teamlead.repository';
import { UserRepository } from './repositories/user.repository';
import { WeeklyStatsRepository } from './repositories/weekly-stats.repository';
import { AdminReportService } from './services/admin-report.service';
import { AdminService } from './services/admin.service';
import { AdminBulkOperationsService } from './services/admin-bulk-operations.service';
import { AuthService } from './services/auth.service';
import { CreatorDisciplineService } from './services/creator-discipline.service';
import { CreatorProfileService } from './services/creator-profile.service';
import { CreatorProfileChangeRequestService } from './services/creator-profile-change-request.service';
import { CreatorReportService } from './services/creator-report.service';
import { DashboardSummaryService } from './services/dashboard-summary.service';
import { DailyCheckService } from './services/daily-check.service';
import { DocumentStatusService } from './services/document-status.service';
import { DocumentPayloadBuilderService } from './services/document-payload-builder.service';
import { DocumentService } from './services/document.service';
import { DocumentUploadService } from './services/document-upload.service';
import { DocumentWorkflowService } from './services/document-workflow.service';
import { DocxPdfService } from './services/docx-pdf.service';
import { DocxTemplateRenderService } from './services/docx-template-render.service';
import { DocumentsSheetSyncService } from './services/documents-sheet-sync.service';
import { FileStorageService } from './services/file-storage.service';
import { GoogleSheetsClient } from './services/google-sheets-client';
import { GoogleSheetsService } from './services/google-sheets.service';
import { GoogleSheetsSyncService } from './services/google-sheets-sync.service';
import { MonthlyAggregationService } from './services/monthly-aggregation.service';
import { MonthlyVideoService } from './services/monthly-video.service';
import { NotificationService } from './services/notification.service';
import { PaymentCalculationService } from './services/payment-calculation.service';
import { PaymentDocumentUploadService } from './services/payment-document-upload.service';
import { PaymentsSheetSyncService } from './services/payments-sheet-sync.service';
import { PdfGeneratorService } from './services/pdf-generator.service';
import { SpreadsheetFormatterService } from './services/spreadsheet-formatter.service';
import { StatsSheetSyncService } from './services/stats-sheet-sync.service';
import { TeamLeadReportService } from './services/teamlead-report.service';
import { TeamLeadService } from './services/teamlead.service';
import { TemplateRenderService } from './services/template-render.service';
import { UserService } from './services/user.service';
import { WeeklyStatsService } from './services/weekly-stats.service';

const userRepository = new UserRepository();
const creatorProfileRepository = new CreatorProfileRepository();
const creatorProfileChangeRequestRepository = new CreatorProfileChangeRequestRepository();
const teamLeadRepository = new TeamLeadRepository();
const dailyCheckRepository = new DailyCheckRepository();
const weeklyStatsRepository = new WeeklyStatsRepository();
const monthlyVideoRepository = new MonthlyVideoRepository();
const notificationRepository = new NotificationRepository();
const paymentSnapshotRepository = new PaymentSnapshotRepository();
const documentRepository = new DocumentRepository();
const documentWorkflowRepository = new DocumentWorkflowRepository();

const authService = new AuthService(userRepository, config.admin.telegramIds);
const userService = new UserService(userRepository);
const creatorProfileService = new CreatorProfileService(
  creatorProfileRepository,
  userRepository,
  teamLeadRepository
);
const creatorProfileChangeRequestService = new CreatorProfileChangeRequestService(
  creatorProfileChangeRequestRepository,
  userRepository,
  teamLeadRepository
);
const monthlyAggregationService = new MonthlyAggregationService(weeklyStatsRepository, monthlyVideoRepository);
const paymentCalculationService = new PaymentCalculationService(
  monthlyAggregationService,
  paymentSnapshotRepository
);
const googleSheetsClient = new GoogleSheetsClient();
const googleSheetsService = new GoogleSheetsService(googleSheetsClient);
const spreadsheetFormatterService = new SpreadsheetFormatterService();
const statsSheetSyncService = new StatsSheetSyncService(
  weeklyStatsRepository,
  googleSheetsService,
  spreadsheetFormatterService
);
const paymentsSheetSyncService = new PaymentsSheetSyncService(
  userRepository,
  weeklyStatsRepository,
  monthlyVideoRepository,
  paymentCalculationService,
  googleSheetsService,
  spreadsheetFormatterService
);
const documentsSheetSyncService = new DocumentsSheetSyncService(
  documentRepository,
  googleSheetsService,
  spreadsheetFormatterService
);
const googleSheetsSyncService = new GoogleSheetsSyncService(
  googleSheetsService,
  statsSheetSyncService,
  paymentsSheetSyncService,
  documentsSheetSyncService
);
const fileStorageService = new FileStorageService();
const monthlyVideoService = new MonthlyVideoService(monthlyVideoRepository, googleSheetsSyncService);
const weeklyStatsService = new WeeklyStatsService(
  weeklyStatsRepository,
  fileStorageService,
  googleSheetsSyncService
);
const creatorReportService = new CreatorReportService(
  monthlyAggregationService,
  paymentCalculationService,
  weeklyStatsRepository
);
const teamLeadReportService = new TeamLeadReportService(
  teamLeadRepository,
  weeklyStatsRepository,
  monthlyAggregationService,
  paymentCalculationService
);
const adminReportService = new AdminReportService(
  userRepository,
  teamLeadRepository,
  monthlyAggregationService,
  paymentCalculationService,
  weeklyStatsRepository
);
const notificationService = new NotificationService(notificationRepository);
const creatorDisciplineService = new CreatorDisciplineService(weeklyStatsRepository, monthlyVideoRepository);
const documentStatusService = new DocumentStatusService(documentRepository);
const teamLeadService = new TeamLeadService(
  teamLeadRepository,
  dailyCheckRepository,
  creatorDisciplineService,
  documentStatusService
);
const adminService = new AdminService(userRepository, teamLeadRepository, documentRepository);
const dashboardSummaryService = new DashboardSummaryService(
  userRepository,
  creatorDisciplineService,
  documentStatusService,
  paymentCalculationService
);
const templateRenderService = new TemplateRenderService();
const pdfGeneratorService = new PdfGeneratorService();
const docxPdfService = new DocxPdfService(pdfGeneratorService);
const docxTemplateRenderService = new DocxTemplateRenderService(docxPdfService);
const documentPayloadBuilderService = new DocumentPayloadBuilderService(
  userRepository,
  monthlyAggregationService,
  paymentCalculationService
);
const documentWorkflowService = new DocumentWorkflowService(
  documentWorkflowRepository,
  documentRepository
);
const documentService = new DocumentService(
  documentRepository,
  documentPayloadBuilderService,
  docxTemplateRenderService,
  fileStorageService,
  notificationService,
  googleSheetsSyncService,
  documentWorkflowService
);
const documentUploadService = new DocumentUploadService(
  documentRepository,
  fileStorageService,
  googleSheetsSyncService,
  documentWorkflowService
);
const paymentDocumentUploadService = new PaymentDocumentUploadService(
  fileStorageService,
  documentWorkflowService
);
const dailyCheckService = new DailyCheckService(
  userRepository,
  dailyCheckRepository,
  teamLeadRepository,
  notificationRepository
);
const adminBulkOperationsService = new AdminBulkOperationsService(
  userRepository,
  creatorDisciplineService,
  documentStatusService,
  documentService,
  documentWorkflowService,
  notificationService,
  googleSheetsSyncService
);

export const container = {
  repositories: {
    userRepository,
    creatorProfileRepository,
    creatorProfileChangeRequestRepository,
    teamLeadRepository,
    dailyCheckRepository,
    weeklyStatsRepository,
    monthlyVideoRepository,
    notificationRepository,
    paymentSnapshotRepository,
    documentRepository,
    documentWorkflowRepository
  },
  services: {
    authService,
    userService,
    creatorProfileService,
    creatorProfileChangeRequestService,
    monthlyVideoService,
    weeklyStatsService,
    creatorDisciplineService,
    documentStatusService,
    monthlyAggregationService,
    paymentCalculationService,
    creatorReportService,
    teamLeadReportService,
    adminReportService,
    dashboardSummaryService,
    notificationService,
    teamLeadService,
    adminService,
    adminBulkOperationsService,
    fileStorageService,
    documentPayloadBuilderService,
    templateRenderService,
    pdfGeneratorService,
    docxPdfService,
    docxTemplateRenderService,
    documentWorkflowService,
    documentService,
    documentUploadService,
    paymentDocumentUploadService,
    dailyCheckService,
    googleSheetsClient,
    googleSheetsService,
    spreadsheetFormatterService,
    statsSheetSyncService,
    paymentsSheetSyncService,
    documentsSheetSyncService,
    googleSheetsSyncService
  }
};
