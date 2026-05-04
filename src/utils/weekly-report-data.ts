import { WeeklyReportStatus } from '@prisma/client';

type WeeklyReportDataLike = {
  status: WeeklyReportStatus | string;
  totalVideoCount?: number | null;
  attachments?: unknown[];
  items: Array<{
    videoCount: number;
    views: number;
    likes: number;
    comments: number;
    reposts: number;
    saves: number;
  }>;
};

const hasItemData = (item: WeeklyReportDataLike['items'][number]) =>
  item.videoCount > 0 ||
  item.views > 0 ||
  item.likes > 0 ||
  item.comments > 0 ||
  item.reposts > 0 ||
  item.saves > 0;

export const hasWeeklyReportData = (report: WeeklyReportDataLike) => {
  if (report.status !== WeeklyReportStatus.DRAFT) {
    return true;
  }

  return (
    (report.totalVideoCount ?? 0) > 0 ||
    (report.attachments?.length ?? 0) > 0 ||
    report.items.some(hasItemData)
  );
};
