import React, { useEffect, useState } from 'react';
import { hasToken } from './api.js';
import { useTheme, nextTheme, usePalette, nextPalette } from './lib/theme.js';
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
import AppShell from './components/shell/AppShell.jsx';
import ProviderSettingsView from './views/ProviderSettingsView.jsx';

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

function readSection() {
  return resolvePrimarySection({ section: getHashParam('section'), lib: getHashParam('lib') });
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [palette, setPalette] = usePalette();
  const [section, setSection] = useState(readSection);
  const [authed, setAuthed] = useState(() => hasToken());
  const [introDone, setIntroDone] = useState(() => {
    try { return localStorage.getItem('helm_intro_seen') === '1'; } catch { return true; }
  });
  const [replayIntro, setReplayIntro] = useState(false);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  useEffect(() => {
    return onHashChange(() => setSection(readSection()));
  }, []);

  useEffect(() => {
    function openProviderSettings() { setProviderSettingsOpen(true); }
    window.addEventListener('helm:open-ai-settings', openProviderSettings);
    return () => window.removeEventListener('helm:open-ai-settings', openProviderSettings);
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

  function cyclePalette() {
    setPalette(nextPalette(palette));
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
    <>
    <AppShell
      sections={SECTIONS}
      section={section}
      onSelectSection={switchSection}
      labelFor={(id) => t('nav.' + id)}
      theme={theme}
      onCycleTheme={cycleTheme}
      palette={palette}
      onCyclePalette={cyclePalette}
      language={lang}
      onToggleLanguage={toggleLang}
      onShowAbout={() => setReplayIntro(true)}
      onShowSettings={() => setProviderSettingsOpen(true)}
    >
      {section === 'tasks' && <TasksView />}
      {section === 'food' && <FoodView />}
      {section === 'habits' && <HabitsView />}
      {section === 'workouts' && <WorkoutsView />}
      {section === 'coach' && <CoachHubView />}
    </AppShell>
    {providerSettingsOpen && <ProviderSettingsView onClose={() => setProviderSettingsOpen(false)} />}
    </>
  );
}
