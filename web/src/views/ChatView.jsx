import React, { useEffect, useState } from 'react';
import { useChatStore } from '../state/chat.js';
import ConversationList from '../components/chat/ConversationList.jsx';
import ChatTranscript from '../components/chat/ChatTranscript.jsx';
import ChatComposer from '../components/chat/ChatComposer.jsx';
import CustomizeModal from '../components/chat/CustomizeModal.jsx';
import FirstRunHint from '../components/FirstRunHint.jsx';
import { useT } from '../lib/i18n.js';

const COLLAPSE_KEY = 'chat_sidebar_collapsed';

function readCollapsed() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSE_KEY) === '1';
}

export default function ChatView() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => s.messages);
  const pendingAssistant = useChatStore((s) => s.pendingAssistant);
  const streaming = useChatStore((s) => s.streaming);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const fetchStatus = useChatStore((s) => s.fetchStatus);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const openConversation = useChatStore((s) => s.openConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelStream = useChatStore((s) => s.cancelStream);
  const setConversationModel = useChatStore((s) => s.setConversationModel);
  const t = useT();

  // On mobile, force-collapse by default regardless of saved preference,
  // since the sidebar overlays the chat there. Desktop respects the
  // saved preference.
  const isMobile = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  const [collapsed, setCollapsed] = useState(() => isMobile ? true : readCollapsed());

  useEffect(() => {
    fetchStatus().catch(() => {});
    fetchConversations().catch(() => {});
  }, [fetchStatus, fetchConversations]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  function onPick(id) {
    if (id !== activeId) openConversation(id).catch(() => {});
    // On mobile, auto-collapse after picking so the sidebar doesn't sit
    // on top of the chat we just opened.
    if (isMobile) setCollapsed(true);
  }
  function onNew() {
    newConversation().catch(() => {});
    if (isMobile) setCollapsed(true);
  }
  function onDelete(id) {
    if (!window.confirm('delete this conversation?')) return;
    deleteConversation(id).catch(() => {});
  }

  // Structured backend status from /api/chat/status: the server verifies the
  // active backend (Claude Code auth or API key) and sends summary + setup
  // guidance — the UI never guesses which credential is missing.
  const chatUnavailable = !!status && !status.configured;
  const activeConv = conversations.find((c) => c.id === activeId);
  const activeTitle = activeConv?.title;
  const activeModel = activeConv?.model || status?.default_model || 'claude-sonnet-4-6';
  const availableModels = status?.models || [];
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <div className={`chat-view${collapsed ? ' sidebar-collapsed' : ''}`}>
      {!collapsed && (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onPick={onPick}
          onDelete={onDelete}
          onNew={onNew}
        />
      )}
      <div className="chat-main">
        <div className="chat-header">
          <button
            type="button"
            className="chat-sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'show conversations' : 'hide conversations'}
            title={collapsed ? 'show conversations' : 'hide conversations'}
          >
            {collapsed
              ? <ChevronRightIcon />
              : <ChevronLeftIcon />}
          </button>
          {collapsed && (
            <button type="button" className="chat-new-btn-inline" onClick={onNew} title="new chat">+ new</button>
          )}
          {activeId && (
            <div className="chat-header-title muted">
              {activeTitle || '(untitled)'}
            </div>
          )}
          {activeId && availableModels.length > 0 && (
            <select
              className="chat-model-select"
              value={activeModel}
              onChange={(e) => setConversationModel(activeId, e.target.value).catch(() => {})}
              title="model for this conversation"
              aria-label="select model"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="chat-customize-btn"
            onClick={() => setCustomizeOpen(true)}
            title="customize personality + memories"
            aria-label="customize Claude"
          >
            <CustomizeIcon />
          </button>
        </div>
        <FirstRunHint id="chat">{t('hint.chat')}</FirstRunHint>
        {chatUnavailable && (
          <div className="chat-banner err">
            <strong>{status.summary || t('composer.unavailable')}</strong>
            {status.setup ? <> {status.setup}</> : null}
          </div>
        )}
        <ChatTranscript
          messages={messages}
          pendingAssistant={pendingAssistant}
          streaming={streaming}
        />
        {error && !streaming && <div className="chat-banner err">{error}</div>}
        <ChatComposer
          onSend={sendMessage}
          onCancel={cancelStream}
          streaming={streaming}
          disabled={chatUnavailable}
        />
      </div>
      {customizeOpen && (
        <CustomizeModal onClose={() => setCustomizeOpen(false)} />
      )}
    </div>
  );
}

function CustomizeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}
