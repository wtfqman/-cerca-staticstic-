import { Markup } from 'telegraf';

import { ADMIN_MENU, CREATOR_MENU, TEAMLEAD_MENU } from './menu-labels';
import {
  canUseAdminAndTeamLeadScenarios,
  canUseAdminScenario,
  canUseCreatorAndTeamLeadScenarios,
  canUseCreatorScenario,
  canUseTeamLeadScenario,
  type AccessUser
} from '../utils/access';
import { isMarchAprilStatisticsScenario } from '../utils/creator-statistics-scenario';

const creatorStatisticsRows = (user?: AccessUser | null) =>
  isMarchAprilStatisticsScenario(user)
    ? [
        [CREATOR_MENU.weeklyStats],
        [CREATOR_MENU.monthlyVideos],
        [CREATOR_MENU.monthlyVideosMarchApril],
        [CREATOR_MENU.monthlyReachMarchApril]
      ]
    : [
        [CREATOR_MENU.weeklyStats, CREATOR_MENU.monthlyVideos]
      ];

export const creatorMenuKeyboard = (user?: AccessUser | null) =>
  Markup.keyboard([
    [CREATOR_MENU.profile, CREATOR_MENU.stats],
    ...creatorStatisticsRows(user),
    [CREATOR_MENU.reports, CREATOR_MENU.documents],
    [CREATOR_MENU.uploadSigned, CREATOR_MENU.socialLinks],
    [CREATOR_MENU.help]
  ]).resize();

export const teamLeadMenuKeyboard = () =>
  Markup.keyboard([
    [TEAMLEAD_MENU.group, TEAMLEAD_MENU.groupReport],
    [TEAMLEAD_MENU.creatorReport, TEAMLEAD_MENU.missedChecks],
    [TEAMLEAD_MENU.missingStats, TEAMLEAD_MENU.missingDocuments],
    [TEAMLEAD_MENU.attention, TEAMLEAD_MENU.help]
  ]).resize();

export const creatorTeamLeadMenuKeyboard = (user?: AccessUser | null) =>
  Markup.keyboard([
    [CREATOR_MENU.profile, CREATOR_MENU.stats],
    ...creatorStatisticsRows(user),
    [CREATOR_MENU.reports, CREATOR_MENU.documents],
    [CREATOR_MENU.uploadSigned, CREATOR_MENU.socialLinks],
    [TEAMLEAD_MENU.group, TEAMLEAD_MENU.groupReport],
    [TEAMLEAD_MENU.creatorReport, TEAMLEAD_MENU.missedChecks],
    [TEAMLEAD_MENU.missingStats, TEAMLEAD_MENU.missingDocuments],
    [TEAMLEAD_MENU.attention, CREATOR_MENU.help]
  ]).resize();

export const adminMenuKeyboard = () =>
  Markup.keyboard([
    [ADMIN_MENU.creators, ADMIN_MENU.teamLeads],
    [ADMIN_MENU.groups, ADMIN_MENU.stats],
    [ADMIN_MENU.payments, ADMIN_MENU.documents],
    [ADMIN_MENU.googleSheets, ADMIN_MENU.bulkActions],
    [ADMIN_MENU.service, ADMIN_MENU.creatorTest],
    [ADMIN_MENU.attention, ADMIN_MENU.help]
  ]).resize();

export const adminTeamLeadMenuKeyboard = () =>
  Markup.keyboard([
    [ADMIN_MENU.creators, ADMIN_MENU.teamLeads],
    [ADMIN_MENU.groups, ADMIN_MENU.stats],
    [ADMIN_MENU.payments, ADMIN_MENU.documents],
    [ADMIN_MENU.googleSheets, ADMIN_MENU.bulkActions],
    [ADMIN_MENU.service, ADMIN_MENU.creatorTest],
    [ADMIN_MENU.attention],
    [TEAMLEAD_MENU.group, TEAMLEAD_MENU.groupReport],
    [TEAMLEAD_MENU.creatorReport, TEAMLEAD_MENU.missedChecks],
    [TEAMLEAD_MENU.missingStats, TEAMLEAD_MENU.missingDocuments],
    [TEAMLEAD_MENU.attention, ADMIN_MENU.help]
  ]).resize();

export const adminCreatorTestMenuKeyboard = (user?: AccessUser | null) =>
  Markup.keyboard([
    [CREATOR_MENU.profile, CREATOR_MENU.stats],
    ...creatorStatisticsRows(user),
    [CREATOR_MENU.reports, CREATOR_MENU.documents],
    [CREATOR_MENU.uploadSigned, CREATOR_MENU.socialLinks],
    [ADMIN_MENU.adminMenu, CREATOR_MENU.help]
  ]).resize();

export const mainMenuKeyboardForUser = (user?: AccessUser | null) => {
  if (canUseAdminAndTeamLeadScenarios(user)) {
    return adminTeamLeadMenuKeyboard();
  }

  if (canUseAdminScenario(user)) {
    return adminMenuKeyboard();
  }

  if (canUseCreatorAndTeamLeadScenarios(user)) {
    return creatorTeamLeadMenuKeyboard(user);
  }

  if (canUseCreatorScenario(user)) {
    return creatorMenuKeyboard(user);
  }

  if (canUseTeamLeadScenario(user)) {
    return teamLeadMenuKeyboard();
  }

  return undefined;
};

export const mainMenuTextForUser = (user?: AccessUser | null) => {
  if (canUseAdminAndTeamLeadScenarios(user)) {
    return [
      'Главное меню: администратор и тимлид.',
      'Сверху - разделы администратора.',
      'Ниже - разделы тимлида.'
    ].join('\n');
  }

  if (canUseAdminScenario(user)) {
    return 'Главное меню администратора.';
  }

  if (canUseCreatorAndTeamLeadScenarios(user)) {
    return [
      'Главное меню: креатор и тимлид.',
      'Сверху - личные разделы креатора.',
      'Ниже - разделы тимлида.'
    ].join('\n');
  }

  if (canUseCreatorScenario(user)) {
    return 'Главное меню креатора.';
  }

  if (canUseTeamLeadScenario(user)) {
    return 'Главное меню тимлида.';
  }

  return 'Главное меню.';
};

export const cancelSceneKeyboard = () => Markup.keyboard([['/cancel']]).resize();
