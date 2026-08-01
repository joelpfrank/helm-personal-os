import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProvidersStore } from '../state/providers.js';
import '../styles/provider-settings.css';

function StatusMark({ readiness, credential }) {
  const ready = readiness?.configured || credential?.configured;
  const label = readiness?.deferred
    ? 'Checks paused'
    : ready ? 'Ready locally' : readiness?.reason === 'cli_auth_expired' ? 'Sign-in expired' : 'Setup needed';
  return <span className={`provider-status${ready ? ' is-ready' : ''}`}><span aria-hidden="true" />{label}</span>;
}

function ProviderChoice({ profile, selected, onSelect }) {
  const kind = profile.authentication_class === 'api_key' ? 'API key' : 'Verified subscription / CLI';
  return (
    <button type="button" className={`provider-choice${selected ? ' is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <span><strong>{profile.label}</strong><small>{kind}</small></span>
      <StatusMark readiness={profile.readiness} credential={profile.credential} />
    </button>
  );
}

function ProfileSetup({ profile, saving, onSave, onDelete, onRefresh, onUse }) {
  const [credential, setCredential] = useState('');
  const [saved, setSaved] = useState(false);
  const apiProfile = profile.authentication_class === 'api_key';
  const configured = profile.readiness?.configured || profile.credential?.configured;
  const readinessDeferred = profile.readiness?.deferred === true;

  useEffect(() => {
    setCredential('');
    setSaved(false);
    return () => setCredential('');
  }, [profile.id]);

  async function submit(event) {
    event.preventDefault();
    if (!credential.trim()) return;
    try {
      await onSave(profile.id, credential);
      setCredential('');
      setSaved(true);
    } catch {
      setCredential('');
    }
  }

  async function disconnect() {
    if (!window.confirm(`Delete the saved credential for ${profile.label}?`)) return;
    await onDelete(profile.id);
    setCredential('');
    setSaved(false);
  }

  return (
    <section className="provider-detail" aria-labelledby="provider-detail-title">
      <div className="provider-detail-heading">
        <div>
          <p className="settings-kicker">{apiProfile ? 'API connection' : 'Provider-owned sign-in'}</p>
          <h3 id="provider-detail-title">{profile.label}</h3>
        </div>
        <StatusMark readiness={profile.readiness} credential={profile.credential} />
      </div>

      {apiProfile ? (
        <>
          <p className="provider-explainer">API usage is billed separately by this provider. Helm saves the key in owner-only state outside the app and never displays it again.</p>
          <form className="credential-form" onSubmit={submit}>
            <label htmlFor={`provider-key-${profile.id}`}>API key</label>
            <div className="credential-controls">
              <input
                id={`provider-key-${profile.id}`}
                type="password"
                autoComplete="off"
                spellCheck="false"
                value={credential}
                onChange={(event) => { setCredential(event.target.value); setSaved(false); }}
                placeholder={configured ? 'Enter a replacement key' : 'Paste key once'}
              />
              <button type="submit" className="primary" disabled={saving || !credential.trim()}>{configured ? 'Replace key' : 'Save key'}</button>
            </div>
          </form>
          {saved && <p className="provider-success" role="status">Credential saved. Its value has been cleared from this screen.</p>}
          {configured && <button type="button" className="provider-disconnect" disabled={saving} onClick={disconnect}>Disconnect and delete credential</button>}
        </>
      ) : (
        <>
          <p className="provider-explainer">This path uses the official CLI session on the Mac running Helm. Helm checks sign-in status without making an inference request and never copies CLI credential files.</p>
          <div className="cli-setup">
            <strong>{readinessDeferred ? 'Readiness checks are paused while Helm runs without AI.' : profile.readiness?.summary || 'Checking local CLI readiness.'}</strong>
            {readinessDeferred
              ? <p>Enable this provider and restart Helm to check readiness.</p>
              : profile.readiness?.setup && <p>{profile.readiness.setup}</p>}
          </div>
          <button type="button" onClick={onRefresh} disabled={saving || readinessDeferred}>Check readiness again</button>
        </>
      )}

      <div className="provider-models">
        <div>
          <p className="settings-kicker">Compatible catalog</p>
          <h4>Models available with this profile</h4>
        </div>
        <ul>
          {profile.models.map((model) => (
            <li key={model.id}><span><strong>{model.label}</strong>{model.hint && <small>{model.hint}</small>}</span>{model.tier && <em>{model.tier}</em>}</li>
          ))}
        </ul>
      </div>

      <button type="button" className="primary provider-use" disabled={saving || (!configured && !readinessDeferred)} onClick={() => onUse(profile.id)}>
        Use this provider
      </button>
      {!configured && <p className="provider-note">{readinessDeferred ? 'Enable this provider and restart Helm to check readiness.' : 'Finish setup before selecting this provider.'}</p>}
    </section>
  );
}

export default function ProviderSettingsView({ onClose }) {
  const data = useProvidersStore((state) => state.data);
  const loading = useProvidersStore((state) => state.loading);
  const saving = useProvidersStore((state) => state.saving);
  const error = useProvidersStore((state) => state.error);
  const fetchProviders = useProvidersStore((state) => state.fetchProviders);
  const saveCredential = useProvidersStore((state) => state.saveCredential);
  const deleteCredential = useProvidersStore((state) => state.deleteCredential);
  const selectMode = useProvidersStore((state) => state.selectMode);
  const [profileId, setProfileId] = useState(null);
  const layerRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => { fetchProviders().catch(() => {}); }, [fetchProviders]);
  useEffect(() => {
    if (data?.selected_profile_id && !profileId) setProfileId(data.selected_profile_id);
  }, [data, profileId]);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(layerRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !layerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const profile = useMemo(() => data?.profiles?.find((entry) => entry.id === profileId) || data?.profiles?.[0], [data, profileId]);

  async function useProvider(id) {
    await selectMode('provider', id);
  }

  async function useWithoutAi() {
    await selectMode('no_ai');
  }

  return (
    <div ref={layerRef} className="provider-settings-layer" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
      <div className="provider-settings-shell">
        <header className="provider-settings-header">
          <div>
            <p className="settings-kicker">Coach connection</p>
            <h2 id="provider-settings-title">AI settings</h2>
            <p>Choose how Coach runs. Every other Helm surface works without an AI provider.</p>
          </div>
          <button ref={closeRef} type="button" className="provider-close" onClick={onClose} aria-label="Close AI settings">Done</button>
        </header>

        {loading && !data ? <p className="provider-loading" role="status">Checking provider readiness…</p> : null}
        {error && <div className="provider-error" role="alert">{error}</div>}

        {data && (
          <div className="provider-settings-grid">
            <aside className="provider-picker" aria-label="AI connection choices">
              <button type="button" className={`no-ai-choice${data.mode === 'no_ai' ? ' is-selected' : ''}`} onClick={useWithoutAi} disabled={saving}>
                <span><strong>Use Helm without AI</strong><small>Core records stay available. Coach messages are off.</small></span>
                <span aria-hidden="true">→</span>
              </button>
              <div className="provider-picker-heading"><span>Or choose a provider</span></div>
              {data.profiles.map((entry) => (
                <ProviderChoice key={entry.id} profile={entry} selected={entry.id === profile?.id} onSelect={() => setProfileId(entry.id)} />
              ))}
            </aside>

            {profile && (
              <ProfileSetup
                profile={profile}
                saving={saving}
                onSave={saveCredential}
                onDelete={deleteCredential}
                onRefresh={fetchProviders}
                onUse={useProvider}
              />
            )}
          </div>
        )}

        {data?.restart_required && (
          <div className="provider-restart" role="status"><strong>Restart Helm to apply this connection.</strong><span>Your current session keeps its existing provider until Helm reopens.</span></div>
        )}
        <footer className="provider-disclosure">
          <strong>What leaves your Mac</strong>
          <p>{data?.remote_processing_disclosure || 'When AI is enabled, selected prompts and context are sent to the chosen remote provider.'}</p>
        </footer>
      </div>
    </div>
  );
}
