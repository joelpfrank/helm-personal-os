import React, { useEffect, useState } from 'react';
import { useCustomizeStore } from '../../state/customize.js';
import { useChatStore } from '../../state/chat.js';

function PersonalityExamples({ onPick }) {
  const examples = [
    { label: 'Direct & terse', text: 'Be terse. Short sentences. No filler. Skip greetings and sign-offs. Just answer.' },
    { label: 'Warm & girly', text: 'Be warm, playful, and supportive. Use a few emojis to express tone (sparingly, not in every sentence). Soft, affirming language. Celebrate small wins. Call me by name when it fits.' },
    { label: 'Coach', text: 'Talk like a no-bullshit personal coach. Hold me accountable. Push back when I make excuses. Tell me what to do, not what I could do.' },
    { label: 'Therapist', text: 'Reflective listening style. Ask open questions. Don\'t rush to solutions. Validate feelings before giving advice.' },
    { label: 'British butler', text: 'Address me as "sir" or by name. Formal English. Dry wit. Mildly disapproving of frivolous requests but always helpful.' },
  ];
  return (
    <div className="customize-examples">
      <div className="muted small" style={{ marginBottom: 4 }}>quick start templates (tap to copy in):</div>
      <div className="customize-examples-row">
        {examples.map((e) => (
          <button key={e.label} type="button" className="customize-example" onClick={() => onPick(e.text)}>
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemoryRow({ memory, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);

  async function save() {
    if (!text.trim() || text === memory.text) { setEditing(false); setText(memory.text); return; }
    await onSave(memory.id, text.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="memory-row editing">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          autoFocus
        />
        <div className="memory-row-actions">
          <button type="button" onClick={() => { setEditing(false); setText(memory.text); }}>cancel</button>
          <button type="button" onClick={save}>save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-row">
      <div className="memory-text">
        <span className="memory-id muted small">#{memory.id}</span>
        {memory.text}
      </div>
      <div className="memory-row-actions">
        <button type="button" onClick={() => setEditing(true)} title="edit">edit</button>
        <button type="button" className="danger" onClick={() => onDelete(memory.id)} title="delete">×</button>
      </div>
    </div>
  );
}

export default function CustomizeModal({ onClose }) {
  const personality = useCustomizeStore((s) => s.personality);
  const memories = useCustomizeStore((s) => s.memories);
  const defaultModel = useCustomizeStore((s) => s.defaultModel);
  const loading = useCustomizeStore((s) => s.loading);
  const error = useCustomizeStore((s) => s.error);
  const fetchAll = useCustomizeStore((s) => s.fetchAll);
  const setPersonality = useCustomizeStore((s) => s.setPersonality);
  const setDefaultModel = useCustomizeStore((s) => s.setDefaultModel);
  const addMemory = useCustomizeStore((s) => s.addMemory);
  const updateMemory = useCustomizeStore((s) => s.updateMemory);
  const deleteMemory = useCustomizeStore((s) => s.deleteMemory);
  const availableModels = useChatStore((s) => s.status?.models) || [];

  const [draftPersonality, setDraftPersonality] = useState(personality);
  const [savingPers, setSavingPers] = useState(false);
  const [newMem, setNewMem] = useState('');

  useEffect(() => { fetchAll().catch(() => {}); }, [fetchAll]);
  useEffect(() => { setDraftPersonality(personality); }, [personality]);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function savePersonality() {
    setSavingPers(true);
    try { await setPersonality(draftPersonality); }
    finally { setSavingPers(false); }
  }

  async function handleAddMemory() {
    const t = newMem.trim();
    if (!t) return;
    await addMemory(t);
    setNewMem('');
  }

  async function handleDeleteMemory(id) {
    if (!window.confirm('delete this memory?')) return;
    await deleteMemory(id);
  }

  const dirty = draftPersonality !== personality;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal customize-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">Customize Claude</h3>

        <section className="customize-section">
          <h4>Personality</h4>
          <p className="muted small" style={{ marginTop: 0 }}>
            Freeform instructions for tone, persona, communication style. Applies to every chat reply.
          </p>
          <PersonalityExamples onPick={(t) => setDraftPersonality((p) => p ? `${p}\n\n${t}` : t)} />
          <textarea
            value={draftPersonality}
            onChange={(e) => setDraftPersonality(e.target.value)}
            rows={6}
            placeholder='e.g. "Be warm and playful. Use a few emojis. Celebrate wins."'
            style={{ width: '100%', marginTop: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={() => setDraftPersonality(personality)} disabled={!dirty || savingPers}>
              revert
            </button>
            <button type="button" onClick={savePersonality} disabled={!dirty || savingPers}>
              {savingPers ? 'saving…' : 'save personality'}
            </button>
          </div>
        </section>

        <hr className="customize-divider" />

        <section className="customize-section">
          <h4>Default model</h4>
          <p className="muted small" style={{ marginTop: 0 }}>
            New conversations start with this model. You can change the model per-conversation from the chat header.
          </p>
          <div className="customize-model-row">
            {availableModels.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`customize-model${defaultModel === m.id ? ' on' : ''}`}
                onClick={() => setDefaultModel(m.id).catch(() => {})}
                title={m.hint}
              >
                <strong>{m.label}</strong>
                <span className="muted small">{m.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <hr className="customize-divider" />

        <section className="customize-section">
          <h4>Memories</h4>
          <p className="muted small" style={{ marginTop: 0 }}>
            Durable facts Claude carries across conversations. Loaded into every reply's context. Claude adds/edits these on its own as it learns — you can also do it manually here.
          </p>
          <div className="memory-add">
            <textarea
              value={newMem}
              onChange={(e) => setNewMem(e.target.value)}
              rows={2}
              placeholder="add a memory manually… (e.g. 'prefers metric units', 'lives in CDMX')"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddMemory();
              }}
            />
            <button type="button" onClick={handleAddMemory} disabled={!newMem.trim()}>+ add</button>
          </div>

          {loading && <p className="muted small">loading…</p>}
          {error && <p className="err small">{error}</p>}
          {!loading && memories.length === 0 && (
            <p className="muted small">no memories yet. As you chat, Claude will save durable facts on its own.</p>
          )}
          <div className="memory-list">
            {memories.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                onSave={updateMemory}
                onDelete={handleDeleteMemory}
              />
            ))}
          </div>
        </section>

        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}
