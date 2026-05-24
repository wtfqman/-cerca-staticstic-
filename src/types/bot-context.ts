import type { Scenes } from 'telegraf';
import type { Context } from 'telegraf';

import type { AppUser } from './domain';

export interface BotSessionData extends Scenes.WizardSessionData {
  pendingDocumentId?: string;
  adminGroupAssignCreatorId?: string;
  adminGroupAssignTeamLeadId?: string;
  adminCreatorLookupPurpose?: 'profile' | 'revoke' | 'restore';
  adminCreatorLookupMode?: 'telegramId' | 'username';
  teamLeadGroupAssignCreatorId?: string;
  adminFileInfoMode?: boolean;
}

export interface BotContext extends Context, Scenes.WizardContext<BotSessionData> {
  state: Context['state'] & {
    currentUser?: AppUser | null;
    requestId?: string;
  };
}
