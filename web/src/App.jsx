import React, { useEffect, useState } from 'react';
import { hasToken } from './api.js';
import { useTheme, THEMES, nextTheme } from './lib/theme.js';
import { getHashParam, writeHashParams, onHashChange } from './lib/hash.js';
import { resolvePrimarySection } from './lib/nav.js';
import TasksView from './views/TasksView.jsx';
import FoodView from './views/FoodView.jsx';
import HabitsView from './views/HabitsView.jsx';
import WorkoutsView from './views/WorkoutsView.jsx';
import CoachHubView from './views/CoachHubView.jsx';
import Login from './Login.jsx';
import Intro from './components/Intro.jsx';
import { useT, useLangStore } from './lib/i18n.js';
import { apiPatch } from './api.js';

// Simplified shell: Tasks / Food / Habits / Workouts render directly, no
// Library gate. Coach composes the old Today/Chat/Goals/Vision/Check-ins
// experience behind its own compact secondary nav (see CoachHubView).
// LibraryView/ModuleView and everything else stay fully intact on disk —
// this is a reversible presentation-layer change, not a deletion.
const SECTIONS = [
  { id: 'tasks',    label: 'Tasks' },
  { id: 'food',     label: 'Food' },
  { id: 'habits',   label: 'Habits' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'coach',    label: 'Coach' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
function FlowerIcon() {
  // Four-petal flower with center. Pink-ish (uses currentColor so it
  // inherits the topbar text color).
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <circle cx="12" cy="6" r="3.5"/>
      <circle cx="18" cy="12" r="3.5"/>
      <circle cx="12" cy="18" r="3.5"/>
      <circle cx="6" cy="12" r="3.5"/>
      <circle cx="12" cy="12" r="2.5" fill="var(--bg)"/>
    </svg>
  );
}

// What icon represents "the theme you'd switch TO".
function IconForNext({ theme }) {
  const next = nextTheme(theme);
  if (next === 'dark') return <MoonIcon />;
  if (next === 'light') return <SunIcon />;
  return <FlowerIcon />;
}

function readSection() {
  return resolvePrimarySection({ section: getHashParam('section'), lib: getHashParam('lib') });
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [section, setSection] = useState(readSection);
  const [authed, setAuthed] = useState(() => hasToken());
  const [introDone, setIntroDone] = useState(() => {
    try { return localStorage.getItem('helm_intro_seen') === '1'; } catch { return true; }
  });
  const [replayIntro, setReplayIntro] = useState(false);
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  useEffect(() => {
    return onHashChange(() => setSection(readSection()));
  }, []);

  useEffect(() => {
    // Keep the coach's reply language in sync with the UI language — but only
    // once logged in. Before login this PATCH 401s and the reload-on-401 path
    // would loop the page ("Cargando…" flashing).
    if (!authed) return;
    apiPatch('/chat/settings', { language: lang }).catch(() => {});
  }, [lang, authed]);

  function switchSection(id) {
    writeHashParams({ section: id });
    setSection(id);
  }

  function cycleTheme() {
    setTheme(nextTheme(theme));
  }

  function toggleLang() {
    const next = lang === 'es' ? 'en' : 'es';
    setLang(next);
  }

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }

  if (!introDone || replayIntro) {
    return (
      <Intro onDone={() => {
        try { localStorage.setItem('helm_intro_seen', '1'); } catch { /* ignore */ }
        setIntroDone(true);
        setReplayIntro(false);
      }} />
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <nav className="section-tabs">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`section-tab${section === s.id ? ' on' : ''}`}
              onClick={() => switchSection(s.id)}
            >{t('nav.' + s.id)}</button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleLang}
          title={t('topbar.lang')}
          aria-label="language"
          style={{ fontWeight: 700, fontSize: '12px' }}
        >{lang.toUpperCase()}</button>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setReplayIntro(true)}
          title={t('topbar.about')}
          aria-label="about Helm"
          style={{ fontWeight: 700, fontSize: '16px' }}
        >?</button>
        <button
          type="button"
          className="theme-toggle"
          onClick={cycleTheme}
          title={`switch to ${nextTheme(theme)} mode`}
          aria-label="cycle theme"
        >
          <IconForNext theme={theme} />
        </button>
      </header>
      {section === 'tasks' && <TasksView />}
      {section === 'food' && <FoodView />}
      {section === 'habits' && <HabitsView />}
      {section === 'workouts' && <WorkoutsView />}
      {section === 'coach' && <CoachHubView />}
    </div>
  );
}
