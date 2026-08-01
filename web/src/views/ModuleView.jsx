import React, { useEffect, useState } from 'react';
import { useModulesStore } from '../state/modules.js';
import { useChatStore } from '../state/chat.js';
import { writeHashParams } from '../lib/hash.js';

const TYPES = ['text', 'number', 'bool', 'date', 'select'];

function emptyDraft(schema) {
  const d = {};
  for (const f of schema) d[f.key] = f.type === 'bool' ? false : '';
  return d;
}

// Turn a form draft into a typed data object the API will accept.
function coerce(schema, draft) {
  const data = {};
  for (const f of schema) {
    const v = draft[f.key];
    if (f.type === 'bool') { data[f.key] = !!v; continue; }
    if (v === '' || v == null) continue;            // omit empty; server enforces required
    if (f.type === 'number') { const n = Number(v); if (!Number.isNaN(n)) data[f.key] = n; continue; }
    data[f.key] = v;                                  // text | date | select
  }
  return data;
}

function Field({ field, value, onChange }) {
  if (field.type === 'bool') return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (field.type === 'number') return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'date') return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function renderValue(field, v) {
  if (v == null || v === '') return <span className="muted">—</span>;
  if (field.type === 'bool') return v ? '✓' : '—';
  return String(v);
}

// Rename or hide (archive) this module. Archiving keeps every item —
// the module moves to the Archived area where it can be restored.
function ManagePanel({ mod, onClose, onArchived }) {
  const updateModule = useModulesStore((s) => s.updateModule);
  const archiveModule = useModulesStore((s) => s.archiveModule);
  const [label, setLabel] = useState(mod.label);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveRename() {
    if (!label.trim() || label.trim() === mod.label) { onClose(); return; }
    setBusy(true); setErr('');
    try { await updateModule(mod.id, { label: label.trim() }); onClose(); }
    catch (e) { setErr(e.message || 'Could not rename'); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!window.confirm(`Hide "${mod.label}"? Nothing is deleted — you can restore it anytime from Archived modules.`)) return;
    setBusy(true); setErr('');
    try { await archiveModule(mod.id); onArchived?.(); }
    catch (e) { setErr(e.message || 'Could not archive'); setBusy(false); }
  }

  return (
    <div className="module-form module-manage">
      <label className="module-field">
        <span className="muted small">Name</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      {err && <p className="err">{err}</p>}
      <div className="module-form-actions">
        <button type="button" className="primary" disabled={busy} onClick={saveRename}>Save</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="danger-ghost" disabled={busy} onClick={archive}>Hide module</button>
      </div>
    </div>
  );
}

export default function ModuleView({ moduleId, onArchived }) {
  const modules = useModulesStore((s) => s.modules);
  const itemsByModule = useModulesStore((s) => s.itemsByModule);
  const fetchModules = useModulesStore((s) => s.fetchModules);
  const fetchItems = useModulesStore((s) => s.fetchItems);
  const addItem = useModulesStore((s) => s.addItem);
  const updateItem = useModulesStore((s) => s.updateItem);
  const deleteItem = useModulesStore((s) => s.deleteItem);

  const mod = modules.find((m) => m.id === moduleId);
  const items = itemsByModule[moduleId] || [];
  const schema = mod?.schema || [];

  const [draft, setDraft] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!mod) fetchModules().catch(() => {});
    fetchItems(moduleId).catch(() => {});
  }, [moduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(emptyDraft(schema));
    setAdding(false);
    setEditingId(null);
    setManaging(false);
  }, [moduleId, mod?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, val) { setDraft((d) => ({ ...d, [key]: val })); }

  async function submitAdd() {
    setErr('');
    try { await addItem(moduleId, coerce(schema, draft)); setDraft(emptyDraft(schema)); setAdding(false); }
    catch (e) { setErr(e.message || 'Could not save'); }
  }
  async function submitEdit(id) {
    setErr('');
    try { await updateItem(moduleId, id, coerce(schema, draft)); setEditingId(null); setDraft(emptyDraft(schema)); }
    catch (e) { setErr(e.message || 'Could not save'); }
  }
  function startEdit(item) {
    const d = emptyDraft(schema);
    for (const f of schema) d[f.key] = item.data[f.key] ?? (f.type === 'bool' ? false : '');
    setDraft(d); setEditingId(item.id); setAdding(false); setErr('');
  }

  if (!mod) return <p className="muted center-pad">Loading…</p>;

  const formOpen = adding || editingId != null;

  return (
    <div className="module-view">
      <div className="habits-toolbar">
        <strong>{mod.icon ? mod.icon + ' ' : ''}{mod.label}</strong>
        <span className="muted small">({items.length})</span>
        <span style={{ flex: 1 }} />
        {!formOpen && !managing && (
          <>
            <button type="button" onClick={() => setManaging(true)}>manage</button>
            <button type="button" onClick={() => { setDraft(emptyDraft(schema)); setErr(''); setAdding(true); }}>+ add</button>
          </>
        )}
      </div>

      {managing && (
        <ManagePanel mod={mod} onClose={() => setManaging(false)} onArchived={onArchived} />
      )}

      {schema.length === 0 && <p className="muted small">This module has no fields yet.</p>}
      {err && <p className="err">{err}</p>}

      {formOpen && (
        <div className="module-form">
          {schema.map((f) => (
            <label key={f.key} className="module-field">
              <span className="muted small">{f.label || f.key}{f.required ? ' *' : ''}</span>
              <Field field={f} value={draft[f.key] ?? (f.type === 'bool' ? false : '')} onChange={(v) => setField(f.key, v)} />
            </label>
          ))}
          <div className="module-form-actions">
            <button type="button" className="primary" onClick={() => (editingId != null ? submitEdit(editingId) : submitAdd())}>Save</button>
            <button type="button" onClick={() => { setAdding(false); setEditingId(null); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <p className="muted center-pad">No items yet — tap + add, or ask the coach to fill it.</p>
      ) : (
        <div className="module-items">
          {items.map((it) => (
            <div key={it.id} className="module-item-row">
              <div className="module-item-fields">
                {schema.map((f) => (
                  <span key={f.key} className="module-item-cell">
                    <span className="muted small">{f.label || f.key}: </span>
                    {renderValue(f, it.data[f.key])}
                  </span>
                ))}
              </div>
              <div className="module-item-actions">
                <button type="button" onClick={() => startEdit(it)}>edit</button>
                <button type="button" className="danger-ghost" onClick={() => deleteItem(moduleId, it.id).catch(() => {})}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One-tap gallery of the prebuilt template catalog, grouped by life-area.
function TemplateGallery({ onPick }) {
  const fetchTemplates = useModulesStore((s) => s.fetchTemplates);
  const [data, setData] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => { fetchTemplates().then(setData).catch(() => {}); }, [fetchTemplates]);

  if (!data || !data.templates) return null;
  const byGroup = {};
  for (const t of data.templates) (byGroup[t.group] ||= []).push(t);
  const order = data.groups && data.groups.length ? data.groups : Object.keys(byGroup);

  return (
    <div className="tpl-gallery">
      {order.filter((g) => byGroup[g]).map((g) => (
        <div key={g} className="tpl-group">
          <div className="muted small tpl-group-label">{g}</div>
          <div className="tpl-chips">
            {byGroup[g].map((t) => (
              <button
                key={t.key}
                type="button"
                className="tpl-chip"
                disabled={busyKey === t.key}
                title={t.description + (t.pairs_with ? ` · pairs with ${t.pairs_with}` : '')}
                onClick={async () => { setBusyKey(t.key); try { await onPick(t); } finally { setBusyKey(null); } }}
              >
                <span className="tpl-icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The "+ New module" builder: a template gallery, a tiny field-spec form, plus
// a one-tap hand-off to the coach for the generative path (free, uses chat).
export function NewModulePanel({ onCreated }) {
  const createModule = useModulesStore((s) => s.createModule);
  const createFromTemplate = useModulesStore((s) => s.createFromTemplate);
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('');
  const [fields, setFields] = useState([{ label: '', type: 'text', options: '', required: false }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function setF(i, patch) { setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f))); }
  function addF() { setFields((fs) => [...fs, { label: '', type: 'text', options: '', required: false }]); }
  function delF(i) { setFields((fs) => fs.filter((_, j) => j !== i)); }

  async function submit() {
    setErr('');
    const schema = [];
    for (const f of fields) {
      const key = (f.label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!key) continue;
      const spec = { key, label: f.label.trim(), type: f.type };
      if (f.type === 'select') spec.options = (f.options || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (f.required) spec.required = true;
      schema.push(spec);
    }
    if (!label.trim()) { setErr('Give it a name.'); return; }
    if (schema.length === 0) { setErr('Add at least one field with a label.'); return; }
    if (schema.some((s) => s.type === 'select' && (!s.options || s.options.length === 0))) {
      setErr('Select fields need at least one option (comma-separated).'); return;
    }
    setBusy(true);
    try {
      const created = await createModule({ label: label.trim(), icon: icon.trim(), schema });
      onCreated?.(created);
    } catch (e) { setErr(e.message || 'Could not create'); }
    finally { setBusy(false); }
  }

  function askCoach() {
    const hint = label.trim() ? ` I'm thinking of a "${label.trim()}" tracker.` : '';
    const msg = `I want to build a custom module (a mini-app) in my Library. Ask me what I want to track, propose a field schema (text/number/bool/date/select), and once I confirm, create it with create_module.${hint}`;
    const chat = useChatStore.getState();
    chat.newConversation().then(() => chat.sendMessage(msg)).catch(() => {});
    writeHashParams({ section: 'chat' });
  }

  return (
    <div className="module-new">
      <h3>New module</h3>
      <p className="muted small">Pick a ready-made template, build your own, or let the coach design it with you.</p>

      <div className="muted small module-fields-label">Start from a template</div>
      <TemplateGallery onPick={async (t) => { const created = await createFromTemplate(t.key); onCreated?.(created); }} />

      <div className="module-divider"><span className="muted small">or build your own</span></div>

      <label className="module-field">
        <span className="muted small">Name</span>
        <input type="text" value={label} placeholder="e.g. Books, Mood, Clients" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="module-field">
        <span className="muted small">Icon (emoji, optional)</span>
        <input type="text" value={icon} maxLength={2} placeholder="📚" onChange={(e) => setIcon(e.target.value)} />
      </label>

      <div className="muted small module-fields-label">Fields</div>
      {fields.map((f, i) => (
        <div key={i} className="module-new-field">
          <input type="text" placeholder="field label" value={f.label} onChange={(e) => setF(i, { label: e.target.value })} />
          <select value={f.type} onChange={(e) => setF(i, { type: e.target.value })}>
            {TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
          </select>
          {f.type === 'select' && (
            <input type="text" placeholder="option1, option2" value={f.options} onChange={(e) => setF(i, { options: e.target.value })} />
          )}
          <label className="module-req muted small">
            <input type="checkbox" checked={f.required} onChange={(e) => setF(i, { required: e.target.checked })} /> req
          </label>
          <button type="button" className="danger-ghost" onClick={() => delF(i)}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addF}>+ field</button>

      {err && <p className="err">{err}</p>}
      <div className="module-form-actions module-new-actions">
        <button type="button" className="primary" disabled={busy} onClick={submit}>Create</button>
        <button type="button" onClick={askCoach}>Let the coach build it</button>
      </div>
    </div>
  );
}
