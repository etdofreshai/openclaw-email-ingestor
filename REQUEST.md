# openclaw-email-ingestor

Email ingester for the OpenClaw memory database. Syncs emails via IMAP and stores messages from known contacts into the PostgreSQL memory DB, with a management UI to maintain the sender filter list.

## Goals

- Connect to Gmail (or any IMAP server) and incrementally sync emails
- Filter to only store emails from known/approved senders — no newsletters, no marketing, no bots
- Provide a web-based management UI (with login) to maintain the filter list
- Store emails in the existing `messages` table in the OpenClaw memory DB
- API layer for managing rules, viewing status, and triggering manual syncs

## Stack

- **Runtime:** Node.js + TypeScript
- **IMAP:** `imapflow` library (best TS support, handles Gmail reliably)
- **Frontend:** Vite + React + TypeScript (Live Edit compatible)
- **Backend:** Express server
- **DB:** PostgreSQL — existing `messages` + `sources` tables, plus new `email_filters` table
- **Auth:** Simple session-based login for the management UI (username/password via env vars)

## Core Features

### 1. IMAP Sync Engine
- Connect via IMAP (Gmail IMAP + OAuth2 or App Password)
- Watermark-based incremental sync — track last UID processed per mailbox
- Only process emails from allowed senders (cross-reference `email_filters` table)
- Store matching emails in the `messages` table:
  - `source_id` → new "email" source entry in `sources` table
  - `sender` → from address
  - `recipient` → to address
  - `content` → subject + body (plain text preferred, strip HTML)
  - `timestamp` → email date
  - `metadata` → JSONB with subject, message-id, labels, thread-id, cc, attachments list
- Skip no-reply addresses, mailing lists, and unknown senders automatically

### 2. Email Filter Management
New table: `email_filters`
```sql
CREATE TABLE email_filters (
  id SERIAL PRIMARY KEY,
  email_pattern TEXT NOT NULL,      -- exact email or wildcard (e.g. *@company.com)
  display_name TEXT,                 -- friendly label
  action TEXT NOT NULL DEFAULT 'allow',  -- 'allow' | 'block'
  source TEXT DEFAULT 'manual',     -- 'manual' | 'auto' | 'contact'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);
```

- On startup: auto-populate allow list from existing `people` table (email addresses)
- Manual entries can be added/edited/deleted via UI
- Wildcard support: `*@domain.com` to allow entire domains
- Block rules override allow rules

### 3. Management UI
Web frontend (Vite + React) with login:

**Pages:**
- **Dashboard** — sync status, last run time, total emails ingested, recent activity feed
- **Filter List** — table of all allow/block rules; add, edit, delete entries; search
- **Email Log** — browse recently ingested emails with sender, subject, date, preview
- **Settings** — IMAP credentials, sync interval, manual sync trigger, clear watermark

**Auth:** Simple login page — `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars; JWT or session cookie

### 4. REST API
- `GET /api/status` — sync health, last run, counts
- `GET /api/filters` — list all filter rules
- `POST /api/filters` — add a new rule
- `PUT /api/filters/:id` — update a rule
- `DELETE /api/filters/:id` — delete a rule
- `POST /api/sync` — trigger manual sync
- `GET /api/emails` — paginated email log (recent ingested emails)

## Environment Variables

```env
# IMAP
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=etdofresh@gmail.com
IMAP_PASSWORD=your_app_password

# Database
DATABASE_URL=postgresql://postgres:password@host:5432/postgres

# UI Auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme

# Sync
SYNC_INTERVAL_MINUTES=15
MAILBOX=INBOX

# Backend
BACKEND_PORT=3001
```

## DB Notes

- Uses existing `messages` and `sources` tables — do not change schema
- Add `email` source to `sources` table on first run if not present
- New `email_filters` table created on startup via migration
- `people` table used as seed data for initial allow list

## Future Ideas

- Importance scoring: flag emails with keywords, replies to known contacts, etc.
- Attachment metadata storage (filename, size, type — not the file itself)
- Thread grouping in the email log view
- Gmail label sync (store labels in metadata)
- Multiple account support

## Live Edit Compatibility

- `allowedHosts: true` in vite.config.ts
- `vite`, `tsx`, `typescript` in `dependencies` (not devDependencies)
- No hardcoded port in vite.config
- Proxy rules for `/api` and `^/proxy/\d+/api`

---

## Status Endpoint

Exposes `GET /api/status` for health reporting and sync data. Used by OpenClaw directly or via an aggregator.

```json
{
  "service": "email",
  "status": "ok",
  "last_sync": "2026-02-25T03:00:00Z",
  "emails_ingested_total": 2841,
  "emails_ingested_last_30_days": 94,
  "filter_rules_count": 28,
  "allowed_senders": 22,
  "blocked_senders": 6,
  "imap_reachable": true,
  "cached_at": "2026-02-25T03:00:00Z"
}
```

Cache TTL: 5 minutes. Force refresh with `GET /api/status?refresh=true`.


---

## Email Filter Ruleset (AI-Generated)

A filter ruleset was generated by analyzing 500 emails from the INBOX. The full JSON is at `email-filter-ruleset.json` (committed alongside this file).

### Categories

| Category | Description | Priority |
|---|---|---|
| `people_i_know` | Allowlist of real humans ET has personal relationships with | 1 (highest — check first) |
| `purchases_receipts` | Order confirmations, shipping, delivery, returns | 2 |
| `travel` | Flight/hotel/cruise bookings, restaurant reservations | 3 |
| `financial_tax` | Tax forms, statements, banking, insurance, investments | 4 |
| `invoices_billing` | Subscription renewals, SaaS billing, service invoices | 5 |
| `work_dev` | GitHub, Jira, developer tools, work platforms | 6 |
| `noise` | Newsletters, marketing, promotions, ads | 7 (catch-all) |

### Filter Priority Rules

1. **`people_i_know` is checked first** — it's an explicit allowlist. If the sender is in this list, classify immediately regardless of domain.
2. Domain-based rules apply after. This matters because personal contacts (e.g. `gmail.com`) also appear as catch-all noise domains.
3. Subject keyword matching is a secondary signal — use to disambiguate when sender domain is ambiguous.
4. `noise` is the final catch-all for anything unmatched.

### Key Findings from Analysis

- **15,063 emails** in INBOX total
- **~30% purchases/receipts** — Amazon alone has 7 different sending addresses
- **`people_i_know`** — 15 known contacts including ET himself (`etdofresh@gmail.com`), family (Alex, Carmen), workout partners (Schoolmeyers), colleagues
- **Legitimate invoice detection** signal: sender from known provider + your name + dollar amount + account/order number in body
- Hard-to-classify edge cases are documented in `email-filter-ruleset.json` under `stats.hard_to_classify`

### Implementation Notes

- The `email_filters` table should support a `category` column (in addition to `allow`/`block`) to store which category a sender belongs to
- Filter matching order: exact sender address → sender domain → subject keywords → catch-all noise
- The ruleset JSON (`email-filter-ruleset.json`) should be used to seed the `email_filters` table on first run
- As new senders appear, unknown senders should be flagged for manual review rather than silently dropped
