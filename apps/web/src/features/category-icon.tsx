import type { Language, Text } from '../i18n';

function icon(name: string, path: string, en: string, uk: string, ru: string) {
  return { name, path, labels: { en, uk, ru } };
}

// The same curated groups and identifiers as the mobile category picker.
export const categoryIconSets = [
  { label: 'iconsMoney', icons: [
    icon('wallet', 'M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7m17 5h-5v5h5m-3-2.5h.01', 'Wallet', 'Гаманець', 'Кошелёк'),
    icon('cash', 'M3 6h18v12H3zM3 9a3 3 0 0 0 3-3m12 0a3 3 0 0 0 3 3m0 6a3 3 0 0 0-3 3M6 18a3 3 0 0 0-3-3M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'Cash', 'Готівка', 'Наличные'),
    icon('cash-multiple', 'M2 4h17v11H2zM5 18h17V7M13 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0', 'Banknotes', 'Банкноти', 'Купюры'),
    icon('credit-card', 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 9h18M6 15h4', 'Card', 'Картка', 'Карта'),
    icon('bank', 'M3 8l9-5 9 5H3zm0 13h18M5 11v7m5-7v7m4-7v7m5-7v7', 'Bank', 'Банк', 'Банк'),
    icon('piggy-bank', 'M5 9l-2-3 5 1a8 8 0 0 1 10 2h3v6h-3l-2 3v3h-3v-2H8v2H5v-4a6 6 0 0 1 0-8zM9 7h4m3 4h.01M3 12H1', 'Savings', 'Заощадження', 'Сбережения'),
    icon('chart-line', 'M3 3v18h18M6 16l5-5 4 3 6-8', 'Investments', 'Інвестиції', 'Инвестиции'),
    icon('safe', 'M4 3h16v17H4zM7 20v2m10-2v2M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0m4-4v8m-4-4h8M19 7h1m-1 9h1', 'Safe', 'Сейф', 'Сейф'),
    icon('currency-usd', 'M12 2v20m5-16H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H7', 'Currency', 'Валюта', 'Валюта'),
    icon('receipt-text', 'M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1V3zm3 5h8m-8 4h8m-8 4h5', 'Receipt', 'Чек', 'Чек'),
    icon('sale', 'M3 3h8l10 10-8 8L3 11V3zm4 4h.01m3 9 7-7m-7 1h.01m6 5h.01', 'Discount', 'Знижка', 'Скидка'),
    icon('gift', 'M3 8h18v4H3zm2 4v9h14v-9M12 8v13m0-13C4 8 5 2 8 3c2 0 4 5 4 5s2-5 4-5c3-1 4 5-4 5', 'Gift', 'Подарунок', 'Подарок'),
    icon('cash-plus', 'M3 6h15v12H3zM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0m7 3v7m-3-3.5h7', 'Other income', 'Інший дохід', 'Другой доход'),
  ] },
  { label: 'iconsHome', icons: [
    icon('home', 'M3 10l9-7 9 7M5 9v12h5v-7h4v7h5V9', 'Home', 'Дім', 'Дом'),
    icon('home-city', 'M2 13l5-4 5 4M4 12v9h6v-9m2 9h10V3H12v5m3-2h.01m4 0h.01m-4 4h.01m4 0h.01m-4 4h.01m4 0h.01m-4 4h.01m4 0h.01', 'Property', 'Нерухомість', 'Недвижимость'),
    icon('key', 'M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0m-2 4 9 9m-3-3 3-3m-6 0 3-3M8 7h.01', 'Key', 'Ключ', 'Ключ'),
    icon('lightbulb', 'M8 15a7 7 0 1 1 8 0v3H8v-3zm0 3h8m-7 3h6M12 9v6', 'Lighting', 'Освітлення', 'Освещение'),
    icon('water', 'M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13zM8 15a4 4 0 0 0 4 4', 'Water', 'Вода', 'Вода'),
    icon('flash', 'M13 2 4 14h7l-1 8 10-13h-8l1-7z', 'Electricity', 'Електрика', 'Электричество'),
    icon('wifi', 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01', 'Internet', 'Інтернет', 'Интернет'),
    icon('tools', 'M14 4a6 6 0 0 0-7 7L2 16a3 3 0 0 0 4 4l5-5a6 6 0 0 0 9-7l-4 4-4-4 4-4h-2z', 'Repairs', 'Ремонт', 'Ремонт'),
    icon('sofa', 'M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M3 18V11h4v4h10v-4h4v7H3zm2 0v3m14-3v3', 'Furniture', 'Меблі', 'Мебель'),
    icon('bed', 'M3 3v18m18-11v11M3 17h18M3 10h18v7M6 6h5v4H6z', 'Bedroom', 'Спальня', 'Спальня'),
    icon('washing-machine', 'M4 3h16v18H4zM4 7h16M7 5h.01m3 0h.01m7 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0m-9 0c3-3 5 3 8 0', 'Appliances', 'Побутова техніка', 'Бытовая техника'),
    icon('flower', 'M12 9c-6-9-11 0-5 3-6 3-1 12 5 3 6 9 11 0 5-3 6-3 1-12-5-3zm0 6v7m0-3c-4 0-5-3-5-3m5 3c4 0 5-3 5-3M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0', 'Garden', 'Сад', 'Сад'),
  ] },
  { label: 'iconsFood', icons: [
    icon('cart', 'M2 3h3l3 13h11l3-9H6M10 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0m10 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0', 'Groceries', 'Продукти', 'Продукты'),
    icon('basket', 'M3 9h18l-2 12H5L3 9zm4 0 5-7 5 7M9 13v4m6-4v4', 'Basket', 'Кошик', 'Корзина'),
    icon('food', 'M3 18h18M4 15a8 8 0 0 1 16 0H4zm8-8V4m-2 0h4M6 21h12', 'Meal', 'Страва', 'Блюдо'),
    icon('food-apple', 'M12 7C8 2 3 7 3 12s3 10 7 8h4c4 2 7-3 7-8s-5-10-9-5zm0 0V3m0 2c0-3 3-4 5-3-1 3-3 4-5 3', 'Fruit', 'Фрукти', 'Фрукты'),
    icon('silverware-fork-knife', 'M4 3v6a3 3 0 0 0 6 0V3M7 3v18m11-18c-4 2-4 8 0 9V3zm0 9v9', 'Dining out', 'Кафе та ресторани', 'Кафе и рестораны'),
    icon('silverware', 'M6 21V11m-3-5a3 4 0 1 1 6 0 3 4 0 0 1-6 0M15 3v7h5V3m-2.5 0v18', 'Cutlery', 'Столові прибори', 'Столовые приборы'),
    icon('coffee', 'M3 8h13v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8zm13 1h2a3 3 0 0 1 0 6h-2M6 3v2m4-2v2m4-2v2M2 23h16', 'Coffee', 'Кава', 'Кофе'),
    icon('cup', 'M5 3h14l-2 18H7L5 3zm1 5h12m-11 5h10', 'Drinks', 'Напої', 'Напитки'),
    icon('pizza', 'M3 4a22 22 0 0 1 18 0l-9 18L3 4zm1 3a18 18 0 0 1 16 0M10 10h.01m5 1h.01m-3 5h.01', 'Pizza', 'Піца', 'Пицца'),
    icon('hamburger', 'M3 9a9 7 0 0 1 18 0H3zm0 4h18M3 16h18a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM8 6h.01m4-1h.01m4 1h.01', 'Fast food', 'Фастфуд', 'Фастфуд'),
    icon('cake-variant', 'M3 11h18v10H3V11zm0 4c3-3 3 3 6 0s3 3 6 0 3 3 6 0M7 11V7m5 4V7m5 4V7M7 4h.01m5-2h.01m5 2h.01', 'Cake', 'Торт', 'Торт'),
    icon('bottle-soda', 'M9 2h6v5l3 5v9H6v-9l3-5V2zm0 3h6m-9 9h12m-12 4h12', 'Soft drinks', 'Безалкогольні напої', 'Безалкогольные напитки'),
    icon('shopping-outline', 'M4 7h16l1 14H3L4 7zm4 2V6a4 4 0 0 1 8 0v3', 'Shopping', 'Покупки', 'Покупки'),
  ] },
  { label: 'iconsTravel', icons: [
    icon('car', 'M3 11l3-7h12l3 7v7H3v-7zm0 0h18M5 18v3m14-3v3M6 14h2m8 0h2', 'Car', 'Автомобіль', 'Автомобиль'),
    icon('bus', 'M5 3h14v17H5V3zm0 9h14M8 20v2m8-2v2M8 16h.01m8 0h.01M2 7h3m14 0h3', 'Bus', 'Автобус', 'Автобус'),
    icon('train', 'M7 3h10a2 2 0 0 1 2 2v13H5V5a2 2 0 0 1 2-2zm-2 7h14M8 18l-3 4m11-4 3 4M8 14h.01m8 0h.01M12 3v7', 'Train', 'Поїзд', 'Поезд'),
    icon('subway', 'M3 21V11a9 9 0 0 1 18 0v10M7 7h10v11H7V7zm0 5h10M9 18l-1 3m7-3 1 3M10 15h.01m4 0h.01', 'Metro', 'Метро', 'Метро'),
    icon('bike', 'M9 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0m14 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0M5 17l5-8 5 8H5zm14 0-4-13h-3M8 7h4', 'Bicycle', 'Велосипед', 'Велосипед'),
    icon('walk', 'M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0m-2 4-3 6 4 3 1 5m-5-8-2 8m5-14 3 5 5 1M9 9l-4 4', 'Walking', 'Пішки', 'Пешком'),
    icon('airplane', 'M12 2l3 8 7 4v2l-7-1v4l2 2H7l2-2v-4l-7 1v-2l7-4 3-8z', 'Flights', 'Авіаперельоти', 'Авиаперелёты'),
    icon('ferry', 'M6 11V5h12v6M12 5V2M3 13l9-4 9 4-3 6H6l-3-6zm-1 9c2-3 4 3 6 0s4 3 6 0 4 3 8 0M12 9v10', 'Ferry', 'Пором', 'Паром'),
    icon('gas-station', 'M3 21V3h11v18M3 10h11M1 21h15M6 6h5m3 7h2v5a2 2 0 0 0 4 0V7l-3-3m3 3h2v4h-2', 'Fuel', 'Пальне', 'Топливо'),
    icon('parking', 'M4 3h16v18H4zM9 18V7h4a3 3 0 0 1 0 6H9', 'Parking', 'Паркування', 'Парковка'),
    icon('map-marker', 'M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14zm3-14a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'Location', 'Місце', 'Место'),
    icon('briefcase', 'M3 7h18v14H3V7zm5 0V3h8v4M3 12l9 3 9-3m-9 1v4', 'Work', 'Робота', 'Работа'),
  ] },
  { label: 'iconsLife', icons: [
    icon('medical-bag', 'M3 7h18v14H3V7zm5 0V3h8v4m-4 4v6m-3-3h6', 'Healthcare', 'Медицина', 'Медицина'),
    icon('heart-pulse', 'M12 21 3 12a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9zM2 11h5l2-4 4 9 2-5h7', 'Health', 'Здоров’я', 'Здоровье'),
    icon('dumbbell', 'M6 8v8m12-8v8M3 6h3v12H3V6zm15 0h3v12h-3V6zM6 12h12M1 10v4m22-4v4', 'Sport', 'Спорт', 'Спорт'),
    icon('school', 'M2 8l10-5 10 5-10 5L2 8zm4 2v7c4 3 8 3 12 0v-7m4-2v10', 'Education', 'Освіта', 'Образование'),
    icon('book-open-variant', 'M12 6c-4-3-7-3-10-2v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-1-10 2zm0 0v15M5 8l4 1m-4 3 4 1m6-4 4-1m-4 5 4-1', 'Books', 'Книги', 'Книги'),
    icon('movie-open', 'M3 9h18v12H3V9zm0-6h18v6H3V3zm3 0 3 6m3-6 3 6m3-6 3 6', 'Cinema', 'Кіно', 'Кино'),
    icon('gamepad-variant', 'M7 7h10a4 4 0 0 1 4 3l2 9c-2 3-4 1-7-2H8c-3 3-5 5-7 2l2-9a4 4 0 0 1 4-3zm-1 4v6m-3-3h6m7-2h.01m3 3h.01', 'Games', 'Ігри', 'Игры'),
    icon('music', 'M9 18V4l11-2v14M9 8l11-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0m11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'Music', 'Музика', 'Музыка'),
    icon('paw', 'M7 21c-6 0-4-6-1-8 4-6 8-6 12 0 3 2 5 8-1 8-3-2-7-2-10 0zm-2-13a2 3 0 1 1-4 0 2 3 0 0 1 4 0m5-3a2 3 0 1 1-4 0 2 3 0 0 1 4 0m8 0a2 3 0 1 1-4 0 2 3 0 0 1 4 0m5 3a2 3 0 1 1-4 0 2 3 0 0 1 4 0', 'Pets', 'Домашні тварини', 'Домашние животные'),
    icon('baby-face-outline', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 3c3 3 0 5-2 3M8 11h.01m8 0h.01M8 16c2 3 6 3 8 0', 'Children', 'Діти', 'Дети'),
    icon('tshirt-crew', 'M8 3c2 3 6 3 8 0l6 4-3 5-3-2v11H8V10l-3 2-3-5 6-4z', 'Clothing', 'Одяг', 'Одежда'),
    icon('cellphone', 'M6 2h12v20H6V2zm0 4h12M6 18h12m-6 2h.01', 'Phone', 'Телефон', 'Телефон'),
    icon('shape-outline', 'M3 3h7v7H3zM21 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M7 14l5 8H2l5-8zm8 1h6v6h-6z', 'Other', 'Інше', 'Другое'),
  ] },
] as const;

const icons = new Map(categoryIconSets.flatMap((group) => [...group.icons]).map((entry) => [entry.name, entry]));
const aliases: Readonly<Record<string, string>> = {
  restaurant: 'silverware-fork-knife', medical: 'medical-bag', film: 'movie-open',
  bag: 'shopping-outline', 'add-circle': 'cash-plus',
};
export function categoryIconName(name: string | null) {
  const resolved = aliases[name ?? ''] ?? name ?? 'shape-outline';
  return icons.has(resolved) ? resolved : 'shape-outline';
}
export function CategoryIcon({ name }: { name: string | null }) {
  return <svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={icons.get(categoryIconName(name))!.path} /></svg>;
}

export function CategoryIconPicker({ value, onChange, background, foreground, language, t }: {
  value: string; onChange: (value: string) => void; background: string; foreground: string; language: Language; t: Text;
}) {
  const selected = categoryIconName(value);
  return <fieldset className="category-icon-picker"><legend>{t.icon}</legend>
    {categoryIconSets.map((group) => <div className="category-icon-group" key={group.label}><h3>{t[group.label]}</h3>
      <div className="category-icon-grid">{group.icons.map((entry) => <button key={entry.name} type="button" aria-label={entry.labels[language]} title={entry.labels[language]} aria-pressed={selected === entry.name} onClick={() => onChange(entry.name)}>
        <span className="category-icon-tile" style={{ background, color: foreground }}><CategoryIcon name={entry.name} /></span>
        {selected === entry.name && <span className="category-icon-selected" aria-hidden="true">✓</span>}
      </button>)}</div>
    </div>)}
  </fieldset>;
}
