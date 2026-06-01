export interface KnownUserInput {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean;
}

export interface KnownTeamLeadInput extends KnownUserInput {
  displayName?: string | null;
}

export interface KnownAdminInput extends KnownUserInput {}

export interface KnownCreatorInput extends KnownUserInput {
  removeTeamLeadProfile?: boolean;
  deactivateTeamLeadLinks?: boolean;
}

export const KNOWN_ADMINS: KnownAdminInput[] = [
  {
    telegramId: '1731711996',
    username: 'ssssv_a',
    firstName: 'S.O.',
    lastName: null
  },
  {
    telegramId: '8471141711',
    username: 'grigorybots',
    firstName: 'Grigory',
    lastName: null
  }
];

export const KNOWN_TEAM_LEADS: KnownTeamLeadInput[] = [
  {
    telegramId: '1731711996',
    username: 'ssssv_a',
    firstName: 'S.O.',
    lastName: null,
    displayName: 'S.O. (@ssssv_a)'
  },
  {
    telegramId: '846359286',
    username: 'elenakolyhalova',
    firstName: 'Elena',
    lastName: null,
    displayName: '@elenakolyhalova'
  },
  {
    telegramId: '193310707',
    username: 'danila1255',
    firstName: 'Danila',
    lastName: null,
    displayName: '@danila1255'
  }
];

export const KNOWN_CREATORS: KnownCreatorInput[] = [
  {
    telegramId: '7025455607',
    username: 'D1nen',
    firstName: 'D1nen',
    lastName: null,
    removeTeamLeadProfile: true,
    deactivateTeamLeadLinks: true
  },
  {
    telegramId: '748641314',
    username: 'Maxximlead',
    firstName: 'Maxximlead',
    lastName: null,
    removeTeamLeadProfile: true,
    deactivateTeamLeadLinks: true
  },
  {
    telegramId: '674890842',
    username: null,
    firstName: 'софя',
    lastName: null,
    removeTeamLeadProfile: true,
    deactivateTeamLeadLinks: true
  },
  {
    telegramId: '709509558',
    username: null,
    firstName: null,
    lastName: null,
    removeTeamLeadProfile: true,
    deactivateTeamLeadLinks: true
  },
  {
    telegramId: '661899304',
    username: 'burgonskaya',
    firstName: null,
    lastName: null,
    removeTeamLeadProfile: true,
    deactivateTeamLeadLinks: true
  }
];
