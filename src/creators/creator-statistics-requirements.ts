import { SocialPlatform } from '@prisma/client';

import { container } from '../container';
import { CREATOR_INVOICE_MONTH_KEY } from '../documents/document-workflow.constants';

export const REQUIRED_SECOND_QUEUE_MONTH_KEY = CREATOR_INVOICE_MONTH_KEY;
export const REQUIRED_SECOND_QUEUE_SCREENSHOT_COUNT = Object.values(SocialPlatform).length;

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
  const [monthlyVideo, reports] = await Promise.all([
    container.services.monthlyVideoService.getMonthCount(creatorUserId, REQUIRED_SECOND_QUEUE_MONTH_KEY),
    container.repositories.weeklyStatsRepository.listReportsByCreatorAndMonth(
      creatorUserId,
      REQUIRED_SECOND_QUEUE_MONTH_KEY,
      { submittedOnly: true }
    )
  ]);

  const hasReach = reports.some((report) => report.items.some((item) => item.views > 0));
  const screenshotCount = reports.reduce((sum, report) => sum + report.attachments.length, 0);
  const hasScreenshots = screenshotCount >= REQUIRED_SECOND_QUEUE_SCREENSHOT_COUNT;
  const monthlyVideoSubmitted = Boolean(monthlyVideo);

  return {
    monthKey: REQUIRED_SECOND_QUEUE_MONTH_KEY,
    monthlyVideoSubmitted,
    hasReach,
    screenshotCount,
    requiredScreenshotCount: REQUIRED_SECOND_QUEUE_SCREENSHOT_COUNT,
    isReady: monthlyVideoSubmitted && hasReach && hasScreenshots
  };
};

export const formatRequiredSecondQueueStatisticsMissingLines = (
  status: RequiredSecondQueueStatisticsStatus
) =>
  [
    status.monthlyVideoSubmitted ? null : '- укажи количество видео за апрель',
    status.hasReach ? null : '- внеси охваты за апрель',
    status.screenshotCount >= status.requiredScreenshotCount
      ? null
      : `- отправь ${status.requiredScreenshotCount} скрина статистики за апрель (${status.screenshotCount}/${status.requiredScreenshotCount})`
  ].filter((line): line is string => Boolean(line));
