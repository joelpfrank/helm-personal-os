# Maintainers

## Canonical upstream

This public repository is the canonical upstream for Helm Personal OS product code. Product fixes, features, tests, installer changes, and documentation are developed here first. Installed instances consume reviewed commits or releases from this repository; they are not separate product forks.

Runtime data and credentials are not source code. Keep the SQLite database, WAL/SHM files, bearer tokens, password record, provider keys, OAuth credentials, logs, and backups outside the checkout and outside Git. Use `HELM_STATE_DIR` for mutable/private application state.

## Private-overlay boundary

Machine-specific deployment, network exposure, backup scheduling, and personal integrations belong in a separate mode-0700 private config directory or private repository. They must not be copied into this history. Prefer environment variables, ignored config files, and external adapters over patches to product code.

`scripts/export-public-source.sh` audits a private source tree against the public allow-list and fails closed on anything the allow-list does not name. It is an audit tool, not a second development path: do not use it to copy a private tree over this one, and do not import private Git history. Reconcile a generally useful change by reimplementing and testing it here, and keep a machine-specific change in the external overlay.

## Release procedure

1. Start from a clean `main`, fetch the remote, and review dependency/security alerts.
2. Make behavior changes test-first. Update `CHANGELOG.md`, user documentation, and upgrade notes in the same change.
3. Run `npm ci`, then the canonical local gate: `npm run check`.
4. Run `npm run convergence:verify` to exercise a disposable install and upgrade with external state.
5. Run `npm run security:gitleaks` and `npm run security:scan-history` against the exact candidate history.
6. Review the complete diff and obtain independent read-only review of the unchanged candidate. Resolve release-blocking findings and rerun every gate after the last source or test edit.
7. Push the exact candidate and require green CI and CodeQL. Create an annotated version tag only for that green commit.
8. Build the portable archive from the tagged commit, verify its SHA-256 sidecar, install that exact archive in an isolated path, and exercise `/api/health` plus the documented first-run journey.
9. Publish release notes that state upgrade steps, data-format changes, known limitations, and rollback instructions. Download the published asset and verify its checksum before announcing the release.

## Safe update strategy

Keep code and state disjoint:

- install replaceable code at the chosen `--prefix`;
- place mutable/private state in an absolute external directory via `--state-dir` / `HELM_STATE_DIR`;
- update code from a reviewed canonical release with `./install-helm.sh --prefix <install-path> --state-dir <state-path> --upgrade`.

The installer builds a complete sibling release before an atomic prefix swap. If a post-swap step fails, it restores the previous code prefix. It does not move, rewrite, or delete external state during install, upgrade, or rollback. Confirm `npm run convergence:verify` before promoting a release to an important instance.

Do not update a live instance by editing its installed files or by copying another working tree over it. Keep the previous release available until the updated service passes health and a real read-only data check.

## Live migration

Adopting external state from a legacy in-prefix installation is deliberately copy-only and requires a short controlled stop:

The npm command below invokes `scripts/migrate-state.mjs`; use the npm entry point so the documented interface stays stable.

1. Create and verify a private backup of the legacy source/state outside any public repository.
2. Stop the legacy service and confirm its process is no longer running. Do not copy an active SQLite database/WAL pair.
3. Preview without writes:
   `npm run migrate:state -- --from <legacy-root> --to <external-state-dir>`
4. Inspect the listed files and confirm the destination is new, private, absolute, outside both source and install prefixes, and has enough space.
5. Copy and verify byte-for-byte:
   `npm run migrate:state -- --from <legacy-root> --to <external-state-dir> --apply`
6. Install the canonical release at a separate prefix with that state directory and start it on the intended loopback port.
7. Verify health, authenticated read access, representative records, optional integrations, and logs before changing any surrounding private adapter.
8. Retain the stopped legacy source, original state, service definition, and backup until an explicit retention decision after acceptance.

The migrator never modifies or deletes legacy originals, refuses destination collisions, verifies every copied file by SHA-256, and refuses a source whose legacy PID file identifies a live process.

## Rollback

If migration or the new service fails acceptance:

1. Stop the new service.
2. Restore the previous service definition and code prefix.
3. Remove `HELM_STATE_DIR` from that previous service if it originally used the legacy in-prefix layout.
4. Start the previous service and verify `/api/health` and authenticated reads against the untouched original state.
5. Preserve the failed new prefix and copied external state for diagnosis; do not merge either back into the legacy originals and do not delete the verified backup.

For a normal post-migration upgrade failure, use the installer's automatically restored previous prefix with the same external state directory. Never roll back by deleting or overwriting the state directory.

## Monthly checklist

- [ ] Triage open issues and apply `needs-triage`, `bug`, `enhancement`, `security`, `dependencies`, `maintenance`, or `release` labels consistently.
- [ ] Review Dependabot, CodeQL, GitHub security advisories, and dependency release notes.
- [ ] Run `npm ci` and `npm run check` from a clean checkout.
- [ ] Run `npm run convergence:verify` and perform one disposable archive install/health check.
- [ ] Run `npm run security:gitleaks` and `npm run security:scan-history`.
- [ ] Check that documentation, roadmap, issue templates, supported Node version, and known limitations remain truthful.
- [ ] Confirm private overlays and runtime state remain external, owner-only, backed up, and absent from Git status/history.
- [ ] Review backup age and perform a non-destructive restore drill in an isolated directory.
- [ ] Close or update stale roadmap items; record completed maintenance in an issue or release note.
