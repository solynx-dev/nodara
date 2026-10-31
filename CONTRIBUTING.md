# Contributing to Nodara

Thanks for wanting to help! A quick but important note first:

> **Nodara was created mainly with AI, and its maintainer is not a professional developer.** Reviews from experienced engineers — especially on security, privacy, accessibility and performance — are the most valuable contributions you can make. If something looks wrong, it probably is: please open an issue.

## Ground rules

- **Privacy first.** No analytics, trackers, ads, or new mandatory third-party services. Anything that sends data off the server must be optional, off by default, and documented.
- **Self-hosted is the product.** No features gated to a hosted edition; nothing that compromises running on a small home server.
- **Honesty in the UI.** Never present stale or estimated data as live or exact. Don't claim capabilities the platform can't deliver (e.g. background tracking in browsers, crash detection).
- **No decorative UI.** Every button must do something real.

## Getting started

See [docs/development.md](docs/development.md). In short:

```bash
pnpm install
pnpm --filter @nodara/server dev
pnpm --filter @nodara/web dev
pnpm test
```

## Pull requests

1. Open an issue first for larger changes so we can agree on the approach.
2. Keep PRs focused. Include tests for server behaviour (especially anything touching authorization — add a case to `apps/server/test/circles.test.ts`).
3. Run `pnpm typecheck && pnpm test` (and `pnpm test:e2e` for UI flows) before pushing.
4. Database changes go in a **new** numbered SQL file in `apps/server/src/db/migrations`; never edit an applied migration.
5. Match the existing code style: TypeScript strict, small modules, comments that explain *why*.
6. UI: test light and dark themes, phone and desktop widths, and keyboard navigation.

## Reporting bugs

Include your deployment method, browser/OS, what you expected and what happened, and server logs if relevant. **Security issues: see [SECURITY.md](SECURITY.md) — please report privately.**

## License

By contributing you agree that your contributions are licensed under the AGPL-3.0, the same license as the project.
