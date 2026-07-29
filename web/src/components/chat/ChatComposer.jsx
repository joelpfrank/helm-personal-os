import React, { useEffect, useRef, useState } from 'react';
import { attachmentFromFile } from '../../lib/attachments.js';
import { transcribeAudio } from '../../api.js';
import { useT } from '../../lib/i18n.js';

// Voice input records audio in the browser and transcribes it server-side
// with whisper.cpp rather than relying on the browser's Web Speech API.
function micSupported() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

// Pick a recording container the browser actually supports. Safari →
// mp4/aac, Chrome/Firefox → webm/opus. ffmpeg on the server handles any.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* ignore */ }
  }
  return '';
}

function MicIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={active ? { color: 'var(--danger)' } : undefined}>
      <rect x="9" y="3" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0M12 19v3M8 22h8"/>
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.49"/>
    </svg>
  );
}

export default function ChatComposer({ onSend, onCancel, streaming, disabled }) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [attachments, setAttachments] = useState([]);  // [{ id, kind, name, mimeType, preview, block }]
  const [attachError, setAttachError] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const canMic = micSupported();
  const t = useT();

  async function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    setAttaching(true);
    setAttachError(null);
    try {
      const next = [];
      for (const file of fileList) {
        try { next.push(await attachmentFromFile(file)); }
        catch (err) { setAttachError(err.message); }
      }
      if (next.length) setAttachments((prev) => [...prev, ...next]);
    } finally { setAttaching(false); }
  }

  function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function removeAttachment(id) {
    setAttachments((a) => a.filter((x) => x.id !== id));
  }

  function stopTracks() {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
  }

  useEffect(() => {
    return () => {
      try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch { /* ignore */ }
      stopTracks();
    };
  }, []);

  function send() {
    const t = text.trim();
    if (streaming || disabled || recording || transcribing) return;
    if (!t && attachments.length === 0) return;
    // Build the content array: text first (if any), then attachments in
    // the order the user picked them.
    const blocks = [];
    if (t) blocks.push({ type: 'text', text: t });
    for (const a of attachments) blocks.push(a.block);
    onSend(blocks);
    setText('');
    setAttachments([]);
    setAttachError(null);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Plain Enter sends (Shift+Enter for newline) - feels like Slack/Claude.
      e.preventDefault();
      send();
    }
  }

  async function startRecording() {
    if (!canMic || recording || transcribing) return;
    setAttachError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (!blob.size) { setTranscribing(false); return; }
        setTranscribing(true);
        try {
          const said = await transcribeAudio(blob);
          if (said) {
            setText((prev) => (prev ? prev.replace(/\s*$/, '') + ' ' : '') + said);
            setTimeout(() => taRef.current?.focus(), 0);
          }
        } catch (err) {
          setAttachError('Transcription failed: ' + (err?.message || 'unknown error'));
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (err) {
      setAttachError('Mic unavailable: ' + (err?.message || 'permission denied'));
      stopTracks();
      setRecording(false);
    }
  }

  function stopRecording() {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    setRecording(false);
  }

  function toggleMic() {
    if (recording) stopRecording();
    else startRecording();
  }

  return (
    <div className="chat-composer">
      {(attachments.length > 0 || attachError) && (
        <div className="chat-attach-row">
          {attachments.map((a) => (
            <div key={a.id} className={`chat-attach ${a.kind}`} title={a.name}>
              {a.preview
                ? <img src={a.preview} alt={a.name} />
                : <span className="chat-attach-doc">📄 {a.name}</span>}
              <button
                type="button"
                className="chat-attach-remove"
                onClick={() => removeAttachment(a.id)}
                aria-label="remove attachment"
              >×</button>
            </div>
          ))}
          {attachError && <div className="chat-attach-error err small">{attachError}</div>}
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={disabled
          ? t('composer.unavailable')
          : transcribing
            ? t('composer.transcribing')
            : recording
              ? t('composer.recording')
              : t('composer.placeholder')}
        disabled={disabled}
        rows={2}
        autoFocus
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.csv,.txt,.md,.json,.log"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="attach-btn"
        onClick={() => fileRef.current?.click()}
        aria-label="attach files"
        title="attach image, PDF, or text file"
        disabled={disabled || attaching}
      >
        <PaperclipIcon />
      </button>
      {canMic && (
        <button
          type="button"
          onClick={toggleMic}
          className={`mic-btn${recording ? ' recording' : ''}`}
          aria-label={recording ? 'stop recording' : 'start voice input'}
          title={recording ? 'tap to stop & transcribe' : (transcribing ? 'transcribing…' : 'voice input')}
          disabled={disabled || transcribing}
        >
          <MicIcon active={recording} />
        </button>
      )}
      {streaming ? (
        <button type="button" onClick={onCancel} className="danger">{t('composer.stop')}</button>
      ) : (
        <button type="button" onClick={send} disabled={!text.trim() || disabled || recording || transcribing}>{t('composer.send')}</button>
      )}
    </div>
  );
}
