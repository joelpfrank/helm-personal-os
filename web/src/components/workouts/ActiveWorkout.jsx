import React, { useEffect, useRef, useState } from 'react';
import { useWorkoutsStore } from '../../state/workouts.js';
import { apiDelete, apiGet, apiPost } from '../../api.js';
import { formatRestTimer, nextRestTimerDeadline, restTimerSeconds } from '../../lib/rest-timer.js';
import WorkoutExerciseCard from './WorkoutExerciseCard.jsx';
import ExercisePicker from './ExercisePicker.jsx';
import ExerciseHistory from './ExerciseHistory.jsx';

function elapsed(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

const REST_TIMER_STORAGE_KEY = 'helm.workouts.restSettings';
const LEGACY_DURATION_KEY = 'helm.workouts.restSeconds';
const REST_PRESETS = [60, 90, 120, 180];
const DEFAULT_REST_SETTINGS = {
  duration: 120,
  soundEnabled: true,
  sound: 'bell',
  vibrationEnabled: true,
  phoneNotifications: true,
  repeatEnabled: false,
};

function initialRestSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(REST_TIMER_STORAGE_KEY) || 'null');
    const duration = REST_PRESETS.includes(Number(saved?.duration))
      ? Number(saved.duration)
      : Number(window.localStorage.getItem(LEGACY_DURATION_KEY));
    return {
      ...DEFAULT_REST_SETTINGS,
      ...(saved && typeof saved === 'object' ? saved : {}),
      duration: REST_PRESETS.includes(duration) ? duration : DEFAULT_REST_SETTINGS.duration,
      sound: ['bell', 'double', 'gong'].includes(saved?.sound) ? saved.sound : 'bell',
    };
  } catch { return DEFAULT_REST_SETTINGS; }
}

function playRestAlarm({ soundEnabled, sound, vibrationEnabled }) {
  if (vibrationEnabled) {
    try { navigator.vibrate?.([180, 100, 180]); } catch {}
  }
  if (!soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const patterns = {
      bell: [{ at: 0, frequency: 880, duration: 0.55 }, { at: 0.16, frequency: 1320, duration: 0.7 }],
      double: [{ at: 0, frequency: 740, duration: 0.2 }, { at: 0.32, frequency: 740, duration: 0.2 }],
      gong: [{ at: 0, frequency: 220, duration: 1.2 }, { at: 0.04, frequency: 330, duration: 0.9 }],
    };
    const notes = patterns[sound] || patterns.bell;
    let endsAt = 0;
    for (const note of notes) {
      const start = context.currentTime + note.at;
      const end = start + note.duration;
      endsAt = Math.max(endsAt, note.at + note.duration);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(sound === 'gong' ? 0.08 : 0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end);
    }
    setTimeout(() => context.close(), (endsAt + 0.1) * 1000);
  } catch {}
}

export default function ActiveWorkout() {
  const active = useWorkoutsStore((s) => s.active);
  const addExerciseToWorkout = useWorkoutsStore((s) => s.addExerciseToWorkout);
  const removeWorkoutExercise = useWorkoutsStore((s) => s.removeWorkoutExercise);
  const endWorkout = useWorkoutsStore((s) => s.endWorkout);
  const cancelWorkout = useWorkoutsStore((s) => s.cancelWorkout);

  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [prevByExercise, setPrevByExercise] = useState({});
  const [restSettings, setRestSettings] = useState(initialRestSettings);
  const [restDeadline, setRestDeadline] = useState(null);
  const [pausedRest, setPausedRest] = useState(restSettings.duration);
  const [restSettingsOpen, setRestSettingsOpen] = useState(false);
  const [notificationAvailable, setNotificationAvailable] = useState(false);
  const [timerError, setTimerError] = useState('');
  const restAlarmed = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(restSettings)); } catch {}
  }, [restSettings]);

  useEffect(() => {
    if (!active?.id) return;
    let cancelled = false;
    apiGet('/workouts/rest-timer')
      .then((state) => {
        if (cancelled) return;
        setNotificationAvailable(!!state.notification_available);
        if (state.running && state.workout_id === active.id) {
          setRestDeadline(Date.parse(state.next_fire_at));
          setPausedRest(state.duration_seconds);
          setRestSettings((current) => ({
            ...current,
            duration: state.duration_seconds,
            repeatEnabled: state.repeat_enabled,
            phoneNotifications: state.notifications_enabled,
          }));
          restAlarmed.current = false;
        }
      })
      .catch(() => { if (!cancelled) setNotificationAvailable(false); });
    return () => { cancelled = true; };
  }, [active?.id]);

  const restRemaining = restDeadline == null
    ? pausedRest
    : restTimerSeconds(restDeadline, now);

  useEffect(() => {
    if (restDeadline != null && restRemaining <= 0 && !restAlarmed.current) {
      restAlarmed.current = true;
      playRestAlarm(restSettings);
      if (restSettings.repeatEnabled) {
        setRestDeadline(nextRestTimerDeadline(restDeadline, restSettings.duration));
        restAlarmed.current = false;
      }
    }
  }, [restDeadline, restRemaining, restSettings]);

  // Fetch the previous session for each exercise in this workout so we can
  // show ghost-text hints on each SetRow.
  useEffect(() => {
    if (!active) return;
    const ids = active.exercises.map((we) => we.exercise_id);
    const known = new Set(Object.keys(prevByExercise).map(Number));
    const need = ids.filter((id) => !known.has(id));
    if (!need.length) return;
    (async () => {
      const next = { ...prevByExercise };
      for (const id of need) {
        try {
          const r = await apiGet(`/exercises/${id}/history?limit=2`);
          // First session that's NOT this workout.
          const previous = (r.sessions || []).find((s) => s.workout_id !== active.id) || null;
          next[id] = previous;
        } catch { next[id] = null; }
      }
      setPrevByExercise(next);
    })();
  }, [active, prevByExercise]);

  if (!active) return null;

  async function handlePick(exercise) {
    await addExerciseToWorkout(active.id, exercise.id);
  }

  async function stopServerRestTimer() {
    try { await apiDelete('/workouts/rest-timer'); } catch {}
  }

  async function handleEnd() {
    if (!window.confirm('end workout?')) return;
    await stopServerRestTimer();
    await endWorkout();
  }

  async function handleCancel() {
    if (!window.confirm('cancel and discard this workout?')) return;
    await stopServerRestTimer();
    await cancelWorkout();
  }

  function updateRestSetting(key, value) {
    setRestSettings((current) => ({ ...current, [key]: value }));
  }

  async function setRestPreset(seconds) {
    updateRestSetting('duration', seconds);
    setPausedRest(seconds);
    setRestDeadline(null);
    restAlarmed.current = false;
    await stopServerRestTimer();
  }

  async function startRestTimer() {
    const seconds = pausedRest > 0 ? pausedRest : restSettings.duration;
    const localDeadline = Date.now() + seconds * 1000;
    setPausedRest(seconds);
    setRestDeadline(localDeadline);
    setTimerError('');
    restAlarmed.current = false;
    try {
      const state = await apiPost('/workouts/rest-timer', {
        duration_seconds: restSettings.duration,
        first_interval_seconds: seconds,
        repeat_enabled: restSettings.repeatEnabled,
        notifications_enabled: restSettings.phoneNotifications && notificationAvailable,
      });
      setRestDeadline(Date.parse(state.next_fire_at));
      setNotificationAvailable(!!state.notification_available);
    } catch {
      setTimerError('Background phone alerts are unavailable; the on-screen timer is still running.');
    }
  }

  async function pauseRestTimer() {
    setPausedRest(Math.max(1, restTimerSeconds(restDeadline, Date.now())));
    setRestDeadline(null);
    await stopServerRestTimer();
  }

  async function resetRestTimer() {
    setPausedRest(restSettings.duration);
    setRestDeadline(null);
    setTimerError('');
    restAlarmed.current = false;
    await stopServerRestTimer();
  }

  const _ = now;

  return (
    <div className="active-workout">
      <div className="active-header">
        <div>
          <div className="active-name">{active.name || 'Workout'}</div>
          <div className="active-time muted">{elapsed(active.started_at)}</div>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="danger" onClick={handleCancel}>cancel</button>
        <button type="button" onClick={handleEnd}>finish</button>
      </div>

      <section className={`rest-timer ${restRemaining <= 0 ? 'rest-timer-due' : ''}`} aria-label="Rest timer">
        <div className="rest-timer-top">
          <div className="rest-timer-main">
            <div className="rest-timer-label">Rest timer</div>
            <div className="rest-timer-clock" aria-live="polite">{formatRestTimer(restRemaining)}</div>
            <div className="rest-timer-status muted small">
              {restDeadline != null
                ? (restSettings.repeatEnabled ? 'repeating automatically' : (restRemaining <= 0 ? 'rest over — next set' : 'counting down'))
                : 'ready'}
            </div>
          </div>
          <div className="rest-timer-controls">
            <label className="rest-timer-preset">
              <span className="sr-only">Rest interval</span>
              <select
                value={restSettings.duration}
                disabled={restDeadline != null}
                onChange={(event) => setRestPreset(Number(event.target.value))}
              >
                <option value={60}>1:00</option>
                <option value={90}>1:30</option>
                <option value={120}>2:00</option>
                <option value={180}>3:00</option>
              </select>
            </label>
            {restDeadline == null ? (
              <button type="button" className="rest-timer-primary" onClick={startRestTimer}>start</button>
            ) : (
              <button type="button" onClick={pauseRestTimer}>pause</button>
            )}
            <button type="button" onClick={resetRestTimer}>reset</button>
            <button
              type="button"
              className="rest-timer-customize"
              aria-expanded={restSettingsOpen}
              onClick={() => setRestSettingsOpen((open) => !open)}
            >customize</button>
          </div>
        </div>

        {restSettingsOpen && (
          <div className="rest-timer-settings">
            <label className="rest-setting-row">
              <input
                type="checkbox"
                checked={restSettings.soundEnabled}
                onChange={(event) => updateRestSetting('soundEnabled', event.target.checked)}
              />
              <span>Sound</span>
              <select
                value={restSettings.sound}
                disabled={!restSettings.soundEnabled}
                onChange={(event) => updateRestSetting('sound', event.target.value)}
              >
                <option value="bell">Bright bell</option>
                <option value="double">Double beep</option>
                <option value="gong">Low gong</option>
              </select>
              <button type="button" disabled={!restSettings.soundEnabled} onClick={() => playRestAlarm({ ...restSettings, vibrationEnabled: false })}>preview</button>
            </label>
            <label className="rest-setting-row">
              <input
                type="checkbox"
                checked={restSettings.vibrationEnabled}
                onChange={(event) => updateRestSetting('vibrationEnabled', event.target.checked)}
              />
              <span>Vibration</span>
            </label>
            <label className="rest-setting-row">
              <input
                type="checkbox"
                checked={restSettings.phoneNotifications && notificationAvailable}
                disabled={!notificationAvailable || restDeadline != null}
                onChange={(event) => updateRestSetting('phoneNotifications', event.target.checked)}
              />
              <span>Phone notifications</span>
              <small className="muted">{notificationAvailable ? 'Telegram connected' : 'Telegram unavailable'}</small>
            </label>
            <label className="rest-setting-row">
              <input
                type="checkbox"
                checked={restSettings.repeatEnabled}
                disabled={restDeadline != null}
                onChange={(event) => updateRestSetting('repeatEnabled', event.target.checked)}
              />
              <span>Repeat intervals</span>
              <small className="muted">Automatically starts the next interval after every alarm.</small>
            </label>
            <p className="rest-timer-note muted small">
              Helm’s chosen sound and vibration play while Helm is open. Telegram phone notifications continue when Helm is backgrounded or closed; their sound and vibration follow your Telegram and phone settings.
            </p>
          </div>
        )}
        {timerError && <div className="err small rest-timer-error">{timerError}</div>}
      </section>

      <div className="active-body">
        {active.exercises.length === 0 ? (
          <p className="muted center-pad">no exercises yet — hit "+ exercise" to add one.</p>
        ) : active.exercises.map((we, i) => {
          const prev = active.exercises[i - 1];
          const next = active.exercises[i + 1];
          const group = we.superset_group;
          const linkedUp = i > 0 && group != null && prev.superset_group === group;
          const linkedDown = i < active.exercises.length - 1 && group != null && next.superset_group === group;
          const inSuperset = linkedUp || linkedDown;
          const wrapperCls = [
            'we-wrapper',
            inSuperset ? 'in-superset' : '',
            linkedUp ? 'linked-up' : '',
            linkedDown ? 'linked-down' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={we.id} className={wrapperCls}>
              {inSuperset && !linkedUp && (
                <div className="we-superset-label muted small">superset</div>
              )}
              <WorkoutExerciseCard
                we={we}
                prevSession={prevByExercise[we.exercise_id]}
                onShowHistory={() => setHistoryFor(we.exercise)}
                onRemove={() => {
                  if (window.confirm(`remove ${we.exercise?.name || 'this exercise'} from the workout?`)) {
                    removeWorkoutExercise(we.id);
                  }
                }}
              />
            </div>
          );
        })}

        <button type="button" className="we-add" onClick={() => setPicking(true)}>+ exercise</button>
      </div>

      {picking && (
        <ExercisePicker onClose={() => setPicking(false)} onPick={handlePick} />
      )}
      {historyFor && (
        <ExerciseHistory
          exercise={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}
