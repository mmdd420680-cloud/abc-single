# NOVARA COMMERCE — Backup, Recovery & Data Protection Runbook

## 1. Recovery Objectives (RPO / RTO)

| Tier | Backup Mechanism | RPO Target | RTO Target |
|------|------------------|------------|------------|
| **Production Managed (MongoDB Atlas Continuous Backup)** | Continuous oplog streaming + hourly/daily snapshots | `<= 15 minutes` (PITR) | `<= 30 minutes` |
| **Application-Level Portable Archive (`npm run db:backup`)** | Gzipped per-collection JSON exports + SHA-256 `manifest.json` | `<= 24 hours` (scheduled daily cron) | `<= 30 minutes` |

---

## 2. Production Managed Strategy (MongoDB Atlas)

1. Enable **Cloud Backup** with **Point-in-Time Recovery (PITR)** on the production MongoDB Atlas M10+ cluster.
2. Set snapshot retention policy:
   - Hourly snapshots retained for 48 hours
   - Daily snapshots retained for 14 days
   - Weekly snapshots retained for 8 weeks
3. Store backups in encrypted Atlas storage (`AES-256` at rest, `TLS 1.2+` in transit).

---

## 3. Application-Level Backup & Checksum Verification

Run an on-demand backup (requires `MONGODB_URI` configured in `.env` or environment):

```bash
npm run db:backup
```

This creates `backups/backup-<timestamp>/` containing:
- `<collection>.json.gz` for every non-system collection
- `manifest.json` containing collection names, document counts, compressed byte sizes, and SHA-256 checksums
- Automatic retention pruning keeping the 7 most recent backup snapshots

### Verify Backup Integrity (Offline, No DB Required)

```bash
npm run db:backup -- --verify --dir backups/backup-YYYY-MM-DDTHH-MM-SS-SSSZ
```

### Dry-Run Restore Verification

```bash
npm run db:backup -- --restore --dry-run --dir backups/backup-YYYY-MM-DDTHH-MM-SS-SSSZ
```

### Full Restore to Target Cluster

```bash
npm run db:backup -- --restore --drop --dir backups/backup-YYYY-MM-DDTHH-MM-SS-SSSZ
```

> **Note:** Always verify checksums before restoring, and test restores into a staging database before replacing production collections.

---

## 4. Sensitive Data & Encryption Controls

- **Passwords**: Salted `bcryptjs` hashes (`bcrypt` cost factor >= 10); never exposed in API projections (`-passwordHash`).
- **Tokens & Secrets**: Signed HTTP-only cookies + `JWT_SECRET` / `JWT_REFRESH_SECRET` environment configuration; OAuth tokens never logged.
- **Transport**: Helmet security headers, HSTS in production, TLS on Atlas connections.
- **CSV Exports**: Spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) neutralized via `escapeCsvCell`.
