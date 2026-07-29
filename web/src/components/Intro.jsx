import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';

// First-run welcome carousel — explains what Helm is and gets a brand-new
// user excited. Shown once, replayable from the "?" in the top bar. All copy
// comes from the i18n dictionary so it follows the EN/ES toggle.
const EMOJI = ['🧭', '🎯', '🎙️', '🌱', '✨'];

export default function Intro({ onDone }) {
  const t = useT();
  const [i, setI] = useState(0);
  const last = i === EMOJI.length - 1;
  const n = i + 1;

  function next() { if (last) onDone && onDone(); else setI(i + 1); }
  function back() { if (i > 0) setI(i - 1); }

  return (
    <div className="intro-overlay">
      <style>{INTRO_CSS}</style>
      {!last && <button type="button" className="intro-skip" onClick={onDone}>{t('intro.skip')}</button>}

      <div className="intro-slide" key={i}>
        <div className="intro-emoji">{EMOJI[i]}</div>
        <h1 className="intro-title">{t(`intro.s${n}.title`)}</h1>
        <p className="intro-body">{t(`intro.s${n}.body`)}</p>
      </div>

      <div className="intro-dots">
        {EMOJI.map((_, k) => (
          <span
            key={k}
            className={`intro-dot${k === i ? ' on' : ''}`}
            onClick={() => setI(k)}
            role="button"
            aria-label={`slide ${k + 1}`}
          />
        ))}
      </div>

      <div className="intro-nav">
        {i > 0 ? <button type="button" className="intro-back" onClick={back}>{t('intro.back')}</button> : <span />}
        <button type="button" className="intro-next primary" onClick={next}>{last ? t('intro.start') : t('intro.next')}</button>
      </div>
    </div>
  );
}

const INTRO_CSS = `
.intro-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: radial-gradient(130% 130% at 50% 18%, color-mix(in srgb, var(--accent) 22%, var(--bg)) 0%, var(--bg) 60%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px 26px;
  padding-top: calc(32px + env(safe-area-inset-top));
  padding-bottom: calc(26px + env(safe-area-inset-bottom));
  text-align: center;
  animation: intro-fade 240ms ease;
}
@keyframes intro-fade { from { opacity: 0; } to { opacity: 1; } }
.intro-skip {
  position: absolute; top: calc(16px + env(safe-area-inset-top)); right: 18px;
  background: transparent; border: none; color: var(--muted); font-weight: 600; padding: 8px;
}
.intro-skip:hover { color: var(--text); }
.intro-slide {
  max-width: 440px; margin: auto 0;
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  animation: intro-in 340ms var(--ease, ease);
}
@keyframes intro-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.intro-emoji { font-size: 72px; line-height: 1; }
.intro-title { font-family: var(--font-display); font-weight: 600; font-size: 30px; letter-spacing: -0.02em; margin: 0; }
.intro-body { font-size: 16.5px; line-height: 1.55; color: var(--muted); margin: 0; }
.intro-dots { display: flex; gap: 8px; margin: 26px 0 18px; }
.intro-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); cursor: pointer; transition: all 180ms var(--ease, ease); }
.intro-dot.on { background: var(--accent); width: 22px; border-radius: 4px; }
.intro-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; max-width: 440px; }
.intro-back { background: transparent; border: none; color: var(--muted); font-weight: 600; }
.intro-back:hover { color: var(--text); }
.intro-next { font-size: 16px; padding: 13px 30px; border-radius: 999px; min-width: 132px; }
`;
