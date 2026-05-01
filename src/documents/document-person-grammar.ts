export type DocumentPersonGender = 'male' | 'female';

export interface DocumentPersonGrammar {
  gender: DocumentPersonGender;
  citizenLabel: string;
  citizenDativeLabel: string;
  referredAs: string;
  selfEmployedTaxpayerParticiple: string;
  selfEmployedLegalLabel: string;
  ipLegalLabel: string;
  executorRole: string;
}

const DOCUMENT_PERSON_GRAMMAR: Record<DocumentPersonGender, DocumentPersonGrammar> = {
  male: {
    gender: 'male',
    citizenLabel: 'Гражданин РФ',
    citizenDativeLabel: 'Гражданину РФ',
    referredAs: 'именуемый',
    selfEmployedTaxpayerParticiple: 'являющийся',
    selfEmployedLegalLabel: 'самозанятый',
    ipLegalLabel: 'индивидуальный предприниматель',
    executorRole: 'Исполнитель'
  },
  female: {
    gender: 'female',
    citizenLabel: 'Гражданка',
    citizenDativeLabel: 'Гражданке',
    referredAs: 'именуемая',
    selfEmployedTaxpayerParticiple: 'являющаяся',
    selfEmployedLegalLabel: 'самозанятая',
    ipLegalLabel: 'индивидуальный предприниматель',
    executorRole: 'Исполнитель'
  }
};

const FEMALE_FIRST_NAMES = new Set([
  'александра',
  'алена',
  'алина',
  'алиса',
  'алла',
  'анастасия',
  'ангелина',
  'анна',
  'валентина',
  'валерия',
  'вера',
  'вероника',
  'виктория',
  'дарья',
  'диана',
  'евгения',
  'екатерина',
  'елена',
  'елизавета',
  'жанна',
  'зоя',
  'инна',
  'ирина',
  'карина',
  'кира',
  'кристина',
  'ксения',
  'лариса',
  'любовь',
  'маргарита',
  'марина',
  'мария',
  'надежда',
  'наталья',
  'ника',
  'нина',
  'оксана',
  'ольга',
  'полина',
  'светлана',
  'софия',
  'татьяна',
  'ульяна',
  'юлия',
  'яна'
]);

const MALE_FIRST_NAMES = new Set([
  'александр',
  'алексей',
  'андрей',
  'антон',
  'артем',
  'борис',
  'вадим',
  'валентин',
  'валерий',
  'василий',
  'виктор',
  'виталий',
  'владимир',
  'владислав',
  'вячеслав',
  'георгий',
  'григорий',
  'данил',
  'даниил',
  'денис',
  'дмитрий',
  'евгений',
  'егор',
  'иван',
  'игорь',
  'илья',
  'кирилл',
  'константин',
  'лев',
  'максим',
  'михаил',
  'никита',
  'николай',
  'олег',
  'павел',
  'петр',
  'роман',
  'сергей',
  'станислав',
  'степан',
  'тимофей',
  'федор',
  'юрий'
]);

const normalizeNamePart = (value: string | undefined) =>
  value
    ?.trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е') ?? '';

export const normalizeDocumentPersonGender = (
  gender: string | null | undefined
): DocumentPersonGender | null => {
  if (gender === 'male' || gender === 'female') {
    return gender;
  }

  return null;
};

export const inferDocumentPersonGenderFromFullName = (
  fullName: string | null | undefined
): DocumentPersonGender => {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [lastNameRaw, firstNameRaw, patronymicRaw] = parts;
  const lastName = normalizeNamePart(lastNameRaw);
  const firstName = normalizeNamePart(firstNameRaw);
  const patronymic = normalizeNamePart(patronymicRaw);

  if (/(вна|ична|кызы)$/.test(patronymic)) {
    return 'female';
  }

  if (/(вич|ич|оглы)$/.test(patronymic)) {
    return 'male';
  }

  if (FEMALE_FIRST_NAMES.has(firstName)) {
    return 'female';
  }

  if (MALE_FIRST_NAMES.has(firstName)) {
    return 'male';
  }

  if (/(ова|ева|ина|ская|цкая|ая|яя)$/.test(lastName)) {
    return 'female';
  }

  if (/(ов|ев|ин|ский|цкий|ый|ий|ой)$/.test(lastName)) {
    return 'male';
  }

  return 'male';
};

export const resolveDocumentPersonGrammar = (input: {
  fullName?: string | null;
  gender?: string | null;
}): DocumentPersonGrammar => {
  const gender = normalizeDocumentPersonGender(input.gender) ?? inferDocumentPersonGenderFromFullName(input.fullName);

  return DOCUMENT_PERSON_GRAMMAR[gender];
};
