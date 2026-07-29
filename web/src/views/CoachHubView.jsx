import React, { useEffect, useState } from 'react';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import { resolveCoachTab, COACH_TABS } from '../lib/nav.js';
import TodayView from './TodayView.jsx';
import ChatView from './ChatView.jsx';
import GoalsTree from '../components/coach/GoalsTree.jsx';
import VisionPanel from '../components/coach/VisionPanel.jsx';
import CheckInHistory from '../components/coach/CheckInHistory.jsx';
import { useCoachStore } from '../state/coach.js';
import { useT } from '../lib/i18n.js';

// Coach hub: composes the pre-simplification Today/Chat/Goals/Vision/
// Check-ins views behind a compact secondary nav, defaulting to Today
// (the daily check-in home). See web/src/lib/nav.js for the routing
// contract, including backward compatibility with old section=today,
// section=chat and section=library&lib=goals|vision|checkins links.

function readTab() {
  return resolveCoachTab({
    section: getHashParam('section'),
    lib: getHashParam('lib'),
    ctab: getHashParam('ctab'),
  });
}

export default function CoachHubView() {
  const [tab, setTab] = useState(readTab);
  const fetchAll = useCoachStore((s) => s.fetchAll);
  const t = useT();

  // Cold links can open Vision/Goals/Check-ins without ever mounting TodayView.
  // Hydrate the shared coach store here so every inner tab owns a complete load
  // path instead of relying on a sibling view's side effect.
  useEffect(() => { fetchAll().catch(() => {}); }, [fetchAll]);
  useEffect(() => onHashChange(() => setTab(readTab())), []);

  function switchTab(id) {
    writeHashParams({ section: 'coach', ctab: id, lib: null });
    setTab(id);
  }

  return (
    <div className="coach-hub">
      <nav className="coach-tabs">
        {COACH_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`coach-tab${tab === id ? ' on' : ''}`}
            onClick={() => switchTab(id)}
          >{t('nav.' + id)}</button>
        ))}
      </nav>
      <div className="coach-hub-body">
        {tab === 'today'    && <TodayView />}
        {tab === 'chat'     && <ChatView />}
        {tab === 'goals'    && <GoalsTree />}
        {tab === 'vision'   && <VisionPanel />}
        {tab === 'checkins' && <CheckInHistory />}
      </div>
    </div>
  );
}
