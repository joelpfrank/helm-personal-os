# Security Policy

## Supported versions

Security fixes are provided for the latest release on the default branch. Early releases may change quickly; update to the newest patched version before reporting a problem that may already be fixed.

## Report a vulnerability privately

Do not open a public issue or discussion for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for this repository: open the repository's **Security** tab, choose **Advisories**, then **Report a vulnerability**.

If the private reporting form is unavailable, do not publish vulnerability details. Ask the maintainer through a public issue to enable private vulnerability reporting, without including technical details, credentials, logs, screenshots, or personal data; then submit the report only through the private form.

Include, when safe:

- affected version or commit;
- impact and affected component;
- minimal reproduction using synthetic data;
- whether the issue is already being exploited; and
- any suggested mitigation.

Maintainers will acknowledge a report as soon as practical, investigate it privately, coordinate a fix and disclosure timeline, and credit the reporter if requested. Please do not test against systems or data you do not own or have explicit permission to use.

## Scope and operator responsibilities

Helm is initially a local, self-hosted, single-user application. Operators are responsible for host security, filesystem permissions, backups, network exposure, reverse proxies, provider credentials, and timely dependency updates. Never expose Helm directly to an untrusted network without appropriate authentication and transport security.

## Maintainer release checks

`npm run check` is the canonical local gate. It includes tests, a production
build, public-source privacy checks, deterministic archive inspection, an
independent candidate-tree secret detector, and the production dependency
audit. Before publishing or tagging, maintainers also run
`npm run security:gitleaks` and `npm run security:scan-history` against the
complete fresh public Git history. Gitleaks can be installed on macOS with
`brew install gitleaks`. Findings are investigated individually; test fixtures
must not be handled with broad detector exclusions.
