import { SocialPlatform } from '@prisma/client';

import type { PlatformStatSummary } from '../types/report.types';
import { formatIntegerRu } from './formatters';

export type SocialMetric = 'views' | 'likes' | 'comments' | 'reposts' | 'saves';

const ALL_METRICS: SocialMetric[] = ['views', 'likes', 'comments', 'reposts', 'saves'];

const SUPPORTED_METRICS: Record<SocialPlatform, SocialMetric[]> = {
  [SocialPlatform.INSTAGRAM]: ALL_METRICS,
  [SocialPlatform.TIKTOK]: ['views', 'likes', 'comments', 'reposts'],
  [SocialPlatform.VK]: ALL_METRICS,
  [SocialPlatform.YOUTUBE]: ['views', 'likes', 'comments']
};

const METRIC_LABELS: Record<SocialMetric, string> = {
  views: 'просмотры',
  likes: 'лайки',
  comments: 'комментарии',
  reposts: 'репосты',
  saves: 'сохранения'
};

export const isSocialMetricSupported = (platform: SocialPlatform, metric: SocialMetric) =>
  SUPPORTED_METRICS[platform].includes(metric);

export const formatPlatformStatMetrics = (item: PlatformStatSummary) =>
  SUPPORTED_METRICS[item.platform]
    .map((metric) => `${METRIC_LABELS[metric]} ${formatIntegerRu(item[metric])}`)
    .join(', ');
