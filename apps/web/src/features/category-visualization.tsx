import type { Category } from '@rttw/domain';
import type { Language, Text } from '../i18n';
import type { categoryRollup } from '../data/derived';
import { Amount } from '../components/shared';
import { categoryAppearance } from './category-appearance';

export type CategoryView = 'listView' | 'barView' | 'donutView' | 'treemapView';
const viewIcons: Record<CategoryView, string> = {
  listView: 'M3 5h.01M7 5h14M3 12h.01M7 12h14M3 19h.01M7 19h14',
  barView: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20',
  donutView: 'M21 12a9 9 0 1 1-9-9v5a4 4 0 1 0 4 4h5zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z',
  treemapView: 'M3 3h18v18H3zM11 3v18M11 11h10M16 11v10',
};
export function CategoryViewSwitch({ value, onChange, t }: { value: CategoryView; onChange: (view: CategoryView) => void; t: Text }) {
  return <div className="chart-view-switch" role="group" aria-label={t.categoryView}>
    {(Object.keys(viewIcons) as CategoryView[]).map((view) => <button key={view} type="button" title={t[view]} aria-label={t[view]} aria-pressed={value === view} onClick={() => onChange(view)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={viewIcons[view]} /></svg>
    </button>)}
  </div>;
}
export function CategoryVisualization({ rows, categories, language, locale, display, t, view }: { rows: ReturnType<typeof categoryRollup>; categories: Category[]; language: Language; locale: string; display: 'code' | 'symbol'; t: Text; view: CategoryView }) {
  const currencies = [...new Set(rows.map((row) => row.currency))];
  return <>{currencies.map((currency) => {
    const group = rows.filter((row) => row.currency === currency); const total = group.reduce((sum, row) => sum + row.amount, 0n);
    const percent = (value: bigint) => total ? Number(value * 10000n / total) / 100 : 0;
    const color = (id: string | null) => categoryAppearance(categories.find((item) => item.id === id)).background;
    let cursor = 0;
    const gradient = group.map((row) => { const start = cursor; cursor += percent(row.amount); return `${color(row.categoryId)} ${start}% ${cursor}%`; }).join(',');
    return <div className="currency-category-group" key={currency}><h3>{currency}</h3>
      {view === 'donutView' && <div className="category-donut" role="img" aria-label={`${t.expenseCategories} · ${currency}`} style={{ background: `conic-gradient(${gradient})` }}><div><Amount value={{ currency, amountMinor: total.toString() }} locale={locale} display={display} /></div></div>}
      {view === 'barView' && <div className="category-stacked" role="img" aria-label={`${t.expenseCategories} · ${currency}`}>{group.map((row) => <span key={row.categoryId} style={{ width: `${percent(row.amount)}%`, background: color(row.categoryId) }} />)}</div>}
      {view === 'treemapView' && <div className="category-treemap" role="img" aria-label={`${t.expenseCategories} · ${currency}`}>{group.map((row) => <div key={row.categoryId} style={{ flex: `${percent(row.amount)} 0 0`, background: color(row.categoryId) }} />)}</div>}
      {group.map((row) => {
        const category = categories.find((item) => item.id === row.categoryId);
        const name = category?.names[language] ?? t.noCategory;
        const children = [...row.children.values()];
        const line = <div className="rollup-row"><div className="section-heading"><span className="category-legend"><span className="category-swatch" aria-hidden="true" style={{ background: color(row.categoryId) }} /><span>{name} <small className="muted">{percent(row.amount)}%</small></span></span><Amount value={{ currency, amountMinor: row.amount.toString() }} locale={locale} display={display} /></div><div className="bar-track" aria-hidden="true"><div style={{ width: `${percent(row.amount)}%`, background: color(row.categoryId) }} /></div></div>;
        return category && (children.length > 1 || children.some((item) => item.categoryId !== row.categoryId)) ? <details key={row.categoryId} className="category-breakdown"><summary>{line}</summary>{children.map((child) => <div className="section-heading category-child" key={child.categoryId}><span>{child.categoryId === row.categoryId ? t.general : categories.find((item) => item.id === child.categoryId)?.names[language] ?? t.noCategory}</span><Amount value={{ currency, amountMinor: child.amount.toString() }} locale={locale} display={display} /></div>)}</details> : <div key={row.categoryId}>{line}</div>;
      })}
    </div>;
  })}</>;
}
