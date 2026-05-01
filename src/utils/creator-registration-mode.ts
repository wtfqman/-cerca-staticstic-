import type { LegalType } from '@prisma/client';

export const NO_CONTRACT_REGISTRATION_VALUE = 'NO_CONTRACT';

export type CreatorRegistrationLegalType = LegalType | null;

export const isNoContractLegalType = (legalType?: LegalType | null) => legalType === null;

export const isNoContractCreatorProfile = (
  profile?: { legalType?: LegalType | null; profileCompleted?: boolean | null } | null
) => Boolean(profile?.profileCompleted && isNoContractLegalType(profile.legalType));

export const isNoContractCreator = (
  user?: { creatorProfile?: { legalType?: LegalType | null; profileCompleted?: boolean | null } | null } | null
) => isNoContractCreatorProfile(user?.creatorProfile);
