// Regression test: live voice-conversation mode must be fully removed,
// while ordinary mic-dictation in ChatComposer must remain.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ── VoiceMode component must not exist ──────────────────────────────

describe('VoiceMode file', () => {
  it('VoiceMode.jsx must not exist', () => {
    assert.equal(exists('web/src/components/chat/VoiceMode.jsx'), false,
      'VoiceMode.jsx should be deleted');
  });
});

// ── ChatView must not import or render VoiceMode ────────────────────

describe('ChatView', () => {
  it('must not import VoiceMode', () => {
    const src = read('web/src/views/ChatView.jsx');
    assert.equal(src.includes('VoiceMode'), false,
      'ChatView should not reference VoiceMode');
  });
  it('must not have voiceOpen state', () => {
    const src = read('web/src/views/ChatView.jsx');
    assert.equal(src.includes('voiceOpen'), false,
      'ChatView should not have voiceOpen state');
  });
  it('must not pass onVoice to ChatComposer', () => {
    const src = read('web/src/views/ChatView.jsx');
    assert.equal(src.includes('onVoice'), false,
      'ChatView should not pass onVoice');
  });
});

// ── ChatComposer must not have voice-wave button or onVoice prop ────

describe('ChatComposer', () => {
  it('must not contain VoiceWaveIcon', () => {
    const src = read('web/src/components/chat/ChatComposer.jsx');
    assert.equal(src.includes('VoiceWaveIcon'), false,
      'ChatComposer should not have VoiceWaveIcon');
  });
  it('must not accept onVoice prop', () => {
    const src = read('web/src/components/chat/ChatComposer.jsx');
    assert.equal(src.includes('onVoice'), false,
      'ChatComposer should not have onVoice prop');
  });
  it('must still have MicIcon (dictation)', () => {
    const src = read('web/src/components/chat/ChatComposer.jsx');
    assert.ok(src.includes('MicIcon'), 'MicIcon must remain for dictation');
  });
  it('must still have toggleMic (dictation)', () => {
    const src = read('web/src/components/chat/ChatComposer.jsx');
    assert.ok(src.includes('toggleMic'), 'toggleMic must remain');
  });
  it('must still import transcribeAudio', () => {
    const src = read('web/src/components/chat/ChatComposer.jsx');
    assert.ok(src.includes('transcribeAudio'), 'transcribeAudio import must remain');
  });
});

// ── Client API must not export speak/listVoices ─────────────────────

describe('api.js', () => {
  it('must not export listVoices', () => {
    const src = read('web/src/api.js');
    assert.equal(src.includes('listVoices'), false,
      'api.js should not have listVoices');
  });
  it('must not export speak', () => {
    const src = read('web/src/api.js');
    // "speak" as a standalone word (not part of other words)
    assert.equal(/\bspeak\b/.test(src), false,
      'api.js should not have speak function');
  });
  it('must still export transcribeAudio', () => {
    const src = read('web/src/api.js');
    assert.ok(src.includes('transcribeAudio'), 'transcribeAudio must remain');
  });
});

// ── Server routes: no /voices or /speak, keep /transcribe ───────────

describe('server chat routes', () => {
  const src = () => read('server/src/routes/chat.js');

  it('must not have /voices route', () => {
    assert.equal(src().includes("'/voices'"), false,
      'server should not have /voices route');
  });
  it('must not have /speak route', () => {
    assert.equal(src().includes("'/speak'"), false,
      'server should not have /speak route');
  });
  it('must not reference kokoroVoices', () => {
    assert.equal(src().includes('kokoroVoices'), false,
      'server should not have kokoroVoices');
  });
  it('must not reference kokoroSynth', () => {
    assert.equal(src().includes('kokoroSynth'), false,
      'server should not have kokoroSynth');
  });
  it('must not reference VOICE_BLOCKLIST', () => {
    assert.equal(src().includes('VOICE_BLOCKLIST'), false,
      'server should not have VOICE_BLOCKLIST');
  });
  it('must not reference SAY_BIN', () => {
    assert.equal(src().includes('SAY_BIN'), false,
      'server should not have SAY_BIN');
  });
  it('must still have /transcribe route', () => {
    assert.ok(src().includes("'/transcribe'"),
      '/transcribe route must remain');
  });
  it('must still reference WHISPER_CLI', () => {
    assert.ok(src().includes('WHISPER_CLI'),
      'WHISPER_CLI must remain for transcription');
  });
});

// ── i18n: no vm.* keys ──────────────────────────────────────────────

describe('i18n', () => {
  it('must not have vm.* keys', () => {
    const src = read('web/src/lib/i18n.js');
    assert.equal(/['"]vm\./.test(src), false,
      'i18n should not have vm.* voice-mode keys');
  });
  it('must still have composer.* keys', () => {
    const src = read('web/src/lib/i18n.js');
    assert.ok(src.includes('composer.placeholder'), 'composer keys must remain');
  });
});

// ── App.jsx: no voice_mode_voice localStorage sync ──────────────────

describe('App.jsx', () => {
  it('must not reference voice_mode_voice', () => {
    const src = read('web/src/App.jsx');
    assert.equal(src.includes('voice_mode_voice'), false,
      'App.jsx should not sync voice_mode_voice');
  });
});
