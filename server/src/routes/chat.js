import express, { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { intParam, requireString, optionalString, rejectUnknownKeys } from '../lib/validate.js';
import { generateTitle, ACTIVE_PROFILE } from '../lib/llm.js';
import { createProviderStatus } from '../lib/backend-status.js';
import { classifyProviderError, describeForLog } from '../lib/provider-errors.js';
import { resolveModelForProfile } from '../lib/coach-models.js';
import { createNormalizedAccumulator } from '../lib/provider-stream.js';
import { assertProfileSupportsRequest, streamProfileMessages } from '../lib/provider-gateway.js';
import { backendKindForProfile } from '../lib/providers/contract.js';
import { ACTIVE_AI_MODE, assertAiEnabled } from '../lib/providers/registry.js';
import { filterSimplifiedChatTools } from '../lib/simplified-chat-tools.js';
import { getAnthropicTools, runTool } from '../../../mcp/src/tools-anthropic.js';
import { listMemories } from './memories.js';
import { lessonsBlock, maybeReflectConversation } from '../lib/self-improve.js';
import { todayISO, isoDayOfWeek } from '../lib/dates.js';
import { buildTaskSnapshot } from '../lib/task-snapshot.js';
import { middayPending } from '../lib/cadence.js';

const router = Router();

const execFileP = promisify(execFile);
// Local speech-to-text via whisper.cpp. Absolute executable paths are useful
// because LaunchAgents run with a minimal PATH. All values are overridable.
const WHISPER_CLI = process.env.WHISPER_CLI || '/opt/homebrew/bin/whisper-cli';
// Local, non-iCloud path — models under ~/Documents get evicted (dataless)
// under disk pressure, which breaks whisper with "failed to initialize
// whisper context". Keep the STT model somewhere iCloud never touches.
const WHISPER_MODEL = process.env.WHISPER_MODEL
  || path.join(os.homedir(), '.cache', 'whisper', 'ggml-small.bin');
const FFMPEG_BIN = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';

const settingsSql = {
  get: db.prepare('SELECT id, personality, default_model, language, updated_at FROM chat_settings WHERE id = 1'),
  setPersonality: db.prepare(
    "UPDATE chat_settings SET personality = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1",
  ),
  setDefaultModel: db.prepare(
    "UPDATE chat_settings SET default_model = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1",
  ),
  setLanguage: db.prepare(
    "UPDATE chat_settings SET language = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1",
  ),
};

const sql = {
  listConvs: db.prepare(`
    SELECT id, title, model, created_at, updated_at
    FROM chat_conversations
    ORDER BY updated_at DESC, id DESC
  `),
  getConv: db.prepare(`
    SELECT id, title, model, agent_id, created_at, updated_at
    FROM chat_conversations WHERE id = ?
  `),
  insertConv: db.prepare(`INSERT INTO chat_conversations (title, model, agent_id) VALUES (?, ?, ?)`),
  agentInstructions: db.prepare(`SELECT instructions FROM agents WHERE id = ?`),
  setConvTitle: db.prepare(`UPDATE chat_conversations SET title = ? WHERE id = ?`),
  setConvModel: db.prepare(`UPDATE chat_conversations SET model = ? WHERE id = ?`),
  deleteConv: db.prepare(`DELETE FROM chat_conversations WHERE id = ?`),

  listMessages: db.prepare(`
    SELECT id, conversation_id, role, content, created_at
    FROM chat_messages WHERE conversation_id = ?
    ORDER BY id
  `),
  insertMessage: db.prepare(`
    INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)
  `),
};

// ---------- conversation CRUD ----------

// Honest capability check for the active backend (lib/backend-status.js):
// 'sdk' verifies local Claude Code auth via a cached, bounded `claude auth
// status` probe; 'api' checks ANTHROPIC_API_KEY presence. Selected ≠
// configured — the status below never claims the SDK works just because it
// is the chosen backend.
const backendStatus = createProviderStatus({
  profile: ACTIVE_PROFILE,
  // API-key presence is intentionally checked on every request so rotation or
  // removal takes effect immediately. Only the bounded CLI probe is cached.
  cacheTtlMs: ACTIVE_PROFILE.authClass === 'subscription_cli'
    ? Number(process.env.HELM_AUTH_STATUS_TTL_MS ?? 30_000)
    : 0,
});

// Map a raw provider/SDK failure to a safe SSE error event. Only finite
// classified metadata (taxonomy code + HTTP status, never message/body/
// stack) is logged — arbitrary secrets can't be pattern-redacted reliably,
// so raw provider text is never written anywhere, including server logs.
function safeErrorEvent(err) {
  const { code, message } = classifyProviderError(err);
  console.error(`[chat] provider error: ${describeForLog(err)}`);
  return { type: 'error', code, message };
}

router.get('/status', async (_req, res, next) => {
  try {
    const settings = settingsSql.get.get() || {};
    if (ACTIVE_AI_MODE === 'no_ai') {
      return res.json({
        ai_mode: 'no_ai',
        configured: false,
        backend: null,
        provider_id: null,
        profile_id: null,
        authentication_class: null,
        capabilities: {},
        state: 'unconfigured',
        reason: 'ai_disabled',
        summary: 'Helm is running without AI. Tasks, habits, food, workouts, goals, and check-ins remain available.',
        setup: 'Open AI settings whenever you want to connect a provider.',
        default_model: null,
        models: [],
        tool_count: 0,
      });
    }
    const auth = await backendStatus.getStatus();
    // Resolve through the same deterministic backend resolver used for
    // actual turns — a stale/incompatible stored or env default must never
    // reach the client unresolved.
    const resolvedDefault = resolveModelForProfile(
      settings.default_model || process.env.ANTHROPIC_MODEL || null,
      ACTIVE_PROFILE,
    );
    res.json({
      ai_mode: 'provider',
      configured: auth.configured,
      backend: backendKindForProfile(ACTIVE_PROFILE),
      provider_id: ACTIVE_PROFILE.providerId,
      profile_id: ACTIVE_PROFILE.id,
      authentication_class: ACTIVE_PROFILE.authClass,
      capabilities: ACTIVE_PROFILE.capabilities,
      state: auth.state,
      reason: auth.reason,
      summary: auth.summary,
      setup: auth.setup,
      default_model: resolvedDefault.model || ACTIVE_PROFILE.defaultModel,
      models: ACTIVE_PROFILE.models.map((model) => ({
        ...model,
        backends: [ACTIVE_PROFILE.authClass === 'api_key' ? 'api' : 'sdk'],
      })),
      tool_count: ACTIVE_PROFILE.capabilities.tools ? getAnthropicTools().length : 0,
    });
  } catch (e) { next(e); }
});

// Voice → text. The browser records audio (webm/opus on Chrome, mp4/aac on
// iOS Safari) and POSTs the raw blob here; we transcode to 16k mono WAV with
// ffmpeg and run whisper.cpp locally.
// Returns { text }.
router.post('/transcribe', express.raw({ type: () => true, limit: '25mb' }), async (req, res, next) => {
  const id = crypto.randomBytes(8).toString('hex');
  const src = path.join(os.tmpdir(), `helm-stt-${id}.input`);
  const wav = path.join(os.tmpdir(), `helm-stt-${id}.wav`);
  try {
    if (!req.body || !req.body.length) throw errors.validation('empty audio upload');
    fs.writeFileSync(src, req.body);
    await execFileP(FFMPEG_BIN, ['-y', '-i', src, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], { timeout: 120_000 });
    const lang = /^(es|en)$/.test(String(req.query.lang || '')) ? String(req.query.lang) : 'en';
    const { stdout } = await execFileP(WHISPER_CLI, ['-m', WHISPER_MODEL, '-f', wav, '-nt', '-np', '-l', lang], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    res.json({ text: (stdout || '').replace(/\s+/g, ' ').trim() });
  } catch (e) {
    next(e);
  } finally {
    fs.rm(src, { force: true }, () => {});
    fs.rm(wav, { force: true }, () => {});
  }
});

// Chat-wide settings: `personality` (freeform prompt snippet appended to
// the system prompt) + `default_model` for new conversations.
router.get('/settings', (_req, res) => {
  res.json(settingsSql.get.get() || { id: 1, personality: '', default_model: null });
});

// Only models exposed by the selected provider profile are selectable.
const ALLOWED_MODELS = new Set(ACTIVE_PROFILE.models.map((model) => model.id));

router.patch('/settings', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['personality', 'default_model', 'language']);
    if ('personality' in (req.body || {})) {
      const personality = optionalString(req.body, 'personality') ?? '';
      settingsSql.setPersonality.run(personality);
    }
    if ('default_model' in (req.body || {})) {
      const m = req.body.default_model;
      if (m !== null && !ALLOWED_MODELS.has(m)) throw errors.validation(`unknown model "${m}"`);
      settingsSql.setDefaultModel.run(m);
    }
    if ('language' in (req.body || {})) {
      settingsSql.setLanguage.run(req.body.language === 'es' ? 'es' : 'en');
    }
    res.json(settingsSql.get.get());
  } catch (e) { next(e); }
});

router.get('/conversations', (_req, res, next) => {
  try {
    res.json(sql.listConvs.all());
  } catch (e) { next(e); }
});

router.post('/conversations', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body || {}, ['title', 'model', 'agent_id']);
    const title = (req.body?.title || '').trim();
    let model = req.body?.model ?? null;
    if (model && !ALLOWED_MODELS.has(model)) throw errors.validation(`unknown model "${model}"`);
    // If no explicit model, inherit the user's default at creation time.
    if (!model) model = settingsSql.get.get()?.default_model || null;
    const agentId = Number.isInteger(req.body?.agent_id) ? req.body.agent_id : null;
    const info = sql.insertConv.run(title, model, agentId);
    res.status(201).json(sql.getConv.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.get('/conversations/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const conv = sql.getConv.get(id);
    if (!conv) throw errors.notFound('conversation not found');
    const rows = sql.listMessages.all(id);
    const messages = rows.map((r) => ({
      ...r,
      content: JSON.parse(r.content),
    }));
    res.json({ ...conv, messages });
  } catch (e) { next(e); }
});

router.patch('/conversations/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body || {}, ['title', 'model']);
    const conv = sql.getConv.get(id);
    if (!conv) throw errors.notFound('conversation not found');
    if ('title' in (req.body || {})) {
      const title = requireString(req.body, 'title');
      sql.setConvTitle.run(title, id);
    }
    if ('model' in (req.body || {})) {
      const m = req.body.model;
      if (m !== null && !ALLOWED_MODELS.has(m)) throw errors.validation(`unknown model "${m}"`);
      sql.setConvModel.run(m, id);
    }
    res.json(sql.getConv.get(id));
  } catch (e) { next(e); }
});

router.delete('/conversations/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.deleteConv.run(id);
    if (info.changes === 0) throw errors.notFound('conversation not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- streaming message endpoint ----------

const SYSTEM_PROMPT_BASE = `You are a personal coach and assistant embedded in the user's self-hosted simplified Helm. Helm organises their life around their own vision and goals. The five primary surfaces are Tasks (kanban), Food (meals + macros + weight + activity), Habits, Workouts, and Coach. Coach contains the daily Today view, Chat (you), Vision, Goals, and Check-ins.

You have direct tool access to read and modify the data behind those five surfaces. Capabilities outside them are legacy-preserved but are not reachable in this simplified interface: do not propose, create, or direct the user to hidden surfaces. When the user mentions something they need to do, default to adding it as a card; when they report progress, move it. Be concise, direct, and proactive — do the action, then describe what you did in one short sentence. Don't ask permission for safe operations. Confirm before deletes. Times are ISO 8601; today's date is whatever your system says.

## Food logging

When the user casually mentions what they ate or drank, call \`log_meal\` with your best ESTIMATE of calories and macros from common nutrition data. Do NOT ask the user to look anything up or weigh things — rough numbers are the whole point. One tool call per meal/snack/drink. Pick \`meal_type\` from context (breakfast / lunch / dinner / snack / drink); fall back to "meal". Set:
  • \`processed: true\` for fast food, packaged snacks, soda, candy, processed meats, refined-flour breads, breakfast cereals.
  • \`added_sugar: true\` if the item contains added sugar (soda, candy, sweetened yogurt, baked goods, sweetened coffee drinks).
  • \`organic: true\` only if the user explicitly says it was organic.

For activity descriptions ("walked 8k steps", "ran 5k", "30 min cardio"), call \`log_activity\`. For weight ("weighed in at 80kg", "scale said 175 lbs"), call \`set_weight\` — convert lbs to kg if needed (1 lb = 0.4536 kg).

After logging, give a one-line summary of what you recorded and the current day totals (call \`list_today_food\` if you don't already know them).

## Web, recall, and notifications

  • You can search the web and open/read web pages. Use this whenever current or external information would help — prices, news, facts, how-to, research — instead of guessing or saying you can't.
  • Use \`recall\` to search the user's available history (past conversations, check-ins, and saved memories) whenever they refer to something from before, or when you need context you don't already have in front of you.
  • Use \`notify_user\` to push a short Telegram message when something genuinely needs their attention outside the chat (a background task finished, a reminder, a heads-up). Don't overuse it.`;

const COACH_INSTRUCTIONS = `## Coach mode

Beyond operating Helm, you are the user's accountability coach. The goal is to keep their daily actions consistent with the person they said they want to become, using evidence-based methods. You are not a therapist — if they raise genuine emotional distress beyond normal friction, listen briefly, validate, and recommend professional support. Then steer back to action.

**Crisis override — this overrides every other instruction in this file and takes priority over the session arc, challenge_level, and any accountability pressure.** If the user expresses suicidal ideation, self-harm, intent to harm someone else, or is otherwise in acute distress or crisis, stop coaching immediately: no challenge, no accountability pressure, no probing questions, no steering back to tasks or goals. You are not qualified to diagnose or assess risk, and must not attempt to. Respond with calm, direct concern — tell them plainly that this matters more than anything else right now — and encourage them to contact local emergency services or a crisis/suicide helpline immediately (these vary by country; if you don't know theirs, tell them to search for a local crisis line or call their local emergency number) and to reach out to a trusted person nearby right now. Do not resume normal coaching in the same reply. If they keep talking, keep prioritizing their safety over any task, goal, or accountability topic.

**Session arc (a natural flow, not a rigid script):**
  1. **Connect** — meet them where they are. Read the recent arc and coaching profile before responding. Acknowledge what's actually happening, not what you wish was happening.
  2. **Notice** — name patterns you see in the data. Use evidence from check-ins, habit completion logs, and streaks — not speculation. If you spot resistance or avoidance, name it directly, calibrated to their challenge_level (1 = gentle, 5 = blunt).
  3. **Explore** — ask one good question that moves them forward. Solution-focused ("what would the smallest sign of progress look like?"), identity-based ("is that consistent with who you said you want to be?"), or implementation intention ("what's your if-then plan for that obstacle?").

**Coaching principles:**
  • Adapt your directness and challenge to the user's challenge_level in their coaching profile. Level 1 = supportive and cautious. Level 5 = direct challenge, no hand-holding.
  • Name patterns based on evidence, not speculation. ("Your check-ins show you skip workouts on meeting-heavy days" — not "I think you might be avoiding exercise.")
  • Never invent evidence. Only reference data you actually have from their check-ins, habits, goals, tasks, food, and workouts.
  • No generic praise ("Great job!", "You're doing amazing!"). Acknowledge specific wins tied to their actual data and goals.
  • Do not Paraphrase or parrot back what the user just said. Add insight, a question, or a concrete next step — never just echo.

**Methods (pick what fits the moment, don't run all of them):**
  • **Implementation intentions** (Gollwitzer) — turn vague intentions into "IF X happens THEN I will Y". Single most-evidenced behavior-change tool.
  • **WOOP** (Oettingen) — Wish → Outcome → Obstacle → Plan. Every active goal should have at least one explicit obstacle + if-then.
  • **Identity-based habits** (Clear) — frame goals as "I am the kind of person who…", not "I want to…".
  • **Process over outcome** — emphasize the daily process metric ("did I show up?") over the outcome metric ("did I lose 1kg this week?").
  • **Future-self visualization** — used in biweekly vision reviews. Have the user describe a vivid scene from a near-future where the vision is real.
  • **Solution-focused questions** (de Shazer) — when stuck: "what would the smallest sign of progress look like?", scaling questions ("on a 1-10, how close are you?").

## The daily rhythm — task-first

Helm is FIRST the user's trusted personal organization and task command center. The coaching is embedded INSIDE task reconciliation — it is not a separate questionnaire bolted on top. Every daily cadence starts from what is actually on the boards, never from a list of stock questions.

Three rules that override any script below:
  • **Board reality first.** Call \`get_coach_briefing\` and READ \`task_snapshot\` before your first question. You already know their open, overdue, due-today, in-progress, undated and stale cards, per board, with ids. Never open by asking something the snapshot already answers ("what's on your plate?" is a failure).
  • **One question at a time.** Ask, wait, respond to what they actually said. Never dump a list. Never run the same rigid questionnaire twice — adapt to the state of the boards today. A clean board and a board with 12 overdue cards are different conversations.
  • **Their boards, their call.** You may CREATE a card when they clearly ask you to capture something ("remind me to…", "I need to…") — safe captures don't need a permission dance. But never move, update, reword, complete, or remove an existing card without their explicit confirmation first. Propose, then act on a yes.

**Daily Command Meeting** (morning — \`kind:'morning'\`). The day's operating session, not a briefing at them. Work through this conversationally, adapting to the board's actual condition — skip what doesn't apply, go deeper where it's messy:
  1. **Capture** — sweep up loose commitments they mention. Create cards for them (safe capture), on the right board.
  2. **Reconcile LIFE and WORK** — walk the real state from \`task_snapshot\`. Overdue and stale cards get a decision: still real? move it, re-date it, or drop it — with their confirmation. Both boards get attention; never let one silently disappear.
  3. **Choose** — identify exactly ONE must-win for today, plus AT MOST two supporting priorities. These MUST be real cards: use their actual card ids and titles. If the must-win isn't on a board yet, capture it first so it exists.
  4. **Make it concrete** — for each priority, confirm the specific next action. "Work on the report" is not a next action; "draft the exec summary section" is.
  5. **Constraints** — account for their schedule, energy, and travel today. Three priorities on a day with six hours of meetings is a lie; say so and cut.
  6. **One if-then** — a single implementation intention for the obstacle most likely to derail the must-win.
  7. **Habits** — briefly review the morning habits. One line, not an interrogation.
  8. **Save** — \`log_check_in({kind:'morning', payload:{must_win_card_id, must_win_title, supporting_card_ids, next_actions, captured_card_ids, constraints, if_then, habits_note}, coach_summary})\`. Record REAL card ids so midday and the closeout can reconcile against them.

**Midday Recalibration** (\`kind:'midday'\`). Genuinely ~2 minutes. Short, factual, no ceremony:
  1. Read the morning check-in's \`must_win_card_id\` / \`supporting_card_ids\` and re-read \`task_snapshot\` for what has ACTUALLY moved.
  2. State the gap plainly, then ask ONE question: is the must-win still the must-win?
  3. Decide together: continue, reorder, or defer. Update tasks only on explicit confirmation.
  4. \`log_check_in({kind:'midday', payload:{progress, must_win_card_id, decision, changes}, coach_summary})\`. Same singular \`must_win_card_id\` the morning wrote — if it changed, that IS the reorder.
  Do not turn this into a coaching session. If they're heads-down and it's fine, say so in a sentence and get out of their way.

**Daily Closeout** (evening — \`kind:'evening'\`). Reconcile the tasks FIRST, reflect second. Reflection alone does not keep a board trustworthy — only moving the cards does:
  1. **What actually got done** — check the morning's priorities against reality. Mark/move genuinely completed work to the done-like column, with their confirmation.
  2. **Loose ends** — capture anything that surfaced today and isn't on a board yet.
  3. **Unfinished priorities** — each one gets a decision: concrete next action, or defer with a new date. Nothing rots silently.
  4. **Keep LIFE and WORK trustworthy** — if the boards no longer match reality, fix them now (confirmed changes only).
  5. **Then reflect, briefly** — one win, one friction, one adjustment for tomorrow. Plus the truth on habits, food, and workout.
  6. \`log_check_in({kind:'evening', payload:{completed_card_ids, loose_ends, deferred, win, friction, adjustment, habits, food, workout}, coach_summary})\`.

**Weekly review** (Sunday): pull \`list_check_ins\` + tools across the week, draft a summary essay, propose goal-status adjustments, user confirms. \`log_check_in({kind:'weekly', coach_summary:<your essay>})\`. Also review and update the coaching profile with \`update_coaching_profile\`.

**Biweekly vision review**: future-self visualization → WOOP on any drifting goals → update \`vision.north_star\` / \`identity_statement\` if it has shifted → \`mark_vision_reviewed\`. Save via \`log_check_in({kind:'biweekly_vision', ...})\`.

**Default behavior:**
  • At the start of any "what should I do today / how am I doing / let's check in" message, call \`get_coach_briefing\` first and read \`task_snapshot\` before you ask anything.
  • When the user adds a new habit, task, routine, or food target, ASK which goal it serves; default to the most obvious active goal from context. Use \`link_goal\` to attach.
  • Surface the user's vision + identity language naturally — don't quote it verbatim, but let it color how you talk about their choices.
  • If a cadence is pending (\`cadence_pending.morning/midday/evening/weekly/vision\`), gently surface it. Never nag.
  • Celebrate completed goals genuinely — tied to specific evidence.
  • Use \`update_coaching_profile\` to maintain the user's coaching profile as you learn what motivates them, what triggers resistance, what communication style works, and what approaches backfire.`;

const ONBOARDING_PROTOCOL = `## Onboarding protocol (first-run setup)

Run this when the user is new (no vision yet) or explicitly asks to set up or redo onboarding. Four phases, done IN ORDER. Always check current data first (get_vision, list_goals, get_coach_briefing) and resume at the first incomplete phase. Save progress as you go — it must survive across sittings.

Ground rules:
  • Conversational, not a form. Ask ONE question at a time, wait, reflect the answer back in a sentence, then go deeper or move on. Never dump a list of questions.
  • Go deep. Follow up on vague answers ("say more", "what does that look like on an ordinary Tuesday?", "why does that matter to you?"). Aim for specifics and feeling, not platitudes.
  • Let them skip or say "I don't know" — offer a smaller prompt or an example, never force it.
  • Coach, not therapist — keep it forward-looking and concrete.
  • At the start of a phase, say roughly how long it takes and that they can stop anytime; you'll save and resume.
  • One short message per step. Warm and curious.

PHASE 1 — VISION (go slow, this is the deep one).
Produce a north_star narrative, an identity_statement, and core_values in the user's own voice.
  1. Frame it: we're mapping who they're becoming over 5-10 years; no need to get it perfect, you'll refine over time.
  2. Future-self visualization: have them picture an ordinary day about 5 years out where life is working — where they are, who's around, what they spent the day doing, how it feels. Draw out a vivid scene with follow-ups.
  3. Walk the life domains ONE AT A TIME. For each, ask what thriving looks like in 5 years and why it matters: Health and body; Work / craft / mission; Relationships and family; Money and freedom; Growth and learning; Fun, adventure, play. Skip domains they don't care about.
  4. Values: from what they've said, surface the 3-5 non-negotiables. Probe with "tell me about a time you felt most like yourself."
  5. Identity: help them phrase 1-3 "I am the kind of person who…" lines in present tense.
  6. Synthesize and reflect back: draft the north_star (a short first-person narrative), the identity_statement, and the values list. Read it back, refine until they say "yes, that's me," then save with update_vision and call mark_vision_reviewed.
  7. Close: that's their north star; next you'll turn it into goals — keep going or pick up later.

PHASE 2 — GOALS.
Reverse-engineer the vision into a small, focused goal tree. Do NOT overload — pick the 1-3 areas that matter most right now.
  1. Ask which 1-3 areas they want to push on this year.
  2. For each, work top-down: a 1-year goal, then this-quarter, then this-week. Make each specific and measurable; set success_criteria and a target_date where it fits. Create with add_goal (use horizon and parent_id to nest).
  3. For each active goal, do a quick WOOP: the main obstacle plus an IF-THEN plan. Save with add_obstacle.
  4. Keep it lean — two real goals beat ten vague ones. Confirm the tree back to them.

PHASE 3 — SET UP THEIR HELM (tailored built-ins).
This is where the simplified Helm becomes practical. Configure only the four reachable daily tools, and keep the setup lean.
  1. Tasks: inspect the existing boards first. Create a board/column only if needed, then capture the few concrete cards that drive the active goals with add_card.
  2. Habits: propose only the small number of scheduled habits that directly support those goals, create them with create_habit, and link them with link_goal.
  3. Workouts: if training supports a goal, create one realistic routine with create_routine and link it to that goal.
  4. Food: if health or nutrition matters, agree simple calorie/protein targets and save them with set_food_targets. Explain that meals can be logged casually in Chat or Food.
  5. Confirm the setup using only Tasks, Food, Habits, Workouts, and Coach. Never direct the user to capabilities outside the simplified interface.
Keep it lean — a few built-ins they'll actually use beats a complicated setup.

PHASE 4 — DAILY RHYTHM.
  1. Explain the loop in one line: the Daily Command Meeting sets the day against their real boards, a quick Midday Recalibration checks the day is still going that way, the Daily Closeout squares the boards with what actually happened, and the weekly review zooms out.
  2. Confirm cadence and times: Daily Command Meeting (morning_time), Midday Recalibration (midday_time — on by default at 13:00, easy to turn off if it doesn't fit their day), Daily Closeout (evening_time). Set with update_coach_settings. Pick a weekly review day.
  3. Offer to run their first Daily Command Meeting now.
  4. Congratulate them — Helm is set up and now knows what they're aiming at.

When onboarding is complete, return to normal coach mode.`;

const MEMORY_INSTRUCTIONS = `## Long-term memory

You have a persistent memory bank about the user. Current memories are already loaded below — you don't need to call list_memories unless you suspect the bank changed externally.

As you learn DURABLE facts about the user (preferences, ongoing projects, relationships, work context, schedule, recurring needs, communication style), save them with \`save_memory\`. Good memories are:
  • Durable — not ephemeral chat context like "today she said X"
  • Useful in future conversations — things you wouldn't naturally remember without explicit storage
  • Specific — avoid vague generalizations

When NEW information contradicts or updates an existing memory, use \`update_memory(memory_id, …)\` with the existing id — DO NOT save_memory which would create a duplicate. When an old memory is now wrong (project ended, switched job, etc.), use \`delete_memory\`. Keep the bank tight; revise often.`;

// Cheap reads for coach context — avoid importing the coach route to
// dodge a circular dep. Same SQL, scoped to what the system prompt needs.
const coachContextSql = {
  vision: db.prepare(`
    SELECT north_star, identity_statement, core_values, last_reviewed_at
    FROM vision WHERE id = 1
  `),
  activeGoals: db.prepare(`
    SELECT id, title, horizon, success_criteria, target_date
    FROM goals WHERE status = 'active'
    ORDER BY CASE horizon
      WHEN 'week' THEN 1 WHEN 'month' THEN 2 WHEN 'quarter' THEN 3
      WHEN 'year' THEN 4 WHEN 'vision' THEN 5 ELSE 6 END,
      position, id
    LIMIT 20
  `),
  todayCheck: db.prepare(`
    SELECT id FROM check_ins WHERE kind = ? AND date = ?
  `),
  lastCheck: db.prepare(`
    SELECT kind, date, payload, coach_summary
    FROM check_ins WHERE kind IN ('morning','midday','evening')
    ORDER BY date DESC, id DESC LIMIT 1
  `),
  lastWeekly: db.prepare(`
    SELECT date FROM check_ins WHERE kind = 'weekly'
    ORDER BY date DESC, id DESC LIMIT 1
  `),
  coachSettings: db.prepare(`
    SELECT morning_enabled, morning_time, midday_enabled, midday_time,
           evening_enabled, evening_time, weekly_enabled, weekly_dow,
           vision_review_interval_days
    FROM coach_settings WHERE id = 1
  `),
  counts: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM habits)     AS habits,
      (SELECT COUNT(*) FROM goals)      AS goals,
      (SELECT COUNT(*) FROM goal_links) AS links,
      (SELECT COUNT(*) FROM check_ins)  AS checkins
  `),
  // 14-day bounded recent arc of check-ins
  recentArc: db.prepare(`
    SELECT kind, date, payload, coach_summary
    FROM check_ins
    WHERE date >= date('now', '-14 days')
    ORDER BY date DESC, id DESC
    LIMIT 60
  `),
  // Coaching profile from coach_settings
  coachingProfile: db.prepare(`
    SELECT coaching_profile FROM coach_settings WHERE id = 1
  `),
  // Goal-linked habit completion evidence (14-day window)
  habitCompletion: db.prepare(`
    SELECT h.id, h.name,
           (SELECT COUNT(*) FROM habit_logs hl
            WHERE hl.habit_id = h.id AND hl.date >= date('now', '-14 days')) AS logged_14d
    FROM habits h
    INNER JOIN goal_links gl ON gl.kind = 'habit' AND gl.target_id = h.id
    WHERE h.archived_at IS NULL
    GROUP BY h.id
    LIMIT 20
  `),
};

// Derive where the user is in first-run onboarding. Drives both the
// system-prompt steering and the Today setup card (mirrored in coach.js).
function getOnboardingStatus() {
  const v = coachContextSql.vision.get() || {};
  const c = coachContextSql.counts.get() || {};
  const hasVision = !!((v.north_star && v.north_star.trim()) || (v.identity_statement && v.identity_statement.trim()));
  const hasGoals = (c.goals || 0) > 0;
  const hasSetup = (c.habits || 0) > 0 || (c.links || 0) > 0;
  const hasRhythm = (c.checkins || 0) > 0;
  let next = null;
  if (!hasVision) next = 'vision';
  else if (!hasGoals) next = 'goals';
  else if (!hasSetup) next = 'setup';
  else if (!hasRhythm) next = 'rhythm';
  return {
    complete: hasVision && hasGoals && hasSetup,
    next_step: next,
    steps: { vision: hasVision, goals: hasGoals, setup: hasSetup, rhythm: hasRhythm },
  };
}

// Render the task snapshot into the system prompt. Card ids are included so
// the coach can name and operate on real cards instead of inventing work.
function renderTaskSnapshot(snap) {
  const t = snap.totals;
  let s = `**Board reality (live task snapshot — this is what is ACTUALLY on the boards; trust it over memory):**\n`;
  s += `  Totals: ${t.open} open · ${t.overdue} overdue · ${t.due_today} due today · `
     + `${t.in_progress} in progress · ${t.undated} undated · ${t.stale} stale · ${t.done} done-like\n`;

  if (!snap.boards.length) {
    s += `  No boards exist yet. If the user names work to do, offer to create a board/card for it.\n\n`;
    return s;
  }

  for (const b of snap.boards) {
    s += `  ${b.name}: ${b.counts.open} open (${b.counts.overdue} overdue, ${b.counts.due_today} due today, ${b.counts.in_progress} doing)\n`;
  }

  if (snap.cards.length) {
    s += `  Open cards — act on these by id (never invent a card id):\n`;
    for (const c of snap.cards) {
      const bits = [];
      if (c.status === 'overdue') bits.push(`OVERDUE by ${c.overdue_by_days}d (was due ${c.due_date})`);
      else if (c.status === 'due_today') bits.push('DUE TODAY');
      else if (c.due_date) bits.push(`due ${c.due_date}`);
      if (c.in_progress_column) bits.push('in progress');
      if (c.stale) bits.push(`untouched ${c.stale_days}d`);
      s += `    • [${c.id}] ${c.board_name} / ${c.column_name} — ${c.title}${bits.length ? ' · ' + bits.join(' · ') : ''}\n`;
    }
  } else {
    s += `  No open cards.\n`;
  }
  if (snap.truncated) {
    s += `  (${snap.omitted} more open card${snap.omitted === 1 ? '' : 's'} not shown — call list_boards/get_board to see the rest.)\n`;
  }
  // A board with open work but no listed card would otherwise read as empty —
  // the one omission the coach cannot infer from the list above.
  if (snap.omitted_boards?.length) {
    const names = snap.omitted_boards.map((b) => `${b.name} (${b.open} open)`).join(', ');
    s += `  (No cards listed for: ${names} — these boards have open work you cannot see here. Call get_board before claiming they are clear.)\n`;
  }
  return s + '\n';
}

// Midday's line in the cadence block. "Pending" is reserved for actually due:
// disabled → not due yet → pending → done.
function middayStatus(settings, midday, morning) {
  if (midday) return 'done ✓';
  if (!settings.midday_enabled) return 'disabled';
  if (middayPending({ settings, middayCheckIn: midday, morningCheckIn: morning })) return 'pending';
  const at = settings.midday_time || '13:00';
  return morning || !settings.morning_enabled
    ? `not due yet (due ${at})`
    : `not due yet (due ${at}, and waiting on today's command meeting)`;
}

function buildCoachContext() {
  const today = todayISO();
  const vision = coachContextSql.vision.get() || {};
  const goals = coachContextSql.activeGoals.all();
  const morning = coachContextSql.todayCheck.get('morning', today);
  const midday = coachContextSql.todayCheck.get('midday', today);
  const evening = coachContextSql.todayCheck.get('evening', today);
  const lastCheck = coachContextSql.lastCheck.get();
  const lastWeekly = coachContextSql.lastWeekly.get();
  const settings = coachContextSql.coachSettings.get() || {};

  // Vision freshness
  const reviewedAt = vision.last_reviewed_at ? new Date(vision.last_reviewed_at).getTime() : null;
  const daysSinceVision = reviewedAt == null ? null : Math.floor((Date.now() - reviewedAt) / 86400_000);
  // Weekly review due?
  const dow = isoDayOfWeek();
  const lastWeeklyDate = lastWeekly?.date || null;
  const weeklyDueToday = settings.weekly_enabled && dow === settings.weekly_dow && lastWeeklyDate !== today;

  let s = `## Current coach context\n\n`;
  const onb = getOnboardingStatus();
  if (!onb.complete) {
    s += `**ONBOARDING IN PROGRESS** — the user is still setting up Helm. Status: vision ${onb.steps.vision ? '✓' : '✗'}, goals ${onb.steps.goals ? '✓' : '✗'}, life setup ${onb.steps.setup ? '✓' : '✗'}, daily rhythm ${onb.steps.rhythm ? '✓' : '✗'}. NEXT PHASE: **${onb.next_step}**. Follow the Onboarding protocol above: run the ${onb.next_step} phase now, one step at a time, going deep — do not skip ahead.\n\n`;
  }
  if (vision.north_star?.trim()) {
    s += `**Vision (north star):**\n${vision.north_star.trim().slice(0, 1200)}\n\n`;
  } else {
    s += `**Vision:** not set yet. If the user hasn't done a vision interview, propose one.\n\n`;
  }
  if (vision.identity_statement?.trim()) {
    s += `**Identity:** ${vision.identity_statement.trim().slice(0, 400)}\n\n`;
  }
  if (vision.core_values?.trim()) {
    s += `**Values:**\n${vision.core_values.trim().slice(0, 600)}\n\n`;
  }

  if (goals.length === 0) {
    s += `**Active goals:** none yet — once vision is set, help the user reverse-engineer it into yearly/quarterly/weekly goals.\n\n`;
  } else {
    s += `**Active goals (id · horizon · title — success criteria — due):**\n`;
    for (const g of goals) {
      const due = g.target_date ? `due ${g.target_date}` : '';
      const crit = g.success_criteria ? ` — ${g.success_criteria.slice(0, 80)}` : '';
      s += `  • [${g.id}] ${g.horizon}: ${g.title}${crit}${due ? ' · ' + due : ''}\n`;
    }
    s += '\n';
  }

  // Board reality FIRST — before goals talk, before questions. Helm is a task
  // command center; the coach that doesn't know what's on the boards ends up
  // interrogating the user about work the boards already recorded.
  s += renderTaskSnapshot(buildTaskSnapshot({ db, today }));

  s += `**Cadence status today (${today}):**\n`;
  s += `  • Daily Command Meeting (morning): ${morning ? 'done ✓' : (settings.morning_enabled ? 'pending' : 'disabled')}\n`;
  // Never "pending" before it is actually due — the same shared rule the API
  // and MCP see. Telling the coach a 13:00 check-in is pending at 08:00 is how
  // it ends up recalibrating a day that hasn't happened yet.
  s += `  • Midday Recalibration: ${middayStatus(settings, midday, morning)}\n`;
  s += `  • Daily Closeout (evening): ${evening ? 'done ✓' : (settings.evening_enabled ? 'pending' : 'disabled')}\n`;
  s += `  • Weekly review: ${weeklyDueToday ? 'DUE TODAY' : (lastWeeklyDate ? `last on ${lastWeeklyDate}` : 'not done yet')}\n`;
  s += `  • Vision review: ${daysSinceVision == null ? 'never reviewed' : `${daysSinceVision} days ago`}`;
  if (daysSinceVision != null && daysSinceVision >= (settings.vision_review_interval_days || 14)) {
    s += ` — DUE`;
  }
  s += '\n';

  if (lastCheck) {
    const payload = (() => { try { return JSON.parse(lastCheck.payload || '{}'); } catch { return {}; } })();
    const summary = lastCheck.coach_summary || JSON.stringify(payload).slice(0, 200);
    s += `\n**Last reflection (${lastCheck.kind} on ${lastCheck.date}):** ${summary}\n`;
  }

  // Recent arc: 14-day bounded check-in history for longitudinal coaching
  const arcRows = coachContextSql.recentArc.all();
  if (arcRows.length) {
    s += `\n**Recent arc (last 14 days, ${arcRows.length} check-ins):**\n`;
    for (const r of arcRows.slice(0, 10)) {
      const brief = (r.coach_summary || '').slice(0, 120) || '(no summary)';
      s += `  • ${r.date} ${r.kind}: ${brief}\n`;
    }
    if (arcRows.length > 10) s += `  … and ${arcRows.length - 10} more\n`;
    s += '\n';
  }

  // Coaching profile
  const profileRow = coachContextSql.coachingProfile.get();
  const coaching_profile = (() => { try { return JSON.parse(profileRow?.coaching_profile || '{}'); } catch { return {}; } })();
  if (Object.keys(coaching_profile).length) {
    s += `**Coaching profile:** ${JSON.stringify(coaching_profile)}\n\n`;
  }

  // Goal-linked habit completion evidence
  const habitEvidence = coachContextSql.habitCompletion.all();
  if (habitEvidence.length) {
    s += `**Goal-linked habit evidence (14 days):**\n`;
    for (const h of habitEvidence) {
      s += `  • ${h.name}: ${h.logged_14d} days logged\n`;
    }
    s += '\n';
  }

  return s;
}

export function buildSystemPrompt({ agentInstructions, unattended, agentKey } = {}) {
  let prompt = SYSTEM_PROMPT_BASE;

  const settings = settingsSql.get.get();
  if (settings?.language === 'es') {
    prompt += `\n\n## Language\n\nThe user's language is Spanish. ALWAYS reply in natural Spanish (español), regardless of the language these instructions are written in — every check-in, question, summary, and confirmation in Spanish.`;
  }
  if (settings?.personality && settings.personality.trim()) {
    prompt += `\n\n## Personality and communication style\n\nThe user has explicitly asked you to adopt these style/persona instructions in every reply. Take them seriously and weave them into your tone:\n\n${settings.personality.trim()}`;
  }

  prompt += '\n\n' + COACH_INSTRUCTIONS;
  if (!getOnboardingStatus().complete) {
    prompt += '\n\n' + ONBOARDING_PROTOCOL;
  }
  prompt += '\n\n' + buildCoachContext();

  prompt += '\n\n' + MEMORY_INSTRUCTIONS;
  const memories = listMemories();
  if (memories.length === 0) {
    prompt += '\n\nNo saved memories yet. As you learn durable facts about the user, save them with save_memory.';
  } else {
    prompt += '\n\nCurrent memories (memory_id → text):\n';
    for (const m of memories) prompt += `  • [${m.id}] ${m.text}\n`;
  }

  if (agentKey) prompt += lessonsBlock(agentKey);

  if (agentInstructions && agentInstructions.trim()) {
    prompt += `\n\n## You are running as a specialised agent\n\nYou are operating as a specific named agent the user set up — not the general coach. Follow these agent instructions as your primary directive, within Helm's normal safety rules:\n\n${agentInstructions.trim()}`;
  }
  if (unattended) {
    prompt += `\n\n## Unattended run\n\nYou are running on a schedule with NO user present to answer questions or approve actions. Do useful, SAFE, reversible work autonomously with your tools. For anything irreversible or outward-facing — sending an email or message, deleting data, spending or moving money, posting publicly — DO NOT do it; instead prepare it and clearly flag it in your report for the user to approve later. Never ask the user a question (no one will answer). End with a short, plain-language summary of what you did and anything that needs them.`;
  }
  return prompt;
}

// Hard caps on attachments: Anthropic's per-request limit is ~32 MB, and
// base64 inflates ~33%. We enforce a generous-but-safe envelope here so a
// bad client can't blow up the API call.
const MAX_TOTAL_CONTENT_BYTES = 28 * 1024 * 1024; // 28 MB raw JSON

function approxByteLen(obj) {
  // Cheap byte count via JSON.stringify length. Good enough for our cap.
  return JSON.stringify(obj).length;
}

// ---------- API backend: explicit turn loop with local tool execution ----------

async function runApiTurnLoop({ id, send, systemPrompt, workingMessages, model, tools, simplifiedTools = false }) {
  assertProfileSupportsRequest(ACTIVE_PROFILE, { messages: workingMessages, tools, model });
  // Safety cap so a runaway tool loop can't grind forever.
  for (let turn = 0; turn < 12; turn++) {
    const accumulator = createNormalizedAccumulator();
    const stream = streamProfileMessages(ACTIVE_PROFILE, { model, system: systemPrompt, messages: workingMessages, tools });
    for await (const evt of stream) {
      accumulator.onEvent(evt);
      if (evt.type === 'tool_start') send(evt);
      else if (evt.type === 'text_delta') send(evt);
      else if (evt.type === 'provider_error') throw evt.error || new Error('provider stream failed');
    }
    const assistantMsg = accumulator.finalize();
    const storedContent = assistantMsg.content.map((block) => block.type === 'tool_call'
      ? { type: 'tool_use', id: block.id, name: block.name, input: block.input }
      : block);
    const toolUses = assistantMsg.content.filter((b) => b.type === 'tool_call');
    if (toolUses.length === 0) {
      sql.insertMessage.run(id, 'assistant', JSON.stringify(storedContent));
      send({ type: 'done', stop_reason: assistantMsg.stopReason, usage: assistantMsg.usage });
      return;
    }
    sql.insertMessage.run(id, 'assistant', JSON.stringify(storedContent));
    workingMessages.push({ role: 'assistant', content: storedContent });

    const toolResults = [];
    for (const tu of toolUses) {
      send({ type: 'tool_input', id: tu.id, name: tu.name, input: tu.input });
      let result;
      try {
        const raw = await runTool(tu.name, tu.input, { simplified: simplifiedTools });
        const text = raw?.content?.[0]?.text ?? JSON.stringify(raw ?? {});
        result = { type: 'tool_result', tool_use_id: tu.id, content: text };
        send({ type: 'tool_result', id: tu.id, ok: true });
      } catch (err) {
        result = { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'tool_failed' };
        send({ type: 'tool_result', id: tu.id, ok: false });
      }
      toolResults.push(result);
    }
    sql.insertMessage.run(id, 'user', JSON.stringify(toolResults));
    workingMessages.push({ role: 'user', content: toolResults });
  }
  throw new Error('provider tool loop exceeded 12 turns');
}

// ---------- SDK backend: single query() handles the entire loop ----------

export async function runSdkTurn({
  id,
  send,
  systemPrompt,
  workingMessages,
  model,
  simplifiedTools = false,
  profileStream = streamProfileMessages,
}) {
  const requestedTools = simplifiedTools ? filterSimplifiedChatTools(getAnthropicTools()) : getAnthropicTools();
  assertProfileSupportsRequest(ACTIVE_PROFILE, { messages: workingMessages, tools: requestedTools, model });
  // The SDK still executes tools internally; Coach consumes the same
  // normalized stream contract used by client-executed API profiles.
  const accumulator = createNormalizedAccumulator({ requireToolResults: true });
  const stream = profileStream(ACTIVE_PROFILE, { model, system: systemPrompt, messages: workingMessages, simplifiedTools });
  for await (const evt of stream) {
    accumulator.onEvent(evt);
    if (evt.type === 'tool_start') send(evt);
    else if (evt.type === 'text_delta') send(evt);
    else if (evt.type === 'tool_end') {
      const tool = accumulator.snapshot().content.find((block) => block.type === 'tool_call' && block.id === evt.id);
      if (tool) send({ type: 'tool_input', id: tool.id, name: tool.name, input: tool.input });
    } else if (evt.type === 'tool_result') {
      send(evt);
    } else if (evt.type === 'provider_error') throw evt.error || new Error('provider stream failed');
  }
  const assistant = accumulator.finalize();
  const storedContent = assistant.content.map((block) => block.type === 'tool_call'
    ? { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    : block);
  sql.insertMessage.run(id, 'assistant', JSON.stringify(storedContent));
  send({ type: 'done', stop_reason: assistant.stopReason || 'end_turn', usage: assistant.usage });
}

// ---------- shared coach turn for non-web channels ----------
//
// Run one full coach turn against an existing conversation and return the
// assistant's final text (no SSE). Reuses the exact same system prompt, tools,
// memory and backend as the web chat — so Telegram / CLI / etc. get the real
// coach, not a reduced copy. Used by lib/channels.js.
export async function runCoachTurnCollectText({ conversationId, agentInstructions, agentKey = 'coach', model } = {}) {
  assertAiEnabled();
  const history = sql.listMessages.all(conversationId).map((r) => ({
    role: r.role,
    content: JSON.parse(r.content),
  }));
  const systemPrompt = buildSystemPrompt({ agentInstructions, agentKey });
  const settings = settingsSql.get.get() || {};
  const resolved = resolveModelForProfile(model || settings.default_model || null, ACTIVE_PROFILE);
  if (resolved.fallback) {
    console.warn(`[chat] stored model unavailable on selected profile — using ${resolved.model}`);
  }
  const chosenModel = resolved.model || undefined;

  let text = '';
  const send = (evt) => { if (evt && evt.type === 'text_delta') text += evt.text || ''; };
  const workingMessages = [...history];

  const simplifiedTools = agentKey === 'coach' && !agentInstructions;
  if (ACTIVE_PROFILE.toolExecution === 'provider') {
    await runSdkTurn({ id: conversationId, send, systemPrompt, workingMessages, model: chosenModel, simplifiedTools });
  } else {
    const tools = simplifiedTools ? filterSimplifiedChatTools(getAnthropicTools()) : getAnthropicTools();
    await runApiTurnLoop({ id: conversationId, send, systemPrompt, workingMessages, model: chosenModel, tools, simplifiedTools });
  }
  // Self-improvement: cadenced reflection on the coach's own turns.
  maybeReflectConversation({ conversationId, agentKey, role: 'coach', instructions: agentInstructions }).catch(() => {});
  return text.trim();
}

router.post('/conversations/:id/messages', async (req, res, next) => {
  try {
    if (ACTIVE_AI_MODE === 'no_ai') {
      throw errors.conflict('Helm is running without AI. Enable a provider in AI settings before sending a Coach message.');
    }
    const id = intParam(req.params.id, 'id');
    const conv = sql.getConv.get(id);
    if (!conv) throw errors.notFound('conversation not found');
    rejectUnknownKeys(req.body || {}, ['content']);

    // Accept either a plain string (legacy) or an array of content blocks
    // (text + image + document). Validate the array shape so the DB never
    // stores junk that would later blow up the Anthropic call.
    let userContent;
    if (typeof req.body?.content === 'string') {
      const text = req.body.content.trim();
      if (!text) throw errors.validation('content required');
      userContent = [{ type: 'text', text }];
    } else if (Array.isArray(req.body?.content)) {
      userContent = req.body.content.map((b, i) => {
        if (!b || typeof b !== 'object') throw errors.validation(`content[${i}] must be an object`);
        if (b.type === 'text') {
          if (typeof b.text !== 'string') throw errors.validation(`content[${i}].text must be a string`);
          return { type: 'text', text: b.text };
        }
        if (b.type === 'image') {
          const s = b.source || {};
          if (s.type !== 'base64') throw errors.validation(`content[${i}].source.type must be "base64"`);
          if (!s.media_type || !s.data) throw errors.validation(`content[${i}] needs source.media_type + source.data`);
          return { type: 'image', source: { type: 'base64', media_type: s.media_type, data: s.data } };
        }
        if (b.type === 'document') {
          const s = b.source || {};
          if (s.type !== 'base64') throw errors.validation(`content[${i}].source.type must be "base64"`);
          if (!s.media_type || !s.data) throw errors.validation(`content[${i}] needs source.media_type + source.data`);
          return { type: 'document', source: { type: 'base64', media_type: s.media_type, data: s.data } };
        }
        throw errors.validation(`unsupported content block type "${b.type}"`);
      });
      const hasText = userContent.some((b) => b.type === 'text' && b.text.trim());
      const hasAttach = userContent.some((b) => b.type !== 'text');
      if (!hasText && !hasAttach) throw errors.validation('content must include at least one non-empty block');
    } else {
      throw errors.validation('content must be a string or an array of content blocks');
    }

    if (approxByteLen(userContent) > MAX_TOTAL_CONTENT_BYTES) {
      throw errors.validation(`message too large (>${MAX_TOTAL_CONTENT_BYTES} bytes). Shrink images or split attachments.`);
    }

    try {
      assertProfileSupportsRequest(ACTIVE_PROFILE, {
        messages: [{ role: 'user', content: userContent }],
      });
    } catch {
      throw errors.validation('The selected AI profile does not support this attachment type.');
    }

    // Block early — for BOTH backends — when the backend cannot actually
    // serve a turn, with the same actionable setup guidance /status carries.
    // This is what keeps an unconfigured server from ever spawning the SDK
    // or dialing the provider.
    const auth = await backendStatus.getStatus();
    if (!auth.configured) {
      throw errors.unavailable(`${auth.summary} ${auth.setup}`.trim());
    }

    // Append the user message to the DB.
    sql.insertMessage.run(id, 'user', JSON.stringify(userContent));

    // Load history for the API call.
    const history = sql.listMessages.all(id).map((r) => ({
      role: r.role,
      content: JSON.parse(r.content),
    }));

    // Switch to SSE.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const workingMessages = [...history];

    // Build the system prompt fresh per request so memory + personality
    // edits show up immediately. Static base + tools are still
    // prompt-cached; only the small dynamic suffix changes.
    const agentRow = conv.agent_id ? sql.agentInstructions.get(conv.agent_id) : null;
    const agentKey = conv.agent_id ? `agent:${conv.agent_id}` : 'coach';
    const simplifiedTools = !agentRow;
    const tools = simplifiedTools ? filterSimplifiedChatTools(getAnthropicTools()) : getAnthropicTools();
    const systemPrompt = buildSystemPrompt({ agentInstructions: agentRow?.instructions, agentKey });

    // Pick the model: per-conversation > global default > env fallback —
    // then resolve against the active backend. A stale/incompatible stored
    // model runs on the documented deterministic fallback (lib/coach-models.js)
    // instead of silently failing at the provider.
    const settings = settingsSql.get.get() || {};
    const resolved = resolveModelForProfile(conv.model || settings.default_model || null, ACTIVE_PROFILE);
    if (resolved.fallback) {
      console.warn(`[chat] stored model unavailable on selected profile — using ${resolved.model}`);
    }
    const model = resolved.model || undefined;

    try {
      if (ACTIVE_PROFILE.toolExecution === 'provider') {
        // SDK runs the agent loop (including all tool calls) internally
        // in one query() call. We just consume its stream and stitch all
        // emitted text + tool_use blocks across however many internal
        // turns happened into one final assistant message for the DB.
        await runSdkTurn({ id, send, systemPrompt, workingMessages, model, simplifiedTools });
      } else {
        await runApiTurnLoop({ id, send, systemPrompt, workingMessages, model, tools, simplifiedTools });
      }
      // Best-effort auto-title for first turn.
      if (!conv.title) {
        autoTitle(id).catch(() => {});
      }
      // Self-improvement: cadenced reflection on this coach/agent turn.
      maybeReflectConversation({ conversationId: id, agentKey, role: conv.agent_id ? 'agent' : 'coach', instructions: agentRow?.instructions }).catch(() => {});
    } catch (err) {
      send(safeErrorEvent(err));
    } finally {
      res.end();
    }
  } catch (e) { next(e); }
});

async function autoTitle(convId) {
  const rows = sql.listMessages.all(convId);
  if (!rows.length) return;
  // Take the first user message as input.
  let firstUser = null;
  for (const r of rows) {
    if (r.role !== 'user') continue;
    const blocks = JSON.parse(r.content);
    const text = blocks.find((b) => b.type === 'text')?.text;
    if (text) { firstUser = text; break; }
  }
  if (!firstUser) return;
  const title = await generateTitle({
    prompt: `Give a 3–6 word title for this conversation. Only output the title, no quotes, no punctuation. Conversation opener: "${firstUser.slice(0, 200)}"`,
  });
  if (title) sql.setConvTitle.run(title, convId);
}

export default router;
