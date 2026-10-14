import { useState, type FormEvent } from 'react';
import type { Category } from '@rttw/domain';
import { audit, categoryLabel } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { Dialog, ErrorMessage, Field, SubmitButtons, text, type FeatureProps } from '../components/shared';
import { categoryAppearance, categoryColors } from './category-appearance';
import { CategoryIcon, CategoryIconPicker } from './category-icon';

export function CategoryBadge({ category }: { category: Category }) {
  const appearance = categoryAppearance(category);
  return <span className="category-badge" aria-hidden="true" style={{ background: appearance.background, color: appearance.foreground }}><CategoryIcon name={category.icon} /></span>;
}
export function Categories(props: FeatureProps) {
  const { snapshot, t, language } = props;
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const visible = snapshot.categories.filter((item) => !item.deletedAt && item.isArchived === archived);
  return <><div className="section-heading"><h1>{t.categories}</h1><button className="primary" onClick={() => setEditing('new')}>{t.newCategory}</button></div>
    <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />{t.archived}</label>
    <div className="card-grid">{visible.map((category) => <article className="card category-card" key={category.id}><CategoryBadge category={category} /><div><h2>{categoryLabel(category, snapshot.categories, language)}</h2><p className="muted">{t[category.applicability]}</p></div><button onClick={() => setEditing(category)}>{t.edit}</button></article>)}</div>
    {!visible.length && <p className="empty">{t.empty}</p>}
    {editing && <CategoryEditor {...props} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </>;
}
function CategoryEditor({ existing, onClose, ...props }: FeatureProps & { existing: Category | undefined; onClose: () => void }) {
  const { snapshot, t, language, command, busy } = props;
  const [fields] = useState(() => audit(snapshot.member.id, existing));
  const [applicability, setApplicability] = useState<Category['applicability']>(existing?.applicability ?? 'expense');
  const [parent, setParent] = useState(existing?.parentId ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'shape-outline');
  const [color, setColor] = useState(() => existing ? categoryAppearance(existing).background : categoryColors[0]);
  const [iconColor, setIconColor] = useState(() => categoryAppearance(existing).foreground);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [error, setError] = useState('');
  const possible = snapshot.categories.filter((item) => item.id !== existing?.id && !item.deletedAt && !item.isArchived && item.parentId === null && (item.applicability === applicability || item.applicability === 'both'));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const data = new FormData(event.currentTarget);
    const names = existing?.systemKey ? existing.names : { en: text(data, 'en'), uk: text(data, 'uk'), ru: text(data, 'ru') };
    if (!names.en || !names.uk || !names.ru) { setError(t.invalidForm); return; }
    try { await command({ type: 'category.save', expectedRevision: existing?.revision ?? 0, category: { ...fields, householdId: existing ? existing.householdId : snapshot.household.id,
      parentId: existing?.systemKey ? existing.parentId : parent || null, applicability: existing?.systemKey ? existing.applicability : applicability,
      systemKey: existing?.systemKey ?? null, names, icon, colorToken: color, iconColor, isArchived: existing?.isArchived ?? false } }); onClose(); } catch (failure) { setError(errorText(failure, t)); }
  }
  async function archive() {
    if (!existing) return;
    try { await command({ type: 'category.save', expectedRevision: existing.revision, category: { ...existing, ...audit(snapshot.member.id, existing), isArchived: !existing.isArchived } }); onClose(); } catch (failure) { setError(errorText(failure, t)); }
  }
  async function merge() {
    if (!existing || !mergeTarget || !mergeConfirm) return;
    try { await command({ type: 'category.merge', sourceCategoryId: existing.id, targetCategoryId: mergeTarget, expectedRevision: existing.revision }); onClose(); } catch (failure) { setError(errorText(failure, t)); }
  }
  return <Dialog title={existing ? t.editCategory : t.newCategory} onClose={onClose} t={t} busy={busy}>
    <form onSubmit={(event) => void save(event)}>
      {!existing?.systemKey && <div className="form-grid">{(['en', 'uk', 'ru'] as const).map((code) => <Field label={`${t.name} · ${code.toUpperCase()}`} key={code}><input name={code} required maxLength={120} defaultValue={existing?.names[code]} /></Field>)}</div>}
      <div className="category-appearance-preview"><span className="category-badge" style={{ background: color, color: iconColor }}><CategoryIcon name={icon} /></span><span>{t.categoryPreview}</span></div>
      <div className="form-grid"><Field label={t.color}><input type="color" value={color} onChange={(event) => setColor(event.target.value)} list="category-colors" /></Field><Field label={t.iconColor}><input type="color" value={iconColor} onChange={(event) => setIconColor(event.target.value)} /></Field></div>
      <datalist id="category-colors">{categoryColors.map((value) => <option key={value} value={value} />)}</datalist>
      <CategoryIconPicker value={icon} onChange={setIcon} background={color} foreground={iconColor} language={language} t={t} />
      {!existing?.systemKey && <><Field label={t.applicability}><select value={applicability} onChange={(event) => { setApplicability(event.target.value as Category['applicability']); setParent(''); }}>{(['expense', 'income', 'both'] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></Field>
      <Field label={t.parent}><select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">{t.noParent}</option>{possible.map((item) => <option key={item.id} value={item.id}>{item.names[language]}</option>)}</select></Field></>}
      <ErrorMessage message={error} /><SubmitButtons busy={busy} t={t} onClose={onClose} />
      {existing && !existing.systemKey && <button type="button" disabled={busy} className="danger" onClick={() => void archive()}>{existing.isArchived ? t.unarchive : t.archive}</button>}
    </form>
    {existing && !existing.systemKey && !existing.isArchived && <details className="merge-panel"><summary>{t.merge}</summary><p>{t.mergeHint}</p><Field label={t.mergeInto}><select value={mergeTarget} onChange={(event) => { setMergeTarget(event.target.value); setMergeConfirm(false); }}><option value="">—</option>{snapshot.categories.filter((item) => !item.deletedAt && !item.isArchived && item.id !== existing.id && item.parentId !== existing.id && (item.applicability === existing.applicability || item.applicability === 'both')).map((item) => <option key={item.id} value={item.id}>{categoryLabel(item, snapshot.categories, language)}</option>)}</select></Field><label className="check"><input type="checkbox" checked={mergeConfirm} onChange={(event) => setMergeConfirm(event.target.checked)} />{t.confirmMerge}</label><button disabled={busy || !mergeTarget || !mergeConfirm} onClick={() => void merge()}>{t.confirmMerge}</button></details>}
  </Dialog>;
}
