import React from 'react';
import PrimaryNavigation from './PrimaryNavigation.jsx';
import { paletteLabel } from '../../lib/theme.js';

function HelmMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 20V12M22 20V12M10 16h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AppearanceIcon({ theme }) {
  if (theme === 'system') {
    return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
  }
  if (theme === 'dark') {
    return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20.4 14.6A8.7 8.7 0 0 1 9.4 3.6 8.7 8.7 0 1 0 20.4 14.6Z"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
}

// Two overlapping swatches — reads as "color set", distinct from the
// sun/moon/display glyph that switches light and dark.
function PaletteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9.5" cy="9.5" r="6"/><circle cx="15" cy="15" r="6"/></svg>;
}

function AISettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
}

export default function AppShell({
  sections,
  section,
  onSelectSection,
  labelFor,
  theme,
  onCycleTheme,
  palette,
  onCyclePalette,
  language,
  onToggleLanguage,
  onShowAbout,
  onShowSettings,
  children,
}) {
  const sectionLabel = labelFor(section);

  function skipToContent(event) {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={skipToContent}>Skip to content</a>
      <aside className="app-rail" aria-label="Helm">
        <div className="app-brand" aria-label="Helm home">
          <HelmMark />
          <span>Helm</span>
        </div>
        <PrimaryNavigation items={sections} activeId={section} onSelect={onSelectSection} labelFor={labelFor} />
        <div className="app-utilities" aria-label="Workspace controls">
          <button type="button" className="shell-icon-button" onClick={onShowSettings} aria-label="AI settings" title="AI settings"><AISettingsIcon /></button>
          <button type="button" className="shell-icon-button language-button" onClick={onToggleLanguage} aria-label={language === 'es' ? 'Switch to English' : 'Switch to Spanish'} title={language === 'es' ? 'Switch to English' : 'Switch to Spanish'}>{language.toUpperCase()}</button>
          <button type="button" className="shell-icon-button" onClick={onShowAbout} aria-label="About Helm" title="About Helm">?</button>
          <button type="button" className="shell-icon-button" onClick={onCyclePalette} aria-label={`Color theme: ${paletteLabel(palette)}`} title={`Color theme: ${paletteLabel(palette)}`}><PaletteIcon /></button>
          <button type="button" className="shell-icon-button" onClick={onCycleTheme} aria-label={`Appearance: ${theme}`} title={`Appearance: ${theme}`}><AppearanceIcon theme={theme} /></button>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="workspace-header">
          <div>
            <span className="workspace-eyebrow">Workspace</span>
            <h1>{sectionLabel}</h1>
          </div>
          <span className="workspace-status"><span aria-hidden="true" /> Local workspace</span>
        </header>
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
