import React, { useEffect, useState } from 'react';
import { useAgentsStore } from '../state/agents.js';
import { useChatStore } from '../state/chat.js';
import { writeHashParams } from '../lib/hash.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function scheduleLabel(a) {
  if (a.schedule_freq === 'manual') return 'interactive';
  if (a.schedule_freq === 'hourly') return 'hourly';
  if (a.schedule_freq === 'weekly') return `weekly · ${DOW[(a.schedule_dow || 1) - 1]} ${a.schedule_time || ''}`.trim();
  return `daily · ${a.schedule_time || ''}`.trim();
}

function whenLabel(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function AgentRow({ a, onRun, onToggle, onDelete, onChat, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`agent-row${a.enabled ? '' : ' off'}`}>
      <div className="agent-main">
        <div className="agent-head">
          <strong>{a.icon ? a.icon + ' ' : ''}{a.label}</strong>
          <span className="agent-badge">{scheduleLabel(a)}</span>
          {a.schedule_freq !== 'manual' && a.next_run_at && (
            <span className="muted small">next {whenLabel(a.next_run_at)}</span>
          )}
        </div>
        {a.last_status && (
          <div className="muted small agent-last" onClick={() => setOpen(!open)}>
            <span className={`agent-dot ${a.last_status}`} /> last run {a.last_status}
            {a.last_summary ? ` — ${open ? a.last_summary : a.last_summary.slice(0, 90) + (a.last_summary.length > 90 ? '…' : '')}` : ''}
          </div>
        )}
      </div>
      <div className="agent-actions">
        {a.kind === 'interactive'
          ? <button type="button" onClick={() => onChat(a)}>chat</button>
          : <button type="button" disabled={busy} onClick={() => onRun(a)}>{busy ? '…' : 'run now'}</button>}
        <label className="mcp-req muted small">
          <input type="checkbox" checked={a.enabled} onChange={(e) => onToggle(a, e.target.checked)} /> on
        </label>
        <button type="button" className="danger-ghost" onClick={() => onDelete(a)}>✕</button>
      </div>
    </div>
  );
}

function AgentTemplates({ onPick }) {
  const fetchTemplates = useAgentsStore((s) => s.fetchTemplates);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { fetchTemplates().then(setData).catch(() => {}); }, [fetchTemplates]);
  if (!data || !data.templates) return null;
  return (
    <div className="tpl-chips">
      {data.templates.map((t) => (
        <button
          key={t.key}
          type="button"
          className="tpl-chip"
          disabled={busy === t.key}
          title={`${t.description}${t.kind === 'scheduled' ? ` · ${t.schedule ? t.schedule.freq : 'scheduled'}` : ' · interactive'}${t.pairs_with ? ` · pairs with ${t.pairs_with}` : ''}`}
          onClick={async () => { setBusy(t.key); try { await onPick(t); } finally { setBusy(null); } }}
        >
          <span className="tpl-icon">{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}

function NewAgent({ onCreateTemplate, onCreate }) {
  const [type, setType] = useState('interactive');
  const [label, setLabel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [task, setTask] = useState('');
  const [freq, setFreq] = useState('daily');
  const [time, setTime] = useState('08:00');
  const [dow, setDow] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const scheduled = type === 'scheduled';

  async function submit() {
    setErr('');
    if (!label.trim()) { setErr('Give it a name.'); return; }
    if (!instructions.trim()) { setErr('Give it instructions (its job and personality).'); return; }
    if (scheduled && !task.trim()) { setErr('A scheduled agent needs a task — what it does each run.'); return; }
    const body = { label: label.trim(), instructions: instructions.trim(), kind: type };
    if (scheduled) {
      body.task = task.trim();
      body.schedule_freq = freq;
      if (freq !== 'hourly') body.schedule_time = time;
      if (freq === 'weekly') body.schedule_dow = dow;
    }
    setBusy(true);
    try {
      await onCreate(body);
      setLabel(''); setInstructions(''); setTask('');
    } catch (e) { setErr(e.message || 'Could not create'); }
    finally { setBusy(false); }
  }

  return (
    <div className="agent-new">
      <h3>New agent</h3>
      <p className="muted small">Start from a template, or build your own. Scheduled agents run themselves and report back; interactive ones you open and chat with.</p>

      <div className="muted small module-fields-label">From a template</div>
      <AgentTemplates onPick={onCreateTemplate} />

      <div className="module-divider"><span className="muted small">or build your own</span></div>

      <div className="agent-type-toggle">
        <button type="button" className={type === 'interactive' ? 'on' : ''} onClick={() => setType('interactive')}>Interactive</button>
        <button type="button" className={type === 'scheduled' ? 'on' : ''} onClick={() => setType('scheduled')}>Scheduled</button>
      </div>

      <label className="module-field"><span className="muted small">Name</span>
        <input type="text" value={label} placeholder="e.g. Morning Brief, Money agent" onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="module-field"><span className="muted small">Instructions (its job + personality)</span>
        <textarea rows={3} value={instructions} placeholder="You are…" onChange={(e) => setInstructions(e.target.value)} /></label>

      {scheduled && (
        <>
          <label className="module-field"><span className="muted small">Task (what it does each run)</span>
            <textarea rows={2} value={task} placeholder="Each run, do…" onChange={(e) => setTask(e.target.value)} /></label>
          <div className="agent-sched-row">
            <select value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="hourly">hourly</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
            </select>
            {freq !== 'hourly' && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            {freq === 'weekly' && (
              <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
                {DOW.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            )}
          </div>
        </>
      )}

      {err && <p className="err">{err}</p>}
      <div className="module-form-actions"><button type="button" className="primary" disabled={busy} onClick={submit}>Create agent</button></div>
    </div>
  );
}

export default function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const createFromTemplate = useAgentsStore((s) => s.createFromTemplate);
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateAgent = useAgentsStore((s) => s.updateAgent);
  const deleteAgent = useAgentsStore((s) => s.deleteAgent);
  const runNow = useAgentsStore((s) => s.runNow);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => { fetchAgents().catch(() => {}); }, [fetchAgents]);

  async function onRun(a) {
    setBusyId(a.id); setNote('');
    try {
      const r = await runNow(a.id);
      setNote(`${a.label}: ${r?.status === 'ok' ? 'done' : r?.status || 'done'}`);
    } catch (e) { setNote(`${a.label}: ${e.message || 'failed'}`); }
    finally { setBusyId(null); }
  }
  async function onChat(a) {
    try { await useChatStore.getState().newConversation({ agent_id: a.id }); writeHashParams({ section: 'chat' }); }
    catch { /* ignore */ }
  }

  return (
    <div className="agents-view">
      <div className="mcp-intro">
        <h2>Agents</h2>
        <p className="muted small">Your coach is the default agent. Here you can add more — scheduled automations that run themselves and report back, or interactive specialists you chat with. Scheduled agents work unattended and flag anything risky for you rather than doing it.</p>
        {note && <p className="muted small">{note}</p>}
      </div>

      <div className="agent-list">
        {agents.length === 0
          ? <p className="muted small">No extra agents yet — add one below.</p>
          : agents.map((a) => (
            <AgentRow
              key={a.id}
              a={a}
              busy={busyId === a.id}
              onRun={onRun}
              onChat={onChat}
              onToggle={(ag, on) => updateAgent(ag.id, { enabled: on }).catch(() => {})}
              onDelete={(ag) => deleteAgent(ag.id).catch(() => {})}
            />
          ))}
      </div>

      <NewAgent
        onCreateTemplate={async (t) => { await createFromTemplate(t.key); }}
        onCreate={createAgent}
      />
    </div>
  );
}
