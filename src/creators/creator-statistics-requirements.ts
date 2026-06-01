import { container } from '../container';
import { getCreatorInvoiceMonthKey } from '../documents/document-workflow.constants';

export const getRequiredSecondQueueMonthKey = () => getCreatorInvoiceMonthKey();
export const MIN_REQUIRED_SECOND_QUEUE_SCREENSHOT_COUNT = 1;

export interface RequiredSecondQueueStatisticsStatus {
  monthKey: string;
  monthlyVideoSubmitted: boolean;
  hasReach: boolean;
  screenshotCount: number;
  requiredScreenshotCount: number;
  isReady: boolean;
}

export const getRequiredSecondQueueStatisticsStatus = async (
  creatorUserId: string
): Promise<RequiredSecondQueueStatisticsStatus> => {
  const monthKey = getRequiredSecondQueueMonthKey();
  const [monthlyVideo, reports] = await Promise.all([
    container.services.monthlyVideoService.getMonthCount(creatorUserId, monthKey),
    container.repositories.weeklyStatsRepository.listReportsByCreatorAndMonth(
      creatorUserId,
      monthKey,
      { submittedOnly: true }
    )
  ]);

  const platformsWithReach = new Set(
    reports.flatMap((report) =>
      report.items
        .filter((item) => item.views > 0)
        .map((item) => item.platform)
    )
  );
  const hasReach = platformsWithReach.size > 0;
  const screenshotCount = reports.reduce((sum, report) => sum + report.attachments.length, 0);
  const requiredScreenshotCount = Math.max(
    MIN_REQUIRED_SECOND_QUEUE_SCREENSHOT_COUNT,
    platformsWithReach.size
  );
  const hasScreenshots = screenshotCount >= requiredScreenshotCount;
  const monthlyVideoSubmitted = Boolean(monthlyVideo);

  return {
    monthKey,
    monthlyVideoSubmitted,
    hasReach,
    screenshotCount,
    requiredScreenshotCount,
    isReady: monthlyVideoSubmitted && hasReach && hasScreenshots
  };
};

export const formatRequiredSecondQueueStatisticsMissingLines = (
  status: RequiredSecondQueueStatisticsStatus
) =>
  [
    status.monthlyVideoSubmitted ? null : `- укажи количество видео за ${status.monthKey}`,
    status.hasReach ? null : `- внеси охваты за ${status.monthKey}`,
    !status.hasReach || status.screenshotCount >= status.requiredScreenshotCount
      ? null
      : `- отправь ${status.requiredScreenshotCount} скрина статистики за ${status.monthKey} (${status.screenshotCount}/${status.requiredScreenshotCount})`
  ].filter((line): line is string => Boolean(line));
