import { defaultCategoryColors, type Category } from '@rttw/domain';

// The mobile application's ten built-in category identities and localized labels.
// Each website ledger receives independent rows with these stable identities.
const defaults = [
  ['groceries', 'expense', 'Groceries', 'Продукти', 'Продукты', 'cart'],
  ['dining', 'expense', 'Dining out', 'Кафе та ресторани', 'Кафе и рестораны', 'restaurant'],
  ['transport', 'expense', 'Transport', 'Транспорт', 'Транспорт', 'car'],
  ['housing', 'expense', 'Housing', 'Житло', 'Жильё', 'home'],
  ['utilities', 'expense', 'Utilities', 'Комунальні послуги', 'Коммунальные услуги', 'flash'],
  ['health', 'expense', 'Health', 'Здоровʼя', 'Здоровье', 'medical'],
  ['entertainment', 'expense', 'Entertainment', 'Розваги', 'Развлечения', 'film'],
  ['shopping', 'expense', 'Shopping', 'Покупки', 'Покупки', 'bag'],
  ['salary', 'income', 'Salary', 'Зарплата', 'Зарплата', 'wallet'],
  ['other_income', 'income', 'Other income', 'Інший дохід', 'Другой доход', 'add-circle'],
] as const;

export const defaultCategories: ReadonlyArray<Pick<Category, 'id' | 'parentId' | 'applicability' | 'systemKey' | 'names' | 'icon' | 'colorToken' | 'iconColor' | 'isArchived'>> = defaults.map(([systemKey, applicability, en, uk, ru, icon], index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, parentId: null, applicability, systemKey,
  names: { en, uk, ru }, icon, colorToken: defaultCategoryColors[systemKey]!, iconColor: '#FFFFFF', isArchived: false,
}));
