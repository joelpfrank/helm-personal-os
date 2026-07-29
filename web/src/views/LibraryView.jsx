import React, { useEffect, useState } from 'react';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import TasksView from './TasksView.jsx';
import HabitsView from './HabitsView.jsx';
import WorkoutsView from './WorkoutsView.jsx';
import FoodView from './FoodView.jsx';
import ModuleView, { NewModulePanel } from './ModuleView.jsx';
import VisionPanel from '../components/coach/VisionPanel.jsx';
import GoalsTree from '../components/coach/GoalsTree.jsx';
import CheckInHistory from '../components/coach/CheckInHistory.jsx';
import FirstRunHint from '../components/FirstRunHint.jsx';
import { useModulesStore } from '../state/modules.js';
import { useT } from '../lib/i18n.js';

const COLLECTIONS = [
  { id: 'goals',     label: 'Goals',     group: 'Coach' },
  { id: 'vision',    label: 'Vision',    group: 'Coach' },
  { id: 'checkins',  label: 'Check-ins', group: 'Coach' },
  { id: 'tasks',     label: 'Tasks',     group: 'Life' },
  { id: 'habits',    label: 'Habits',    group: 'Life' },
  { id: 'workouts',  label: 'Workouts',  group: 'Life' },
  { id: 'food',      label: 'Food',      group: 'Life' },
];

function readCollection() {
  const c = getHashParam('lib');
  if (!c) return 'goals';
  if (c === 'new-module' || c === 'archived-modules' || c.startsWith('module:')) return c;
  return COLLECTIONS.some((x) => x.id === c) ? c : 'goals';
}

// Hidden (archived) modules — data is fully preserved; restore brings a
// module straight back into the nav.
function ArchivedModulesPanel({ onRestored }) {
  const archived = useModulesStore((s) => s.archivedModules);
  const fetchArchivedModules = useModulesStore((s) => s.fetchArchivedModules);
  const restoreModule = useModulesStore((s) => s.restoreModule);

  useEffect(() => { fetchArchivedModules().catch(() => {}); }, [fetchArchivedModules]);

  return (
    <div className="module-view">
      <div className="habits-toolbar"><strong>Archived modules</strong></div>
      <p className="muted small">Hidden modules keep all their data. Restore one to bring it back.</p>
      {archived.length === 0 ? (
        <p className="muted center-pad">Nothing archived.</p>
      ) : (
        <div className="module-items">
          {archived.map((m) => (
            <div key={m.id} className="module-item-row">
              <div className="module-item-fields">
                <span className="module-item-cell">{(m.icon ? m.icon + ' ' : '') + m.label}</span>
              </div>
              <div className="module-item-actions">
                <button type="button" onClick={() => restoreModule(m.id).then(() => onRestored?.(m)).catch(() => {})}>Restore</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LibraryView() {
  const [active, setActive] = useState(readCollection);
  const modules = useModulesStore((s) => s.modules);
  const archivedModules = useModulesStore((s) => s.archivedModules);
  const fetchModules = useModulesStore((s) => s.fetchModules);
  const fetchArchivedModules = useModulesStore((s) => s.fetchArchivedModules);
  const t = useT();

  useEffect(() => onHashChange(() => setActive(readCollection())), []);
  useEffect(() => { fetchModules().catch(() => {}); }, [fetchModules]);
  useEffect(() => { fetchArchivedModules().catch(() => {}); }, [fetchArchivedModules]);

  function switchTo(id) {
    writeHashParams({ lib: id });
    setActive(id);
  }

  const moduleCollections = modules.map((m) => ({
    id: 'module:' + m.id,
    label: (m.icon ? m.icon + ' ' : '') + m.label,
    group: m.group_name || 'Custom',
  }));

  const grouped = [...COLLECTIONS, ...moduleCollections].reduce((acc, c) => {
    (acc[c.group] ||= []).push(c);
    return acc;
  }, {});

  const moduleId = active.startsWith('module:') ? Number(active.slice('module:'.length)) : null;

  return (
    <div className="library-view">
      <nav className="library-nav">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="library-group">
            <div className="library-group-label muted small">{group}</div>
            {items.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`library-nav-btn${active === c.id ? ' on' : ''}`}
                onClick={() => switchTo(c.id)}
              >{c.label}</button>
            ))}
          </div>
        ))}
        <div className="library-group">
          <button
            type="button"
            className={`library-nav-btn library-nav-new${active === 'new-module' ? ' on' : ''}`}
            onClick={() => switchTo('new-module')}
          >+ New module</button>
          {archivedModules.length > 0 && (
            <button
              type="button"
              className={`library-nav-btn${active === 'archived-modules' ? ' on' : ''}`}
              onClick={() => switchTo('archived-modules')}
            >Archived ({archivedModules.length})</button>
          )}
        </div>
      </nav>
      <div className="library-body">
        <FirstRunHint id="library">{t('hint.library')}</FirstRunHint>
        {active === 'goals'      && <GoalsTree />}
        {active === 'vision'     && <VisionPanel />}
        {active === 'checkins'   && <CheckInHistory />}
        {active === 'tasks'      && <TasksView />}
        {active === 'habits'     && <HabitsView />}
        {active === 'workouts'   && <WorkoutsView />}
        {active === 'food'       && <FoodView />}
        {active === 'new-module' && <NewModulePanel onCreated={(m) => switchTo('module:' + m.id)} />}
        {active === 'archived-modules' && <ArchivedModulesPanel onRestored={(m) => switchTo('module:' + m.id)} />}
        {moduleId != null        && <ModuleView key={moduleId} moduleId={moduleId} onArchived={() => switchTo('archived-modules')} />}
      </div>
    </div>
  );
}
