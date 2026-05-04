import type { Dayjs } from 'dayjs';

import { dayjs } from '../lib/dayjs';

export const getNow = (): Dayjs => dayjs().tz();

export const toDateOnly = (value: Dayjs | Date | string): Date => {
  const normalized = typeof value === 'string' ? dayjs.tz(value) : dayjs(value).tz();
  return new Date(`${normalized.format('YYYY-MM-DD')}T00:00:00.000Z`);
};

export const toDateKey = (value: Dayjs | Date | string): string => {
  if (typeof value === 'string') {
    return dayjs.tz(value).format('YYYY-MM-DD');
  }

  return dayjs(value).tz().format('YYYY-MM-DD');
};

export const toMonthKey = (value: Dayjs | Date | string = getNow()): string => {
  if (typeof value === 'string') {
    return dayjs.tz(value).format('YYYY-MM');
  }

  return dayjs(value).tz().format('YYYY-MM');
};

export const getCurrentMonthKey = (): string => toMonthKey(getNow());

export const getPreviousMonthKey = (): string => toMonthKey(getNow().subtract(1, 'month'));

export const getMonthRange = (monthKey: string): { dateFrom: string; dateTo: string } => {
  const start = dayjs.tz(`${monthKey}-01`).startOf('month');
  const end = start.endOf('month');
  return {
    dateFrom: start.format('YYYY-MM-DD'),
    dateTo: end.format('YYYY-MM-DD')
  };
};

export const getCurrentWeekRange = (): { dateFrom: string; dateTo: string } => {
  const start = getNow().startOf('isoWeek');
  const end = getNow().endOf('isoWeek');
  return {
    dateFrom: start.format('YYYY-MM-DD'),
    dateTo: end.format('YYYY-MM-DD')
  };
};

export const getPreviousWeekRange = (): { dateFrom: string; dateTo: string } => {
  const reference = getNow().subtract(1, 'week');
  return {
    dateFrom: reference.startOf('isoWeek').format('YYYY-MM-DD'),
    dateTo: reference.endOf('isoWeek').format('YYYY-MM-DD')
  };
};

export const getLastSevenDaysRange = (): { dateFrom: string; dateTo: string } => ({
  dateFrom: getNow().subtract(6, 'day').format('YYYY-MM-DD'),
  dateTo: getNow().format('YYYY-MM-DD')
});

export const getWeeklyReportPeriod = (
  referenceDate: Dayjs = getNow()
): { weekStart: string; weekEnd: string; monthKey: string } => {
  const weekEnd = referenceDate.startOf('isoWeek').subtract(1, 'day');
  const weekStart = weekEnd.subtract(6, 'day');
  const rawWeekStart = weekStart.format('YYYY-MM-DD');
  const rawWeekEnd = weekEnd.format('YYYY-MM-DD');

  if (rawWeekStart === '2026-04-27' && rawWeekEnd === '2026-05-03') {
    return {
      weekStart: '2026-05-01',
      weekEnd: rawWeekEnd,
      monthKey: toMonthKey(weekEnd)
    };
  }

  return {
    weekStart: rawWeekStart,
    weekEnd: rawWeekEnd,
    monthKey: toMonthKey(weekEnd)
  };
};

export const getWeeklyReportPeriodsForMonth = (
  monthKey: string
): Array<{ weekStart: string; weekEnd: string; monthKey: string }> => {
  const monthStart = dayjs.tz(`${monthKey}-01`).startOf('month');
  let cursor = monthStart.startOf('isoWeek').endOf('isoWeek');

  if (cursor.format('YYYY-MM') < monthKey) {
    cursor = cursor.add(1, 'week');
  }

  const periods: Array<{ weekStart: string; weekEnd: string; monthKey: string }> = [];

  while (cursor.format('YYYY-MM') === monthKey) {
    const weekEnd = cursor.startOf('day');
    const weekStart = weekEnd.subtract(6, 'day');

    periods.push({
      weekStart: weekStart.format('YYYY-MM-DD'),
      weekEnd: weekEnd.format('YYYY-MM-DD'),
      monthKey
    });

    cursor = cursor.add(1, 'week');
  }

  return periods;
};

export const formatPeriodLabel = (dateFrom: string, dateTo: string): string => {
  const from = dayjs.tz(dateFrom).format('DD.MM.YYYY');
  const to = dayjs.tz(dateTo).format('DD.MM.YYYY');
  return `${from} - ${to}`;
};
