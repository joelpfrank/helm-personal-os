import React, { useRef } from 'react';
import { outcomeLabel, outcomeClass, normalizeOutcome, nextOutcome } from '../../lib/habitOutcome.js';

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  );
}

// Unspecified = a neutral hollow dot: no judgement, deliberately not a mark.
function NeutralDot() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="4.5" strokeDasharray="2 2" />
    </svg>
  );
}

// "Not achieved" = a prohibition sign (circle + slash), a humane "didn't do it"
// rather than a harsh bare X. It always ships alongside the text label below.
function NotAchievedSign() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.2 11.8 L11.8 4.2" />
    </svg>
  );
}

// Accessible three-state control. Each segment has a distinct icon shape AND a
// text label (never colour alone). Pressing the active state clears it back to
// Unspecified; pressing another state sets it.
function OutcomeControl({ status, onSet }) {
  const cur = normalizeOutcome(status);
  const seg = (state, Icon) => {
    const active = cur === state;
    return (
      <button
        type="button"
        className={`ho-seg ${outcomeClass(state)}${active ? ' on' : ''}`}
        aria-pressed={active}
        aria-label={outcomeLabel(state)}
        title={outcomeLabel(state)}
        onClick={(e) => { e.stopPropagation(); onSet(nextOutcome(cur, state)); }}
      >
        <Icon />
        <span className="ho-seg-label">{outcomeLabel(state)}</span>
      </button>
    );
  };
  return (
    <div className="habit-outcome" role="group" aria-label="Mark outcome: Achieved, Unspecified, or Not achieved">
      {seg('success', CheckMark)}
      {seg('unspecified', NeutralDot)}
      {seg('failed', NotAchievedSign)}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 2 L14 5 L5 14 L2 14 L2 11 Z" />
      <path d="M9 4 L12 7" />
    </svg>
  );
}

function ProgressRing({ size, stroke, progress, done, color }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.min(1, Math.max(0, progress));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="habit-ring" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r}
        fill={done ? color : 'transparent'}
        stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="transparent" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray var(--dur) var(--ease)' }} />
      {done && (
        <path d={`M ${size * 0.30} ${size * 0.52} L ${size * 0.45} ${size * 0.68} L ${size * 0.72} ${size * 0.36}`}
          stroke="#fff" strokeWidth={stroke + 0.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      )}
    </svg>
  );
}

export default function HabitRow({ habit, onIncrement, onDecrement, onOpen, onEdit, onSetOutcome }) {
  const goal = habit.goal_quantity;
  const current = habit.today_quantity || 0;
  const done = !!habit.completed;
  const effective = habit.effective_status || (done ? 'success' : 'unspecified');
  const stripe = habit.color || 'var(--accent)';
  const unit = habit.unit ? ` ${habit.unit}${current === 1 ? '' : 's'}` : '';
  const canUndo = current > 0;
  const longPressTimer = useRef(null);
  const longPressed = useRef(false);

  function startPress() {
    longPressed.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressed.current = true;
      if (canUndo) onDecrement();
    }, 350);
  }
  function cancelPress() {
    clearTimeout(longPressTimer.current);
  }
  function handleRingClick(e) {
    e.stopPropagation();
    if (longPressed.current) { longPressed.current = false; return; }
    // If the habit is already complete, a tap means "untick" (undo
    // the last log). Otherwise tap = log one more. This makes the
    // ring symmetric: it always does the next obvious action.
    if (done) {
      if (canUndo) onDecrement();
    } else {
      onIncrement();
    }
  }
  function handleRingContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (canUndo) onDecrement();
  }

  return (
    <div
      className={`habit-row${done ? ' done' : ''}${effective === 'failed' ? ' failed' : ''}`}
      onClick={onOpen}
      style={{ borderLeftColor: stripe }}
    >
      <div className="habit-row-main">
        {habit.emoji && <span className="habit-emoji" aria-hidden>{habit.emoji}</span>}
        <div className="habit-row-text">
          <div className="habit-row-name">{habit.name}</div>
          <div className="habit-row-progress-text">
            {effective === 'failed'
              ? <span className="habit-failed-pill">Not achieved</span>
              : done
                ? <span className="habit-done-pill">done</span>
                : <>{current}{unit ? unit : ''} <span className="muted">/ {goal}{unit ? unit : ''}</span></>
            }
          </div>
        </div>
      </div>
      <div className="habit-row-buttons">
        {onSetOutcome && (
          <OutcomeControl status={effective} onSet={(s) => onSetOutcome(s)} />
        )}
        {onEdit && (
          <button
            type="button"
            className="habit-row-edit"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            aria-label={`edit ${habit.name}`}
            title="edit habit"
          >
            <PencilIcon />
          </button>
        )}
        {canUndo && (
          <button
            type="button"
            className="habit-row-undo"
            onClick={(e) => { e.stopPropagation(); onDecrement(); }}
            aria-label={`undo last ${habit.name}`}
            title="undo last log"
          >−</button>
        )}
        <button
          type="button"
          className="habit-row-ring-btn"
          onClick={handleRingClick}
          onContextMenu={handleRingContextMenu}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          aria-label={done ? `untick ${habit.name}` : `log ${habit.name}`}
          title={done ? 'tap to untick · long-press to undo more' : 'tap to log · long-press to undo'}
        >
          <ProgressRing size={40} stroke={4} progress={habit.progress || 0} done={done} color={stripe} />
        </button>
      </div>
    </div>
  );
}
