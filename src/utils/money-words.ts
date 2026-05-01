const UNITS_MALE = [
  '',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять'
];

const UNITS_FEMALE = [
  '',
  'одна',
  'две',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять'
];

const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать'
];

const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто'
];

const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот'
];

const pluralize = (value: number, forms: [string, string, string]): string => {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }

  return forms[2];
};

const convertBelowThousand = (value: number, female = false): string => {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const tensUnits = value % 100;
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;

  if (hundreds > 0) {
    parts.push(HUNDREDS[hundreds]);
  }

  if (tensUnits >= 10 && tensUnits <= 19) {
    parts.push(TEENS[tensUnits - 10]);
  } else {
    if (tens > 0) {
      parts.push(TENS[tens]);
    }

    if (units > 0) {
      parts.push((female ? UNITS_FEMALE : UNITS_MALE)[units]);
    }
  }

  return parts.join(' ').trim();
};

export const moneyToWordsRu = (value: number): string => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('moneyToWordsRu expects a non-negative integer');
  }

  if (value === 0) {
    return 'ноль рублей';
  }

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const rubles = value % 1_000;
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(convertBelowThousand(millions), pluralize(millions, ['миллион', 'миллиона', 'миллионов']));
  }

  if (thousands > 0) {
    parts.push(convertBelowThousand(thousands, true), pluralize(thousands, ['тысяча', 'тысячи', 'тысяч']));
  }

  if (rubles > 0) {
    parts.push(convertBelowThousand(rubles));
  }

  parts.push(pluralize(value, ['рубль', 'рубля', 'рублей']));

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
};
