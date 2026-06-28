import type { Dayjs } from 'dayjs';

import { dayjs } from '../lib/dayjs';

export interface WeeklyReportPeriod {
  weekStart: string;
  weekEnd: string;
  monthKey: string;
}

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

const minDayjs = (left: Dayjs, right: Dayjs) => left.isBefore(right) ? left : right;

const splitPeriodByMonth = (weekStart: Dayjs, weekEnd: Dayjs): WeeklyReportPeriod[] => {
  const periods: WeeklyReportPeriod[] = [];
  let cursor = weekStart.startOf('day');
  const end = weekEnd.startOf('day');

  while (!cursor.isAfter(end)) {
    const segmentEnd = minDayjs(cursor.endOf('month').startOf('day'), end);

    periods.push({
      weekStart: cursor.format('YYYY-MM-DD'),
      weekEnd: segmentEnd.format('YYYY-MM-DD'),
      monthKey: cursor.format('YYYY-MM')
    });

    cursor = segmentEnd.add(1, 'day').startOf('day');
  }

  return periods;
};

const uniquePeriods = (periods: WeeklyReportPeriod[]) => {
  const seen = new Set<string>();

  return periods.filter((period) => {
    const key = `${period.weekStart}:${period.weekEnd}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const getWeeklyReportPeriodCandidates = (referenceDate: Dayjs = getNow()): WeeklyReportPeriod[] => {
  const currentWeekStart = referenceDate.startOf('isoWeek');
  const currentMonthStart = referenceDate.startOf('month');
  const weekEnd = referenceDate.startOf('isoWeek').subtract(1, 'day');
  const weekStart = weekEnd.subtract(6, 'day');
  const previousWeekPeriods = splitPeriodByMonth(weekStart, weekEnd);
  const currentWeekPreviousMonthTail = currentWeekStart.isBefore(currentMonthStart)
    ? splitPeriodByMonth(currentWeekStart, currentMonthStart.subtract(1, 'day'))
    : [];

  return uniquePeriods([...previousWeekPeriods, ...currentWeekPreviousMonthTail]);
};

export const getWeeklyReportPeriod = (referenceDate: Dayjs = getNow()): WeeklyReportPeriod => {
  const periods = getWeeklyReportPeriodCandidates(referenceDate);

  return periods[periods.length - 1];
};

export const getWeeklyReportPeriodsForMonth = (monthKey: string): WeeklyReportPeriod[] => {
  const monthStart = dayjs.tz(`${monthKey}-01`).startOf('month');
  const monthEnd = monthStart.endOf('month').startOf('day');
  let cursor = monthStart.startOf('isoWeek');
  const periods: WeeklyReportPeriod[] = [];

  while (!cursor.isAfter(monthEnd)) {
    const rawWeekEnd = cursor.endOf('isoWeek').startOf('day');
    const weekStart = cursor.isBefore(monthStart) ? monthStart : cursor;
    const weekEnd = rawWeekEnd.isAfter(monthEnd) ? monthEnd : rawWeekEnd;

    periods.push({
      weekStart: weekStart.format('YYYY-MM-DD'),
      weekEnd: weekEnd.format('YYYY-MM-DD'),
      monthKey
    });

    cursor = cursor.add(1, 'week').startOf('isoWeek');
  }

  return periods;
};

export const formatPeriodLabel = (dateFrom: string, dateTo: string): string => {
  const from = dayjs.tz(dateFrom).format('DD.MM.YYYY');
  const to = dayjs.tz(dateTo).format('DD.MM.YYYY');
  return `${from} - ${to}`;
};
