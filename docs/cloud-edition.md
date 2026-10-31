# Nodara Cloud (optional, future)

Nodara is fundamentally an open-source, self-hosted project. This document records how an optional officially hosted edition could work **without compromising the self-hosted product**. None of the hosting, billing or subscription parts are built — they are explicitly future projects.

## Proposal

**$4.99 CAD / month — Family plan**

- Up to 5 users
- A hosted Nodara instance — no server administration
- Automatic updates, managed database and backups, secure access
- Full location history and **all** core features

The subscription pays for hosting, infrastructure, maintenance and convenience — never for access to features or to your own location history.

## Principles (non-negotiable)

1. Self-hosted users are never second-class. No feature is withheld from self-hosted deployments.
2. A subscription is never required to access location history.
3. Users can always export their data (already available: **Settings → Your data**).
4. Hosted users have a documented migration path to self-hosting ([backup-restore.md](backup-restore.md#moving-to-a-new-server-or-from-nodara-cloud-to-self-hosting)).
5. Pricing and subscription management stay **outside** the core location-sharing code.

## Architecture

**Same application, two deployment models.** The hosted edition runs the exact same image, APIs and features as self-hosted.

Recommended tenancy model: **one isolated Nodara instance per family** (own database or own schema + own container), orchestrated by a separate control plane.

```
                ┌─────────────────────────── control plane (separate, closed or open) ───────────┐
 signup/billing │  accounts · subscriptions · payments · provisioning · backups · upgrades       │
                └──────────────┬───────────────────────────────────────────────┬─────────────────┘
                               │ provisions / upgrades / backs up              │
                    ┌──────────▼──────────┐                         ┌──────────▼──────────┐
                    │ nodara (family A)   │   … one per family …    │ nodara (family B)   │
                    │ same image as OSS   │                         │ same image as OSS   │
                    └──────────┬──────────┘                         └──────────┬──────────┘
                         Postgres/PostGIS (db/schema A)                Postgres/PostGIS (db/schema B)
```

Why instance-per-tenant rather than adding a `tenant_id` column everywhere:

- **Strongest isolation** for very sensitive data: a bug in one tenant's authorization can't leak another family's locations.
- **Zero cloud-specific code in the core.** Everything the control plane needs already exists as configuration: `PUBLIC_URL`, `REGISTRATION_POLICY=closed` + `create-admin` CLI for provisioning, `DATABASE_URL`, `DEFAULT_RETENTION_DAYS`, health/version endpoints, per-instance backups.
- Migration to self-hosting is just "hand over the database dump".
- A family instance is small (one Node process ≈ 100 MB RAM), so density is reasonable; Postgres can be shared across tenants with one database per tenant.

Things already designed with hosting in mind:

- Stateless app process (all state in Postgres) → easy restarts, upgrades and horizontal moves.
- Migrations are automatic, transactional and lock-protected.
- The realtime hub is behind a small interface so it can move to Postgres `LISTEN/NOTIFY` if an instance ever needs several processes.
- Seat limits (5 users) can be enforced by the control plane via `REGISTRATION_POLICY` and the admin API, without code in the core.

## Out of scope for now

Payment integration, subscription portal, multi-tenant control plane, metered billing, hosted email delivery, status page. These belong to a separate repository/service when (and if) they are built.
