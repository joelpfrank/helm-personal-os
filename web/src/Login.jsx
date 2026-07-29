import React, { useEffect, useState } from 'react';
import { getAuthStatus, login, setupPassword } from './api.js';
import { useT } from './lib/i18n.js';

// Password gate shown when the browser has no stored token. On first run
// (no password set on the server yet) it asks the user to create one;
// afterwards it asks them to log in. Success stores the API token and
// calls onAuthed() to hand control to the app.
export default function Login({ onAuthed }) {
  const [mode, setMode] = useState('loading'); // loading | setup | login
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = useT();

  useEffect(() => {
    let alive = true;
    getAuthStatus()
      .then((s) => { if (alive) setMode(s.hasPassword ? 'login' : 'setup'); })
      .catch(() => { if (alive) setMode('login'); });
    return () => { alive = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'setup') {
      if (password.length < 6) { setError(t('login.errMin')); return; }
      if (password !== confirm) { setError(t('login.errMatch')); return; }
    }
    setBusy(true);
    try {
      if (mode === 'setup') await setupPassword(password);
      else await login(password);
      onAuthed();
    } catch (err) {
      setError(err?.message || t('login.errGeneric'));
      setBusy(false);
    }
  }

  const wrap = {
    minHeight: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '24px',
  };
  const card = {
    width: '100%', maxWidth: '360px', background: 'var(--panel)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-md)', padding: '24px',
    display: 'flex', flexDirection: 'column', gap: '14px',
  };
  const field = {
    width: '100%', padding: '11px 12px', fontSize: '16px',
    background: 'var(--panel-hi)', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  };
  const btn = {
    width: '100%', padding: '11px 12px', fontSize: 'var(--font-base)',
    fontWeight: 600, background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-sm)',
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
  };

  if (mode === 'loading') {
    return <div style={wrap}><div className="muted">{t('login.loading')}</div></div>;
  }

  return (
    <div style={wrap}>
      <form style={card} onSubmit={submit}>
        <div style={{ fontSize: '20px', fontWeight: 700 }}>
          {mode === 'setup' ? t('login.setupWelcome') : t('login.brand')}
        </div>
        <div className="muted" style={{ fontSize: 'var(--font-sm)', marginTop: '-8px' }}>
          {mode === 'setup' ? t('login.setupSub') : t('login.loginSub')}
        </div>
        <input
          type="password" style={field} value={password} autoFocus
          placeholder={t('login.password')}
          autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'setup' && (
          <input
            type="password" style={field} value={confirm}
            placeholder={t('login.confirm')} autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)' }}>{error}</div>
        )}
        <button type="submit" style={btn} disabled={busy}>
          {busy ? t('login.wait') : mode === 'setup' ? t('login.create') : t('login.unlock')}
        </button>
      </form>
    </div>
  );
}
