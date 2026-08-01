import React, { useEffect } from 'react';
import { useCoachStore } from '../state/coach.js';
import { useChatStore } from '../state/chat.js';
import { useHabitsStore } from '../state/habits.js';
import { writeHashParams } from '../lib/hash.js';
import FirstRunHint from '../components/FirstRunHint.jsx';
import { useT } from '../lib/i18n.js';
import { visibleCadenceCards } from '../lib/cadence.js';

function greetingKey() {
  const h = new Date().getHours();
  if (h < 5) return 'today.late';
  if (h < 12) return 'today.morning';
  if (h < 17) return 'today.afternoon';
  if (h < 22) return 'today.evening';
  return 'today.night';
}

function CadenceCard({ kind, title, body, ctaLabel, onCta }) {
  return (
    <article className={`today-cadence-card kind-${kind}`} aria-labelledby={`cadence-${kind}-title`}>
      <h3 id={`cadence-${kind}-title`} className="cadence-title">{title}</h3>
      <div className="cadence-body muted small">{body}</div>
      <button type="button" className="link-btn cadence-cta" onClick={onCta}>{ctaLabel}</button>
    </article>
  );
}

const CADENCE_OPENERS = {
  morning: "Let's run my Daily Command Meeting. Call get_coach_briefing first and read task_snapshot before you ask me anything — you should already know what's on my boards. Then work through it conversationally, one question at a time: capture anything loose I mention, reconcile LIFE and WORK against reality, pick one must-win plus at most two supporting priorities from real cards, confirm the concrete next action for each, account for my schedule and energy, and set one if-then plan. Save it with log_check_in(kind:'morning').",
  midday: "Let's do my Midday Recalibration — keep it to about two minutes. Call get_coach_briefing first, check my morning must-win and supporting cards against what's actually moved, and tell me whether to continue, reorder, or defer. Only change tasks if I confirm. Save it with log_check_in(kind:'midday').",
  evening: "Let's do my Daily Closeout. Call get_coach_briefing first. Start with the tasks: what actually got done (move or mark it once I confirm), what came loose, and what to do with the priorities I didn't finish — next action or defer. Then one win, one friction, one adjustment, and the truth on habits, food, and workout. Save it with log_check_in(kind:'evening').",
  weekly: "Let's do my weekly review. Pull list_check_ins for the past 7 days, plus relevant tools (list_today_habits across the week, list_food_days, etc). Draft a one-paragraph summary essay of how the week went vs my active goals. Propose any goal status adjustments. Save the whole thing via log_check_in(kind:'weekly').",
  vision: "Let's do my biweekly vision review. Open with a future-self visualization prompt — have me describe a vivid scene from 5 years out where the north star is real. Then WOOP any drifting goals. Update vision.north_star or identity_statement if it has evolved. Call mark_vision_reviewed when we're done.",
};

const ONBOARDING_OPENER = "Let's set up Helm. Run the onboarding protocol: first check my current data (get_vision, list_goals, get_coach_briefing) to see where I am, then pick up at the first incomplete phase and guide me through it one step at a time, going deep. Start now.";

function openChatWith(message) {
  const chat = useChatStore.getState();
  chat.newConversation().then(() => chat.sendMessage(message)).catch(() => {});
  writeHashParams({ section: 'chat' });
}

export default function TodayView() {
  const briefing = useCoachStore((s) => s.briefing);
  const fetchAll = useCoachStore((s) => s.fetchAll);
  const habitsToday = useHabitsStore((s) => s.todayList);
  const fetchHabitsToday = useHabitsStore((s) => s.fetchToday);
  const t = useT();

  useEffect(() => {
    fetchAll().catch(() => {});
    fetchHabitsToday().catch(() => {});
  }, [fetchAll, fetchHabitsToday]);

  if (!briefing) return <p className="muted center-pad">{t('today.loading')}</p>;

  const { vision, cadence_pending, active_goals = [], onboarding } = briefing;
  const onboardingActive = onboarding && !onboarding.complete;
  const onboardingStepKey = onboardingActive ? (onboarding.next_step || 'vision') : null;
  const visible = visibleCadenceCards({
    pending: cadence_pending || {},
    settings: briefing.coach_settings || {},
    morningDone: !!briefing.today?.morning_check_in,
  });
  const [focalKind, ...laterKinds] = visible;

  function cadenceBody(kind) {
    if (kind === 'vision' && !vision?.last_reviewed_at) return t('cad.vision.bodyUnset');
    if (kind === 'vision') return t('cad.vision.body', { days: vision.days_since_review ?? '?' });
    return t(`cad.${kind}.body`);
  }

  function cadenceCta(kind) {
    return kind === 'vision' && !vision?.last_reviewed_at ? t('cad.vision.ctaUnset') : t(`cad.${kind}.cta`);
  }

  function quickCapture(text) {
    if (!text || !text.trim()) return;
    openChatWith(text.trim());
  }

  return (
    <div className="today-view">
      <FirstRunHint id="today">{t('hint.today')}</FirstRunHint>
      <header className="today-header">
        <h1>{t(greetingKey())}{vision?.identity_statement ? '.' : ''}</h1>
        {vision?.identity_statement && <div className="today-identity muted">{vision.identity_statement}</div>}
      </header>

      <div className="today-layout">
        <main className="today-main">
          <section className="today-now" aria-labelledby="today-now-heading">
            <div className="today-kicker">Now</div>
            {onboardingActive ? (
              <article>
                <h2 id="today-now-heading">{t('ob.' + onboardingStepKey + '.title')}</h2>
                <p className="muted">{t('ob.' + onboardingStepKey + '.body')}</p>
                <button type="button" className="primary cadence-cta today-now-action" onClick={() => openChatWith(ONBOARDING_OPENER)}>{t('ob.' + onboardingStepKey + '.cta')}</button>
              </article>
            ) : focalKind ? (
              <>
                <h2 id="today-now-heading">{t(`cad.${focalKind}.title`)}</h2>
                <p className="muted">{cadenceBody(focalKind)}</p>
                <button type="button" className="primary cadence-cta today-now-action" onClick={() => openChatWith(CADENCE_OPENERS[focalKind])}>{cadenceCta(focalKind)}</button>
              </>
            ) : (
              <>
                <h2 id="today-now-heading">The day is yours</h2>
                <p className="muted">Your scheduled coaching rhythm is clear. Capture what needs attention next.</p>
              </>
            )}
          </section>

          <section className="today-quick-capture" aria-labelledby="today-capture-label">
            <label id="today-capture-label" htmlFor="today-quick-capture">Capture for Coach</label>
            <textarea
              id="today-quick-capture"
              placeholder={t('today.quickCapture')}
              rows={2}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  quickCapture(event.target.value);
                  event.target.value = '';
                }
              }}
            />
            <span className="muted small">Enter to send · Shift+Enter for a new line</span>
          </section>

          <section className="today-evidence" aria-labelledby="today-evidence-heading">
            <div className="today-kicker">Stored in Helm</div>
            <h2 id="today-evidence-heading">Today’s evidence</h2>
            <div className="today-columns">
              <section className="today-col today-goals">
                <h3>{t('today.activeGoals')}</h3>
                {active_goals.length === 0 ? <p className="muted small">{t('today.noGoals')}</p> : active_goals.slice(0, 8).map((goal) => (
                  <div key={goal.id} className="today-goal-row" data-horizon={goal.horizon}>
                    <span className="today-goal-horizon">{goal.horizon}</span>
                    <span className="today-goal-title">{goal.title}</span>
                    {goal.target_date && <span className="muted small">{goal.target_date}</span>}
                  </div>
                ))}
              </section>

              <section className="today-col today-habits">
                <h3>{t('today.habits')}</h3>
                {(!habitsToday || habitsToday.habits.length === 0) ? <p className="muted small">{t('today.noHabits')}</p> : habitsToday.habits.slice(0, 8).map((habit) => (
                  <div key={habit.id} className={`today-habit-row${habit.completed ? ' done' : ''}`}>
                    <span className="today-habit-emoji">{habit.emoji || '•'}</span>
                    <span className="today-habit-name">{habit.name}</span>
                    <span className="muted small">{habit.today_quantity || 0}/{habit.goal_quantity}</span>
                  </div>
                ))}
              </section>

              <section className="today-col today-reflections">
                <h3>{t('today.reflections')}</h3>
                {(briefing.recent_check_ins || []).length === 0 ? <p className="muted small">{t('today.noReflections')}</p> : briefing.recent_check_ins.slice(0, 4).map((check) => (
                  <div key={check.id} className="today-reflection-row">
                    <span className="muted small">{check.date} · {check.kind}</span>
                    <span>{check.coach_summary || Object.values(check.payload || {})[0] || '…'}</span>
                  </div>
                ))}
              </section>
            </div>
          </section>
        </main>

        <aside className="today-rhythm" aria-labelledby="today-rhythm-heading">
          <div className="today-kicker">Day rhythm</div>
          <h2 id="today-rhythm-heading">Later</h2>
          {laterKinds.length > 0 ? laterKinds.map((kind) => (
            <CadenceCard key={kind} kind={kind} title={t(`cad.${kind}.title`)} body={cadenceBody(kind)} ctaLabel={cadenceCta(kind)} onCta={() => openChatWith(CADENCE_OPENERS[kind])} />
          )) : <p className="muted small">Nothing else is due in your coaching rhythm.</p>}
        </aside>
      </div>
    </div>
  );
}
