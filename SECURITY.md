# Security policy

> [!IMPORTANT]
> Nodara was **built mainly with AI** by a maintainer who is **not a professional developer**, and it has **not** been independently audited. It handles real-time location data about real people. Please deploy it carefully and help us find problems.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **Security → Report a vulnerability** (private advisory) on this repository. Include steps to reproduce, the affected version/commit, and the impact you expect. We aim to acknowledge reports within 7 days and will credit you in the advisory unless you prefer otherwise.

Especially valuable: authorization bypasses (seeing another circle's data), authentication/session flaws, injection, token leakage, and anything that reveals location data to people who shouldn't see it.

## Supported versions

Nodara is pre-1.0. Only the latest `main` receives fixes. Update regularly (`git pull && docker compose up -d --build`).

## Hardening checklist for operators

- Serve Nodara **only over HTTPS** and set `PUBLIC_URL` to the HTTPS URL (enables Secure cookies and HSTS).
- Set a long random `SESSION_SECRET` and `POSTGRES_PASSWORD`; never commit `.env`.
- Keep the database private (the provided Compose file doesn't publish it).
- Use `REGISTRATION_POLICY=invite` or `closed`; set `SETUP_TOKEN` if the server is reachable before you finish setup.
- Set `TRUST_PROXY=true` only when behind a reverse proxy you control.
- Enable two-step verification or passkeys for administrators.
- Back up regularly and **encrypt backups** — they contain everyone's location history.
- Review **Administration → Audit log** occasionally.

The full threat model is in [docs/security.md](docs/security.md).
