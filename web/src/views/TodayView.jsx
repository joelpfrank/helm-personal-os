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
  if (h < 5)  return 'today.late';
  if (h < 12) return 'today.morning';
  if (h < 17) return 'today.afternoon';
  if (h < 22) return 'today.evening';
  return 'today.night';
}

// One pending check-in. An <article> with a real heading, so the cards are a
// navigable list of things to do rather than an unlabelled stack of divs, and
// the CTA is announced with the cadence it belongs to.
function CadenceCard({ kind, title, body, ctaLabel, onCta }) {
  return (
    <article className={`today-cadence-card kind-${kind}`} aria-labelledby={`cadence-${kind}-title`}>
      <h3 id={`cadence-${kind}-title`} className="cadence-title">{title}</h3>
      <div className="cadence-body muted small">{body}</div>
      <button type="button" className="primary cadence-cta" onClick={onCta}>{ctaLabel}</button>
    </article>
  );
}

const CADENCE_OPENERS = {
  morning:
    "Let's run my Daily Command Meeting. Call get_coach_briefing first and read task_snapshot before you ask me anything — you should already know what's on my boards. Then work through it conversationally, one question at a time: capture anything loose I mention, reconcile LIFE and WORK against reality, pick one must-win plus at most two supporting priorities from real cards, confirm the concrete next action for each, account for my schedule and energy, and set one if-then plan. Save it with log_check_in(kind:'morning').",
  midday:
    "Let's do my Midday Recalibration — keep it to about two minutes. Call get_coach_briefing first, check my morning must-win and supporting cards against what's actually moved, and tell me whether to continue, reorder, or defer. Only change tasks if I confirm. Save it with log_check_in(kind:'midday').",
  evening:
    "Let's do my Daily Closeout. Call get_coach_briefing first. Start with the tasks: what actually got done (move or mark it once I confirm), what came loose, and what to do with the priorities I didn't finish — next action or defer. Then one win, one friction, one adjustment, and the truth on habits, food, and workout. Save it with log_check_in(kind:'evening').",
  weekly:
    "Let's do my weekly review. Pull list_check_ins for the past 7 days, plus relevant tools (list_today_habits across the week, list_food_days, etc). Draft a one-paragraph summary essay of how the week went vs my active goals. Propose any goal status adjustments. Save the whole thing via log_check_in(kind:'weekly').",
  vision:
    "Let's do my biweekly vision review. Open with a future-self visualization prompt — have me describe a vivid scene from 5 years out where the north star is real. Then WOOP any drifting goals. Update vision.north_star or identity_statement if it has evolved. Call mark_vision_reviewed when we're done.",
};

const ONBOARDING_OPENER =
  "Let's set up Helm. Run the onboarding protocol: first check my current data (get_vision, list_goals, get_coach_briefing) to see where I am, then pick up at the first incomplete phase and guide me through it one step at a time, going deep. Start now.";

function openChatWith(message) {
  // Switch to chat and seed a fresh conversation with the message.
  const chat = useChatStore.getState();
  // Start fresh so the coach context is clean.
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

  const { vision, cadence_pending, active_goals, onboarding } = briefing;
  const pending = cadence_pending || {};
  const onboardingActive = onboarding && !onboarding.complete;
  const onboardingStepKey = onboardingActive ? (onboarding.next_step || 'vision') : null;
  // Time gating lives in a pure, tested helper — see web/src/lib/cadence.js.
  const visible = visibleCadenceCards({
    pending,
    settings: briefing.coach_settings || {},
    morningDone: !!briefing.today?.morning_check_in,
  });

  function quickCapture(text) {
    if (!text || !text.trim()) return;
    openChatWith(text.trim());
  }

  return (
    <div className="today-view">
      <FirstRunHint id="today">{t('hint.today')}</FirstRunHint>
      <header className="today-header">
        <h1>{t(greetingKey())}{vision?.identity_statement ? '.' : ''}</h1>
        {vision?.identity_statement && (
          <div className="today-identity muted">{vision.identity_statement}</div>
        )}
      </header>

      {onboardingActive && (
        <section className="today-cadence" aria-labelledby="today-setup-heading">
          <h2 id="today-setup-heading" className="sr-only">{t('today.setupHeading')}</h2>
          <article className="today-cadence-card kind-vision" aria-labelledby="cadence-setup-title">
            <h3 id="cadence-setup-title" className="cadence-title">{t('ob.' + onboardingStepKey + '.title')}</h3>
            <div className="cadence-body muted small">{t('ob.' + onboardingStepKey + '.body')}</div>
            <button type="button" className="primary cadence-cta" onClick={() => openChatWith(ONBOARDING_OPENER)}>
              {t('ob.' + onboardingStepKey + '.cta')}
            </button>
          </article>
        </section>
      )}

      {!onboardingActive && visible.length > 0 && (
        <section className="today-cadence" aria-labelledby="today-cadence-heading">
          <h2 id="today-cadence-heading" className="sr-only">{t('today.cadenceHeading')}</h2>
          {visible.map((kind) => (
            <CadenceCard
              key={kind}
              kind={kind}
              title={t(`cad.${kind}.title`)}
              body={kind === 'vision' && !vision?.last_reviewed_at
                ? t('cad.vision.bodyUnset')
                : kind === 'vision'
                  ? t('cad.vision.body', { days: vision.days_since_review ?? '?' })
                  : t(`cad.${kind}.body`)}
              ctaLabel={kind === 'vision' && !vision?.last_reviewed_at
                ? t('cad.vision.ctaUnset')
                : t(`cad.${kind}.cta`)}
              onCta={() => openChatWith(CADENCE_OPENERS[kind])}
            />
          ))}
        </section>
      )}

      <section className="today-quick-capture">
        <textarea
          placeholder={t('today.quickCapture')}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              quickCapture(e.target.value);
              e.target.value = '';
            }
          }}
        />
      </section>

      <div className="today-columns">
        <section className="today-col">
          <h3>{t('today.activeGoals')}</h3>
          {active_goals.length === 0
            ? <p className="muted small">{t('today.noGoals')}</p>
            : active_goals.slice(0, 8).map((g) => (
                <div key={g.id} className={`today-goal-row horizon-${g.horizon}`}>
                  <span className="today-goal-horizon">{g.horizon}</span>
                  <span className="today-goal-title">{g.title}</span>
                  {g.target_date && <span className="muted small">{g.target_date}</span>}
                </div>
              ))
          }
        </section>

        <section className="today-col">
          <h3>{t('today.habits')}</h3>
          {(!habitsToday || habitsToday.habits.length === 0)
            ? <p className="muted small">{t('today.noHabits')}</p>
            : habitsToday.habits.slice(0, 8).map((h) => (
                <div key={h.id} className={`today-habit-row${h.completed ? ' done' : ''}`}>
                  <span className="today-habit-emoji">{h.emoji || '•'}</span>
                  <span className="today-habit-name">{h.name}</span>
                  <span className="muted small">
                    {h.today_quantity || 0}/{h.goal_quantity}
                  </span>
                </div>
              ))
          }
        </section>

        <section className="today-col">
          <h3>{t('today.reflections')}</h3>
          {(briefing.recent_check_ins || []).length === 0
            ? <p className="muted small">{t('today.noReflections')}</p>
            : briefing.recent_check_ins.slice(0, 4).map((c) => (
                <div key={c.id} className="today-reflection-row">
                  <span className="muted small">{c.date} · {c.kind}</span>
                  <span>{c.coach_summary || Object.values(c.payload || {})[0] || '…'}</span>
                </div>
              ))
          }
        </section>
      </div>
    </div>
  );
}
