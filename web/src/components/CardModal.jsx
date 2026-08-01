import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../state/store.js';
import ColorSwatch from './ColorSwatch.jsx';
import TagInput from './TagInput.jsx';

export default function CardModal({ card, onClose }) {
  const updateCard = useStore((s) => s.updateCard);
  const deleteCard = useStore((s) => s.deleteCard);

  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes || '');
  const [due, setDue] = useState(card.due_date ? card.due_date.slice(0, 10) : '');
  const [color, setColor] = useState(card.color || null);
  const [tags, setTags] = useState(card.tags || []);
  const [tab, setTab] = useState('write');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    try {
      const patch = {
        title: title.trim(),
        notes,
        due_date: due ? due : null,
        color,
        tag_ids: tags.map((t) => t.id),
      };
      await updateCard(card.id, patch);
      onClose();
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm('delete this card?')) return;
    await deleteCard(card.id);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          className="modal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="card title"
        />

        <div className="modal-row">
          <label>due</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          {due && <button type="button" onClick={() => setDue('')}>clear</button>}
        </div>

        <div className="modal-row">
          <label>color</label>
          <ColorSwatch value={color} onChange={setColor} />
        </div>

        <div className="modal-row stretch">
          <label>tags</label>
          <TagInput value={tags} onChange={setTags} />
        </div>

        <div className="modal-row stretch">
          <label>notes</label>
          <div className="notes-tabs">
            <button
              type="button"
              className={tab === 'write' ? 'active' : ''}
              onClick={() => setTab('write')}
            >write</button>
            <button
              type="button"
              className={tab === 'preview' ? 'active' : ''}
              onClick={() => setTab('preview')}
            >preview</button>
          </div>
        </div>
        {tab === 'write' ? (
          <textarea
            className="notes-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={10}
            placeholder="markdown supported…"
          />
        ) : (
          <div className="notes-preview">
            {notes
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
              : <span className="muted">nothing yet</span>
            }
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={remove}>delete</button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>cancel</button>
          <button type="button" onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </div>
  );
}
