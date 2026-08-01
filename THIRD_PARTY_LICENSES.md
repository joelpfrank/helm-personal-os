# Third-Party License Inventory

Date: 2026-07-29
Scope: `package-lock.json` (lockfileVersion 3) at the state committed alongside
this file — 391 third-party entries across the `server`, `web`, and `mcp`
workspaces. The production inventory contains 289 entries; the complete
install inventory (production and development dependencies) contains 391.

## Methodology

1. Enumerated every non-link `node_modules/*` entry under `packages` in
   `package-lock.json` and read each entry's `license` field, which npm/the
   registry populates from the dependency's own `package.json` at publish
   time. Workspace roots and npm's workspace-link entries were excluded.
2. Counted production entries as lockfile packages not marked `dev: true`,
   then separately counted the complete install tree.
3. Flagged for manual inspection: anything not a standard OSI permissive
   identifier — i.e. copyleft (GPL/AGPL/LGPL/MPL), `UNLICENSED`/missing,
   non-commercial, or `SEE LICENSE IN ...` custom-license pointers.
4. For every flagged package, read the actual license file shipped inside
   `node_modules/<package>/` (not just the lockfile's short identifier),
   since a `SEE LICENSE IN ...` pointer is a placeholder, not the license
   itself.
5. Also spot-checked license identifiers that are unusual for JS source
   packages (font/data licenses, public-domain dedications) even though
   they aren't in the "flag" list above, since they carry their own
   attribution obligations.

## Production dependency distribution (289 entries)

| License identifier | Count |
|---|---|
| MIT | 256 |
| ISC | 11 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 2 |
| OFL-1.1 | 2 |
| BSD-2-Clause | 1 |
| (MIT OR WTFPL) | 1 |
| Unlicense | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| 0BSD | 1 |
| SEE LICENSE IN LICENSE.md / README.md (Anthropic Agent SDK) | 9 |

## Complete install distribution (391 entries)

| License identifier | Count |
|---|---|
| MIT | 350 |
| ISC | 16 |
| Apache-2.0 | 3 |
| BSD-3-Clause | 5 |
| BSD-2-Clause | 1 |
| OFL-1.1 | 2 |
| CC-BY-4.0 | 1 |
| (MIT OR WTFPL) | 1 |
| Unlicense | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| 0BSD | 1 |
| SEE LICENSE IN LICENSE.md / README.md (Anthropic Agent SDK) | 9 |

**No GPL, AGPL, LGPL, MPL, or other copyleft-licensed package appears
anywhere in the resolved dependency tree.** No package is flagged
`non-commercial`. No package's license field is genuinely missing/unknown
once the workspace roots and npm's three workspace-link entries are excluded;
those entries represent this project's own code, not third-party packages.

## Flagged entries — manual inspection evidence

### Anthropic Agent SDK — proprietary, all-rights-reserved (9 packages)

- `@anthropic-ai/claude-agent-sdk@0.3.191` (1 package)
- `@anthropic-ai/claude-agent-sdk-{darwin-arm64,darwin-x64,linux-arm64,
  linux-arm64-musl,linux-x64,linux-x64-musl,win32-arm64,win32-x64}@0.3.191`
  (8 optional platform-binary packages, one per supported OS/arch — only the
  one matching the install machine is actually fetched)

`package.json` for the main package declares `"license": "SEE LICENSE IN
README.md"`; the platform-binary packages declare `"license": "SEE LICENSE
IN LICENSE.md"`. In every case the license text actually shipped in
`node_modules/@anthropic-ai/claude-agent-sdk*/LICENSE.md` reads, verbatim:

> © Anthropic PBC. All rights reserved. Use is subject to the Legal
> Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

This is **not an open-source license** — it is a proprietary,
all-rights-reserved grant conditioned on Anthropic's own terms. The
package's `README.md` additionally discloses (lines ~54–64) that using the
SDK causes Anthropic to collect feedback/usage data (code acceptance or
rejection, associated conversation data, `/bug`-command submissions), and
points to Anthropic's [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)
and [Privacy Policy](https://www.anthropic.com/legal/privacy) for full
details.

**Conclusion:** this dependency is not open source and cannot be
represented as MIT, relicensed, or redistributed under this project's
license. It is not a blocker to licensing Helm's own source as MIT, for two
independent reasons:

- It is consumed the normal npm way — installed into `node_modules` by
  whoever runs `npm install`, under their own acceptance of Anthropic's
  terms — and is never vendored or committed into this repository's git
  history.
- `scripts/package-helm.sh` builds the portable archive from `git ls-files`
  only; `node_modules/` is listed in `.gitignore` and is therefore never a
  tracked file, so it structurally cannot end up inside `dist/Helm-portable-v0.zip`
  regardless of the archive's include patterns.

Operators and contributors who run this project must independently accept
Anthropic's Legal Agreements, Commercial Terms of Service, and Privacy
Policy to use this dependency (the AI-coaching feature routes through it by
default; see `PRIVACY.md`). This document does not assert the SDK is
open-source, compatible with MIT, or eligible for relicensing — it is
disclosed here strictly as an attribution/boundary notice.

### OFL-1.1 — SIL Open Font License (2 packages)

- `@fontsource-variable/fraunces@5.2.9`
- `@fontsource-variable/inter@5.2.8`

Permissive font license: fonts may be used, embedded, and redistributed
freely; the only restriction is that a *modified* font may not keep the
original "Reserved Font Name" without renaming. These are used unmodified.
Not a blocker; each package carries its own OFL license file inside
`node_modules/`, which travels with it wherever it's installed.

### CC-BY-4.0 (1 package, dev-only)

- `caniuse-lite` — a Browserslist/Autoprefixer data dependency pulled in
  transitively by the Vite/PostCSS build toolchain (`devDependencies` only;
  `dev: true` in the lockfile). It is browser-compatibility *data*, not
  code linked into the shipped application, and is never bundled into
  `web/dist`. Attribution requirement is satisfied by the package's own
  README, which ships with it.

### Unlicense (1 package)

- `fast-sha256` — public-domain-equivalent dedication, no restrictions.
  Pulled in transitively via `standardwebhooks` (a peer dependency of
  `@anthropic-ai/sdk`, itself MIT-licensed and not actually imported by
  Helm's own code — Helm calls the Agent SDK, not `@anthropic-ai/sdk`
  directly).

### Dual/multi-licensed packages (2 packages)

- `(MIT OR WTFPL)` and `(BSD-2-Clause OR MIT OR Apache-2.0)` — both are
  "pick any" license unions where every option is a standard OSI-permissive
  license. No action needed; MIT is available as a compatible choice in
  both cases.

## Conclusion

No dependency in the resolved tree is GPL/AGPL/LGPL/MPL-licensed, and no
dependency imposes terms that would require Helm's own source to be
relicensed or that would prevent Helm's own source from being MIT-licensed.
The one non-open-source entry (`@anthropic-ai/claude-agent-sdk` and its
platform binaries) is a proprietary, separately-licensed runtime dependency,
not vendored or redistributed by this repository, and is documented above
rather than characterized as compatible, open-source, or relicensable.

**MIT applies to Helm-authored source in this repository only.** It does
not extend to, relicense, or certify the license status of any third-party
dependency listed above or resolved by `npm install`.
