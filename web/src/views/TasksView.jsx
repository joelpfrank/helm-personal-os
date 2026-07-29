import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import BoardSelector from '../components/BoardSelector.jsx';
import Board from '../components/Board.jsx';
import CardModal from '../components/CardModal.jsx';

export default function TasksView() {
  const boards = useStore((s) => s.boards);
  const activeBoard = useStore((s) => s.activeBoard);
  const activeBoardId = useStore((s) => s.activeBoardId);
  const error = useStore((s) => s.error);
  const loading = useStore((s) => s.loading);
  const fetchBoards = useStore((s) => s.fetchBoards);
  const fetchBoard = useStore((s) => s.fetchBoard);
  const fetchTags = useStore((s) => s.fetchTags);
  const createBoard = useStore((s) => s.createBoard);
  const renameBoard = useStore((s) => s.renameBoard);
  const deleteBoard = useStore((s) => s.deleteBoard);

  const [openCardId, setOpenCardId] = useState(null);
  const [addingBoard, setAddingBoard] = useState(false);
  const [draftBoard, setDraftBoard] = useState('');
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [draftBoardName, setDraftBoardName] = useState('');
  const boardInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const list = await fetchBoards();
      await fetchTags();
      const fromHash = Number(getHashParam('board')) || null;
      const target = fromHash && list.some((b) => b.id === fromHash)
        ? fromHash
        : list[0]?.id;
      if (target) {
        await fetchBoard(target);
        writeHashParams({ board: target });
      }
    })().catch(() => {});

    return onHashChange((params) => {
      const id = Number(params.get('board')) || null;
      if (id && id !== useStore.getState().activeBoardId) {
        fetchBoard(id).catch(() => {});
      }
    });
  }, [fetchBoard, fetchBoards, fetchTags]);

  async function commitNewBoard() {
    const name = draftBoard.trim();
    setAddingBoard(false);
    if (!name) { setDraftBoard(''); return; }
    setDraftBoard('');
    const b = await createBoard(name);
    writeHashParams({ board: b.id });
  }

  function startRenameBoard() {
    if (!activeBoard) return;
    setDraftBoardName(activeBoard.name);
    setRenamingBoard(true);
  }
  async function commitRenameBoard() {
    if (!activeBoard) { setRenamingBoard(false); return; }
    const name = draftBoardName.trim();
    setRenamingBoard(false);
    if (!name || name === activeBoard.name) return;
    await renameBoard(activeBoard.id, name);
  }

  async function handleDeleteBoard() {
    if (!activeBoard) return;
    if (!window.confirm(`delete board “${activeBoard.name}” and everything in it?`)) return;
    await deleteBoard(activeBoard.id);
  }

  let openCard = null;
  if (openCardId && activeBoard) {
    for (const col of activeBoard.columns) {
      const c = col.cards.find((c) => c.id === openCardId);
      if (c) { openCard = c; break; }
    }
  }

  return (
    <>
      <div className="section-toolbar">
        {renamingBoard ? (
          <input
            type="text"
            autoFocus
            className="board-rename-input"
            value={draftBoardName}
            onChange={(e) => setDraftBoardName(e.target.value)}
            onBlur={commitRenameBoard}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRenameBoard(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenamingBoard(false); }
            }}
          />
        ) : (
          <BoardSelector
            boards={boards}
            activeId={activeBoardId}
            onSelect={(id) => writeHashParams({ board: id })}
          />
        )}
        {addingBoard ? (
          <input
            ref={boardInputRef}
            type="text"
            autoFocus
            className="board-rename-input"
            value={draftBoard}
            onChange={(e) => setDraftBoard(e.target.value)}
            onBlur={commitNewBoard}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitNewBoard(); }
              if (e.key === 'Escape') { e.preventDefault(); setDraftBoard(''); setAddingBoard(false); }
            }}
            placeholder="New board name…"
          />
        ) : (
          <button type="button" onClick={() => { setDraftBoard(''); setAddingBoard(true); }} title="new board">+ board</button>
        )}
        {activeBoard && !renamingBoard && !addingBoard && (
          <>
            <button type="button" onClick={startRenameBoard}>rename</button>
            <button type="button" className="danger" onClick={handleDeleteBoard}>delete</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {loading && <span className="muted">loading…</span>}
        {error && <span className="err">{error}</span>}
      </div>
      <main className="board-host">
        {activeBoard ? (
          <Board
            board={activeBoard}
            onCardClick={(c) => setOpenCardId(c.id)}
          />
        ) : (
          boards.length === 0
            ? <p className="muted">no boards yet — click <strong>+ board</strong> to make your first one.</p>
            : <p className="muted">pick a board to get started.</p>
        )}
      </main>
      {openCard && (
        <CardModal card={openCard} onClose={() => setOpenCardId(null)} />
      )}
    </>
  );
}
