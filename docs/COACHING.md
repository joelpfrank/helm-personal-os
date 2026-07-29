# Coaching design

Helm's coach is designed to connect declared direction with observable daily state. It is a planning and reflection aid, not an authority, therapist, clinician, financial adviser, or substitute for human judgment.

## Layers of context

1. **Vision:** a north-star narrative, identity statement, and values.
2. **Goals:** nested year, quarter, month, and week goals with target dates and observable success criteria.
3. **Obstacles:** predictable friction paired with concrete if/then responses.
4. **Goal links:** explicit connections from goals to tasks, habits, routines, events, workouts, food targets, and custom records.
5. **Daily evidence:** real board state, habit outcomes, food/activity summaries, workouts, scheduled events, and check-ins.
6. **Coaching profile:** operator-controlled preferences such as motivational drivers, resistance patterns, communication style, challenge level, and approaches that backfire.

These layers are persisted as structured records. A model may summarize or reason over them, but it is not the source of truth for whether a task, habit, meal, or workout was recorded.

## Check-in cadence

Helm supports five check-in kinds:

- morning command meeting;
- midday recalibration;
- evening closeout;
- weekly review; and
- periodic vision review.

Cadence settings control whether check-ins are enabled and when they are due. A check-in stores a structured payload plus an optional coach summary. Repeating the same kind on the same date updates that day's record rather than silently creating duplicates.

## Briefing contract

The coach briefing endpoint assembles the current vision, active goals, coaching settings, today's check-in state, recent check-ins, cadence flags, and a deterministic task snapshot. The task snapshot is derived from stored cards and includes actionable state such as due, overdue, in-progress, stale, and undated work.

This design separates two responsibilities:

- deterministic code reports what is stored and what is due;
- the language model interprets that evidence, asks questions, and proposes a focus.

A fluent response is not proof that an action happened. Mutations should be represented by successful Helm tool calls and then visible in the underlying records.

## Habit outcomes

Habit tracking distinguishes:

- **Achieved** — an explicit success, or a quantity that meets the target;
- **Not achieved** — an explicit failure; and
- **Unspecified** — no judgment was recorded.

A blank scheduled day is not automatically rewritten as failure. This prevents missing data from becoming false behavioral evidence.

## Model access and capabilities

The default AI path uses the Claude Agent SDK with a local Claude Code login. The alternative API path uses an Anthropic API key. Both send request context to Anthropic.

For the visible coach, Helm provides a reduced MCP tool set and disables the SDK's local file, shell, edit, notebook, subagent, and skill tools. Web search/fetch may still be available. Saved agents can have a broader Helm tool set and operator-configured external MCP servers. Capability restriction is defense in depth, not a guarantee that model output is correct or safe.

## Safety and evidence boundaries

- The operator remains responsible for decisions and for reviewing consequential changes.
- Health and nutrition values can be estimates and should not be treated as clinical measurements.
- Progression suggestions are derived from logged training history; they do not account for injury, medical conditions, or unrecorded fatigue.
- Model summaries may omit, misunderstand, or overstate information.
- External research is time-sensitive and should be checked against primary sources where consequences matter.
- Memories and coaching-profile fields should contain only information the operator is willing to store locally and potentially include in an AI request.

## Design principle

The intended loop is:

```text
vision → goals → linked commitments → daily evidence → reflection → adjustment
```

Helm makes that loop inspectable. It does not claim that an AI model can determine a person's values, guarantee behavior change, or make professional decisions on the operator's behalf.
