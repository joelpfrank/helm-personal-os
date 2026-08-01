# Building Helm Personal OS with accountable AI engineering

**Verified status:** local gates passed; published as v0.

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

The gate below is the one that ships. `npm run check` is inside the release
archive, so these numbers are reproducible by whoever downloads it rather than
only in the maintainer's checkout:

- Unzipping the published archive and running `npm ci && npm run check` exits 0
  with 751 tests passing and 6 skipped. Each skip names the reason — a check
  that reads the Git index an archive has no reason to carry, or a
  maintainer-only file the export deliberately withholds — so nobody is failed
  on files they were never sent, and no skipped check reports a pass it did not
  perform.
- The maintainer checkout runs the same suite with nothing skipped: 760 tests,
  zero failures. The small difference in case count is the same withheld
  material, counted rather than assumed.
- The production dependency audit reported zero vulnerabilities.
- The production web build completed across 369 modules.
- Browser acceptance passed at desktop and compact widths, including keyboard,
  focus, reduced-motion, containment, no-AI, provider setup, and secret-readback checks.
- Privacy, history, and secret scans passed without provider login, inference,
  paid calls, or private-data access.

These are release facts, not claims about adoption, revenue, scale, or public availability.

## Lessons

### Human judgment is the control plane

AI agents accelerated implementation and review, but accountable delivery still required precise requirements, bounded authority, real-path execution, direct artifact inspection, and an exact release gate.

### Local-first needs precise language

Helm keeps its SQLite operating state on the operator's machine by default, while documenting that optional AI-backed requests send selected context to the configured external provider.

### Open-source preparation starts before GitHub

A clean README and a working-tree secret scan are not enough for a stateful private product. Fresh history, allow-listed export, synthetic evidence, package inspection, fresh-clone acceptance, and logged-out public verification form one release chain.

## Honest limitations

The initial release candidate is macOS-first, single-user, and intended for a trusted local host. Helm is not a hosted team product, medical device, or substitute for professional advice. Some retained API and MCP capabilities are not exposed in the simplified browser navigation. Public release and real-world adoption remain future evidence until publication acceptance passes.
