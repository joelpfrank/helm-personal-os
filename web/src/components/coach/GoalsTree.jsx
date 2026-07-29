import React, { useEffect, useState } from 'react';
import { useCoachStore } from '../../state/coach.js';

const HORIZON_ORDER = ['vision', 'year', 'quarter', 'month', 'week'];
const HORIZON_LABEL = {
  vision: 'Vision', year: 'Year', quarter: 'Quarter', month: 'Month', week: 'Week',
};

function GoalCard({ goal, allGoals, onUpdate, onComplete, onDelete, onAddObstacle, onDeleteObstacle, onAddChild }) {
  const [expanded, setExpanded] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const [addingObstacle, setAddingObstacle] = useState(false);
  const [obstacle, setObstacle] = useState('');
  const [ifThen, setIfThen] = useState('');
  const children = allGoals.filter((g) => g.parent_id === goal.id);

  function commitChild() {
    const title = childTitle.trim();
    if (!title) { setAddingChild(false); return; }
    const childHorizon = (HORIZON_ORDER[HORIZON_ORDER.indexOf(goal.horizon) + 1]) || goal.horizon;
    onAddChild({ parent_id: goal.id, title, horizon: childHorizon });
    setChildTitle('');
    setAddingChild(false);
  }
  function commitObstacle() {
    const o = obstacle.trim(); const i = ifThen.trim();
    if (!o || !i) { setAddingObstacle(false); return; }
    onAddObstacle(goal.id, o, i);
    setObstacle(''); setIfThen(''); setAddingObstacle(false);
  }

  return (
    <div className={`goal-card${goal.status === 'done' ? ' done' : ''}`}>
      <div className="goal-card-head">
        <button
          type="button"
          className="goal-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'collapse' : 'expand'}
        >{expanded ? '▾' : '▸'}</button>
        <input
          key={`title-${goal.id}-${goal.title}`}
          type="text"
          className="goal-title"
          defaultValue={goal.title}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== goal.title) onUpdate({ title: v });
          }}
        />
        <span className={`goal-horizon-tag horizon-${goal.horizon}`}>{HORIZON_LABEL[goal.horizon]}</span>
        {goal.target_date && <span className="muted small">due {goal.target_date}</span>}
        {goal.status === 'active' && (
          <button type="button" className="goal-complete" onClick={onComplete} title="mark done">✓</button>
        )}
        <button type="button" className="goal-delete danger" onClick={() => {
          if (window.confirm(`delete goal "${goal.title}"? (also deletes its sub-goals)`)) onDelete();
        }} title="delete">×</button>
      </div>

      {expanded && (
        <div className="goal-card-body">
          <label className="goal-field">
            <span className="muted small">why / description</span>
            <textarea
              key={`desc-${goal.id}-${goal.description}`}
              defaultValue={goal.description}
              rows={2}
              placeholder="Why does this goal matter?"
              onBlur={(e) => { if (e.target.value !== goal.description) onUpdate({ description: e.target.value }); }}
            />
          </label>
          <div className="goal-field-row">
            <label className="goal-field">
              <span className="muted small">success criteria</span>
              <input
                key={`crit-${goal.id}-${goal.success_criteria}`}
                type="text"
                defaultValue={goal.success_criteria}
                placeholder="How do we know it's done?"
                onBlur={(e) => { if (e.target.value !== goal.success_criteria) onUpdate({ success_criteria: e.target.value }); }}
              />
            </label>
            <label className="goal-field" style={{ flex: '0 0 160px' }}>
              <span className="muted small">target date</span>
              <input
                key={`date-${goal.id}-${goal.target_date || ''}`}
                type="date"
                defaultValue={goal.target_date || ''}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  if (v !== goal.target_date) onUpdate({ target_date: v });
                }}
              />
            </label>
          </div>

          <div className="goal-obstacles">
            <div className="muted small">Obstacles + if-then plans (WOOP)</div>
            {(goal.obstacles || []).map((o) => (
              <div key={o.id} className="obstacle-row">
                <span><strong>{o.obstacle}</strong> → {o.if_then}</span>
                <button type="button" className="danger" onClick={() => onDeleteObstacle(o.id)}>×</button>
              </div>
            ))}
            {addingObstacle ? (
              <div className="obstacle-add">
                <input type="text" placeholder="Obstacle (e.g. 'I skip workouts when traveling')"
                  value={obstacle} onChange={(e) => setObstacle(e.target.value)} autoFocus />
                <input type="text" placeholder="If-then (e.g. 'IF I'm in a hotel THEN 50 pushups in the room')"
                  value={ifThen} onChange={(e) => setIfThen(e.target.value)} />
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setAddingObstacle(false)}>cancel</button>
                <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={commitObstacle}>add</button>
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={() => setAddingObstacle(true)}>+ obstacle</button>
            )}
          </div>

          {(goal.links?.length || 0) > 0 && (
            <div className="goal-links">
              <div className="muted small">Linked to:</div>
              {goal.links.map((l) => (
                <span key={l.id} className="goal-link-chip">{l.kind} #{l.target_id}</span>
              ))}
            </div>
          )}

          <div className="goal-children">
            {children.map((c) => (
              <GoalCard
                key={c.id}
                goal={c}
                allGoals={allGoals}
                onUpdate={(p) => useCoachStore.getState().updateGoal(c.id, p)}
                onComplete={() => useCoachStore.getState().completeGoal(c.id)}
                onDelete={() => useCoachStore.getState().deleteGoal(c.id)}
                onAddObstacle={(gid, o, t) => useCoachStore.getState().addObstacle(gid, o, t)}
                onDeleteObstacle={(oid) => useCoachStore.getState().deleteObstacle(oid)}
                onAddChild={(fields) => useCoachStore.getState().addGoal(fields)}
              />
            ))}
            {addingChild ? (
              <div className="goal-child-add">
                <input
                  type="text" autoFocus
                  placeholder={`New ${HORIZON_LABEL[HORIZON_ORDER[HORIZON_ORDER.indexOf(goal.horizon) + 1]] || ''} goal under "${goal.title}"`}
                  value={childTitle}
                  onChange={(e) => setChildTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitChild(); if (e.key === 'Escape') { setAddingChild(false); setChildTitle(''); } }}
                  onBlur={commitChild}
                />
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={() => setAddingChild(true)}>+ sub-goal</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GoalsTree() {
  const goals = useCoachStore((s) => s.goals);
  const fetchGoals = useCoachStore((s) => s.fetchGoals);
  const addGoal = useCoachStore((s) => s.addGoal);
  const updateGoal = useCoachStore((s) => s.updateGoal);
  const completeGoal = useCoachStore((s) => s.completeGoal);
  const deleteGoal = useCoachStore((s) => s.deleteGoal);
  const addObstacle = useCoachStore((s) => s.addObstacle);
  const deleteObstacle = useCoachStore((s) => s.deleteObstacle);

  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftHorizon, setDraftHorizon] = useState('year');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => { fetchGoals().catch(() => {}); }, [fetchGoals]);

  const roots = goals.filter((g) => !g.parent_id && (showDone || g.status !== 'done'));

  function commitNew() {
    const title = draftTitle.trim();
    if (!title) { setAdding(false); return; }
    addGoal({ title, horizon: draftHorizon }).catch(() => {});
    setDraftTitle('');
    setAdding(false);
  }

  return (
    <div className="goals-tree">
      <div className="goals-toolbar">
        <h3>Goals</h3>
        <span style={{ flex: 1 }} />
        <label className="muted small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          show done
        </label>
        {!adding && <button type="button" onClick={() => setAdding(true)}>+ goal</button>}
      </div>

      {adding && (
        <div className="goal-new">
          <select value={draftHorizon} onChange={(e) => setDraftHorizon(e.target.value)}>
            {HORIZON_ORDER.map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
          </select>
          <input
            type="text" autoFocus placeholder="Top-level goal title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitNew(); if (e.key === 'Escape') { setAdding(false); setDraftTitle(''); } }}
            onBlur={commitNew}
            style={{ flex: 1 }}
          />
        </div>
      )}

      {roots.length === 0 && !adding && (
        <p className="muted center-pad">
          No goals yet. Open the Chat tab and say <em>"help me reverse-engineer my vision into goals"</em>.
        </p>
      )}

      <div className="goal-list">
        {roots.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            allGoals={goals.filter((x) => showDone || x.status !== 'done')}
            onUpdate={(p) => updateGoal(g.id, p)}
            onComplete={() => completeGoal(g.id)}
            onDelete={() => deleteGoal(g.id)}
            onAddObstacle={(gid, o, t) => addObstacle(gid, o, t)}
            onDeleteObstacle={(oid) => deleteObstacle(oid)}
            onAddChild={(fields) => addGoal(fields)}
          />
        ))}
      </div>
    </div>
  );
}
