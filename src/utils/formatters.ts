import { dayjs } from '../lib/dayjs';

export const formatRussianDate = (value?: Date | string | null): string => {
  if (!value) {
    return '—';
  }

  return dayjs(value).tz().format('DD.MM.YYYY');
};

export const formatMoneyRu = (value: number): string =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(value);

export const formatIntegerRu = (value: number): string =>
  new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  }).format(value);

export const formatPassportSeriesNumber = (series?: string | null, number?: string | null): string => {
  if (!series || !number) {
    return '—';
  }

  return `${series} ${number}`;
};

export const formatFullName = (
  firstName?: string | null,
  lastName?: string | null,
  fallback = 'Без имени'
): string => {
  const value = [firstName, lastName].filter(Boolean).join(' ').trim();
  return value || fallback;
};

type PersonLike = {
  firstName?: string | null;
  lastName?: string | null;
  telegramId?: string | null;
};

type CreatorLike = PersonLike & {
  creatorProfile?: {
    fullName?: string | null;
  } | null;
};

type TeamLeadLike = PersonLike & {
  isActive?: boolean | null;
  teamLeadProfile?: {
    displayName?: string | null;
  } | null;
};

type CreatorAssignmentLike = {
  creatorAssignments?: Array<{
    teamLead: TeamLeadLike;
  }>;
};

export const formatCreatorDisplayName = (creator: CreatorLike, fallback = 'Креатор'): string =>
  creator.creatorProfile?.fullName ?? formatFullName(creator.firstName, creator.lastName, creator.telegramId ?? fallback);

export const formatTeamLeadDisplayName = (teamLead: TeamLeadLike, fallback = 'Тимлид'): string =>
  teamLead.teamLeadProfile?.displayName ??
  formatFullName(teamLead.firstName, teamLead.lastName, teamLead.telegramId ?? fallback);

export const formatAssignedTeamLeadName = (
  creator: CreatorAssignmentLike,
  fallback = 'Без тимлида'
): string => {
  const teamLead = creator.creatorAssignments?.find((assignment) => assignment.teamLead.isActive !== false)?.teamLead;
  return teamLead ? formatTeamLeadDisplayName(teamLead, fallback) : fallback;
};

export const formatMonthLabelRu = (monthKey: string): string => {
  const month = dayjs.tz(`${monthKey}-01`);
  return month.format('MMMM YYYY');
};

export const formatIsoDateTime = (value?: Date | string | null): string => {
  if (!value) {
    return '';
  }

  return dayjs(value).tz().toISOString();
};

export const formatRussianDateTime = (value?: Date | string | null): string => {
  if (!value) {
    return '';
  }

  return dayjs(value).tz().format('DD.MM.YYYY HH:mm');
};
