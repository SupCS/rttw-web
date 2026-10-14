export const currencyMetadata = {
  CHF: { minorUnit: 2, name: 'Swiss franc' },
  EUR: { minorUnit: 2, name: 'Euro' },
  GBP: { minorUnit: 2, name: 'Pound sterling' },
  GEL: { minorUnit: 2, name: 'Georgian lari' },
  JPY: { minorUnit: 0, name: 'Japanese yen' },
  KWD: { minorUnit: 3, name: 'Kuwaiti dinar' },
  PLN: { minorUnit: 2, name: 'Polish złoty' },
  RUB: { minorUnit: 2, name: 'Russian ruble' },
  TRY: { minorUnit: 2, name: 'Turkish lira' },
  UAH: { minorUnit: 2, name: 'Ukrainian hryvnia' },
  USD: { minorUnit: 2, name: 'US dollar' },
} as const;

export type MoneyCurrencyCode = keyof typeof currencyMetadata;

export function getMinorUnit(currency: MoneyCurrencyCode) {
  return currencyMetadata[currency].minorUnit;
}
