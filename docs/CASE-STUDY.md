# Building Helm Personal OS with accountable AI engineering

**Verified status:** local gates passed; not published.

Helm is a macOS-first, local/self-hosted personal operating system that connects long-term direction to daily action and review. It brings goals, kanban tasks, habits, food, workouts, structured check-ins, and evidence-grounded AI coaching into one application. Compatible assistants can work with the same structured state through Model Context Protocol tools instead of relying only on conversation memory.

## Product thesis

Personal systems often split intent, execution, evidence, and reflection across unrelated tools. Helm treats them as one loop:

`intent → prioritised action → execution → evidence → review → updated intent`

Core records remain usable without an AI account. AI-backed requests are optional and cross the configured provider boundary; local-first storage is not presented as zero external processing.

## Joel's role and method

Joel created Helm and led product vision, architecture, requirements, orchestration, evaluation, testing, and delivery. AI coding agents acted as implementation and review collaborators. Human judgment remained responsible for scope, architecture, acceptance evidence, privacy boundaries, and every release decision; this is not a claim that every line was manually authored.

The delivery method used narrow milestones, test-first behavior changes, one repository writer at a time, direct inspection after agent output, and separate adversarial review lanes. An agent's summary or exit code was never treated as acceptance evidence.

## Architecture and control boundaries

- React and Vite provide the browser interface; Node.js and Express expose product APIs.
- SQLite stores local operating state for one trusted operator on one trusted host.
- Bearer-token API authentication and a first-run browser password protect the local interface.
- MCP transports expose explicit structured tools to compatible assistants.
- Claude Code subscription authentication and Anthropic API-key mode remain distinct, documented provider paths.
- Missing or expired AI credentials do not disable Tasks, Food, Habits, Workouts, or other non-AI records.
- Deterministic synthetic demo generation requires an explicit database path and refuses to overwrite an existing target.

## Privacy-safe release engineering

The public candidate was not made by publishing a private working repository. It was constructed with fresh Git history from an explicit allow-list. The release pipeline rejects private databases, backups, logs, credentials, machine paths, private deployment material, and disallowed identity markers. Portable packaging independently inspects the files that would reach a recipient.

## Measured acceptance evidence

At the accepted M10 visual-asset checkpoint:

- 520 automated tests passed.
- 268 public-safety files were scanned.
- The production dependency audit reported zero vulnerabilities.
- The preceding accepted source checkpoint passed dependency installation, the canonical check, dry-run installation, and an isolated real installation from a genuine fresh clone.
- Four independent source-review lanes passed at that checkpoint—security/privacy, code quality, open-source cold-start UX, and AI/coaching behavior—and M10 received a fresh read-only closure review after its asset-gate remediation.

These are release-candidate facts, not claims about adoption, revenue, scale, or public availability.

## Lessons

### Human judgment is the control plane

AI agents accelerated implementation and review, but accountable delivery still required precise requirements, bounded authority, real-path execution, direct artifact inspection, and an exact release gate.

### Local-first needs precise language

Helm keeps its SQLite operating state on the operator's machine by default, while documenting that optional AI-backed requests send selected context to the configured external provider.

### Open-source preparation starts before GitHub

A clean README and a working-tree secret scan are not enough for a stateful private product. Fresh history, allow-listed export, synthetic evidence, package inspection, fresh-clone acceptance, and logged-out public verification form one release chain.

## Honest limitations

The initial release candidate is macOS-first, single-user, and intended for a trusted local host. Helm is not a hosted team product, medical device, or substitute for professional advice. Some retained API and MCP capabilities are not exposed in the simplified browser navigation. Public release and real-world adoption remain future evidence until publication acceptance passes.
