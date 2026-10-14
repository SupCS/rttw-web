import { useState, type FormEvent } from 'react';
import type { Category } from '@rttw/domain';
import { audit, categoryLabel, isActual }  from '../data/derived';
import { errorText } from '../data/use-ledger';
import { Amount, Dialog, ErrorMessage, Field, SubmitButtons, text, type FeatureProps } from '../components/shared';
import { useReportAmounts } from '../data/reporting';
import { today } from '../format';
import { Icon, ui, Heading, MonthPicker } from '../components/design';
import { categoryAppearance, categoryColors } from './category-appearance';
import { CategoryIcon, CategoryIconPicker } from './category-icon';

export function CategoryBadge({ category }: { category: Category }) {
  const appearance = categoryAppearance(category);
  return <span className="category-badge" aria-hidden="true" style={{ background: `color-mix(in srgb, ${appearance.background} 12%, transparent)`, color: appearance.foreground }}><CategoryIcon name={category.icon} /></span>;
}
export function Categories(props: FeatureProps) {
  const { snapshot, t, language } = props;
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const [type,setType]=useState<'expense'|'income'>('expense');
  const [month,setMonth]=useState(today().slice(0,7));
  const [detail,setDetail]=useState<Category|null>(null);
  const txs=snapshot.transactions.filter(x=>isActual(x,today())&&x.transactionDate.startsWith(month)&&['income','expense'].includes(x.transactionType));
  const converted=useReportAmounts(txs,snapshot.household.baseCurrency,true,0);
  const sumFor=(id:string)=>{let sum=0n;for(const tx of txs.filter(x=>x.transactionType===type)){const val=converted.amounts[tx.id];if(!val)continue;const splits=snapshot.splits.filter(s=>s.transactionId===tx.id&&!s.deletedAt);if(splits.length){let allocated=0n;splits.forEach((split,index)=>{const v=index===splits.length-1?BigInt(val.amountMinor)-allocated:BigInt(val.amountMinor)*BigInt(split.amount.amountMinor)/BigInt(tx.originalAmount.amountMinor);allocated+=v;if(split.categoryId===id||snapshot.categories.find(c=>c.id===split.categoryId)?.parentId===id)sum+=v})}else if(tx.categoryId===id||snapshot.categories.find(c=>c.id===tx.categoryId)?.parentId===id)sum+=BigInt(val.amountMinor)}return sum<0n?-sum:sum};
  const visible = snapshot.categories.filter((item) => !item.deletedAt && item.isArchived === archived);
  const total=txs.filter(x=>x.transactionType===type).reduce((s,x)=>s+BigInt(converted.amounts[x.id]?.amountMinor??'0'),0n);const abs=total<0n?-total:total;
  return <><Heading title={t.categories} action={<button className="icon-button outlined" aria-label={t.newCategory} onClick={()=>setEditing('new')}><Icon name="plus"/></button>}/><MonthPicker value={month} onChange={setMonth} locale={props.locale}/><div className="flow-toggle">{(['expense','income'] as const).map(v=><button key={v} aria-pressed={type===v} onClick={()=>setType(v)}><span><Icon name={v==='expense'?'arrow':'income'} size={15}/>{ui(language,v)}</span><strong>{<Amount value={{currency:snapshot.household.baseCurrency,amountMinor:(txs.filter(x=>x.transactionType===v).reduce((sum,x)=>sum+BigInt(converted.amounts[x.id]?.amountMinor??'0'),0n)*(v==='expense'?-1n:1n)).toString()}} locale={props.locale} display={props.moneyDisplay}/>}</strong></button>)}</div>{!converted.loading&&txs.some(x=>!converted.amounts[x.id])&&<p className="notice">{t.fx_pending}: {txs.filter(x=>!converted.amounts[x.id]).length}</p>}<div className="section-heading category-topline"><h2>{t.categories}</h2><button className={`archive-button ${archived?'is-active':''}`} aria-pressed={archived} onClick={()=>setArchived(!archived)}>{t.archived}</button></div>
    <div className="category-grid">{visible.filter(c=>c.applicability===type||c.applicability==='both').map(category=>{const sum=sumFor(category.id);return <button className="category-tile" key={category.id} onClick={()=>setDetail(category)}><CategoryBadge category={category}/><span className="category-tile-name">{categoryLabel(category,snapshot.categories,language)}</span><strong><Amount value={{currency:snapshot.household.baseCurrency,amountMinor:sum.toString()}} locale={props.locale} display={props.moneyDisplay}/></strong><div className="category-tile-track"><span style={{width:`${abs?Math.min(100,Number(sum*100n/abs)):0}%`,background:categoryAppearance(category).background}}/></div></button>})}<button className="category-tile new-category" onClick={()=>setEditing('new')}><span className="tile-icon"><Icon name="plus"/></span><span>{t.newCategory}</span></button></div>
    {detail&&<Dialog title={detail.names[language]} t={t} onClose={()=>setDetail(null)}><div className="category-detail-hero"><CategoryBadge category={detail}/><strong><Amount value={{currency:snapshot.household.baseCurrency,amountMinor:sumFor(detail.id).toString()}} locale={props.locale} display={props.moneyDisplay}/></strong><p>{month} · {t[detail.applicability]}</p></div><div className="actions"><button className="primary" onClick={()=>{setEditing(detail);setDetail(null)}}>{t.editCategory}</button><a className="button" href={`#transactions?category=${detail.id}`}>{t.transactions}</a></div></Dialog>}
    {editing&&<CategoryEditor {...props} existing={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
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
      <div className="category-appearance-preview"><span className="category-badge" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color: iconColor }}><CategoryIcon name={icon} /></span><span>{t.categoryPreview}</span></div>
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
