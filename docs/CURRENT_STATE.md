# CURRENT_STATE.md — AstroSentinel

> Last updated: 2026-08-06

## Development Status

**Active development / pre-production.**
Core data pipeline, backend infrastructure, and primary dashboard are functional.
Collaboration features have backend routing wired but minimal frontend integration.

---

## Completed Features ✅

| Feature | Location |
|---|---|
| GCN Kafka consumer (Python FastAPI + asyncio) | `backend/app/gcn/` |
| Scientific alert filter with per-source quality gates | `artifacts/api-server/src/lib/alertFilter.ts` |
| Node.js Express + WebSocket API server | `artifacts/api-server/src/index.ts` |
| PostgreSQL schema (8 namespaces, 26 tables) | `lib/db/src/schema/` |
| Drizzle ORM migrations | `lib/db/migrations/` |
| Bootstrap seeding with historical event replay | `artifacts/api-server/src/lib/bootstrap.ts` |
| React dashboard with live event feed | `artifacts/astro-sentinel/src/pages/dashboard.tsx` |
| Science mode panel with tier/lifecycle badges | `artifacts/astro-sentinel/src/components/SciencePanel.tsx` |
| JWT authentication | `artifacts/api-server/src/middlewares/auth.ts` |
| Google OAuth login | `artifacts/api-server/src/routes/auth.ts` |
| ORCID OAuth login | `artifacts/api-server/src/routes/auth.ts` |
| Multi-tenant lab/team system (backend) | `artifacts/api-server/src/routes/team.ts` |
| Event bookmarks (backend) | `artifacts/api-server/src/routes/bookmarks.ts` |
| Event discussion threads (backend) | `artifacts/api-server/src/routes/discussions.ts` |
| Filter report endpoint | `artifacts/api-server/src/routes/filterReport.ts` |
| Docker Compose single-command setup | `docker-compose.yml` + 4 root Dockerfiles |
| GitHub push secret scanning fix (`.env` untracked) | `.gitignore` |
| **Phase 5.1: Email notification infrastructure** | `src/notifications/` (6 modules) |
| **Phase 5.2: Scientific Priority Classification Engine** | `src/science/priorityEngine/` (5 modules) |
| **Phase 5.3: Scientific Email Template System** | `src/notifications/templates/` (4 modules) |
| **Phase 5.4: Multi-Messenger Correlation Engine** | `src/science/correlationEngine/` (6 modules) |
| **Phase 5.5: Intelligent Notification Deduplication** | `src/notifications/deduplicationEngine/` (5 modules) |
| **Phase 5.6: AI Scientific Summary Generation** | `src/science/summaryEngine/` (2 modules) |
| **Phase 5.6: Correlation-Aware Scientific Notifications** | `src/notifications/templates/eventTemplate.ts` |

---

## Incomplete / Stub Features ⚠️

| Feature | Status | Location |
|---|---|---|
| Sun/Moon angular distance | Hardcoded `90°` — needs `astropy` integration | `alertFilter.ts` or normalizer |
| External links (GCN, ALADIN, ESASky, TNS) | Non-functional UI stubs | Frontend components |
| Telescope follow-up request UI | Backend schema complete, no frontend | `routes/team.ts` schema |
| Event localization FITS map viewer | Schema complete, no UI | — |
| pgvector semantic similarity search | Schema defined, no population logic | `core.event_embeddings` |
| `byObservatory` in `/events/stats` | Always returns `[]` | `routes/events.ts` |
| `event_updated` WebSocket handling | Frontend doesn't process revision updates | `useAstroWebSocket.ts` |
| `NU` (neutrino) count in stats | Not included in `byType` response | `routes/events.ts` |

---

## Known Bugs 🐛

| Bug | Severity | Location |
|---|---|---|
| `byObservatory` always `[]` | Medium | `artifacts/api-server/src/routes/events.ts` |
| ~~`sun_distance` / `moon_distance` hardcoded to `90°`~~ — **misdiagnosis.** Astropy calc existed but (a) used mismatched ICRS/GCRS frames, wrong by up to ~150°, and (b) fell back to a fabricated `90.0`. Both fixed; all 304 rows recomputed. | Fixed 2026-08-14 | `backend/app/gcn/normalizer.py` |
| `_safe_float(..., 0.0)` coerces missing **source** measurements (snr, errorRadius) to `0.0` | Medium | `backend/app/gcn/normalizer.py` |
| `eventIngestion.ts` generates **random** sun/moon distances (`randomBetween(30,150)`) | Low (dead stub) | `artifacts/api-server/src/lib/eventIngestion.ts` |
| `kafka_connected` in heartbeat always `true` even when disconnected | Low | Python WS manager |
| `eventIngestion.ts` is a no-op stub but still imported | Low | `artifacts/api-server/src/lib/eventIngestion.ts` |
| Both `bcrypt` and `bcryptjs` installed (only `bcryptjs` used) | Low | `artifacts/api-server/package.json` |
| `NU` events not counted in stats `byType` | Low | `routes/events.ts` |
| ~~`eventCorrelations` missing from `@workspace/db` barrel export, breaking API server Docker build~~ | Fixed 2026-08-09 | `lib/db/src/schema/index.ts` |
| ~~`/team/invitations` routes missing entirely, "Send Invite" always failed with Network error~~ | Fixed 2026-08-13 | `artifacts/api-server/src/routes/team.ts` |
| ~~`tenant.event_bookmarks` table missing from DB (migration 0002 never applied) — bookmarking silently no-opped~~ | Fixed 2026-08-14 | `lib/db/migrations/0002_event_bookmarks.sql` |
| ~~Event Archive grid didn't scroll (missing `min-h-0` on flex child)~~ | Fixed 2026-08-14 | `artifacts/astro-sentinel/src/pages/events.tsx` |

---

## Recent Changes (2026-08-06)

- **Phase 5.6 — Correlation-Aware Scientific Notifications:**
  - Integrated Multi-Messenger Correlation Engine with the notification pipeline in `eventTemplate.ts`.
  - Added candidate events listing to the correlation block for better scientific context.
  - Implemented logic to completely suppress the correlation section when confidence is "NONE", avoiding clutter in emails without valid correlations.
- **Phase 5.6 — AI Scientific Summary Generation:**
  - Added `ai_scientific_summaries` caching table linked by event ID and payload hash
  - Added strict JSON-only output prompt engine with zero-hallucination constraint
  - Engine automatically uses `gemini-2.5-flash` with a 15-second timeout via the new provider abstraction
  - Wired into `notificationService.ts` before email build step
  - If generation fails or times out, safely falls back to rendering raw data in the email
- **Phase 5.5 — Intelligent Notification Deduplication Engine:**
  - Added `alerts.notification_history` audit table for per-event GCN revision tracking
  - Engine parses `DEDUP_SCORE_DELTA`, `DEDUP_LOCALIZATION_PCT`, and `DEDUP_SEND_ON_CONFIRMED`
  - `changeDetector.ts` cleanly identifies meaningful state upgrades across revisions
  - Supresses generic INITIAL/UPDATE GCN traffic; always fires on Priority increases, Correlation upgrades, or Localization leaps
  - Wired into `notificationService.ts` as an explicit gate between correlation and email generation
- **Phase 5.4 — Multi-Messenger Correlation Engine:**
  - `science/correlationEngine/types.ts` — All types (CorrelationInput, CorrelationResult, CorrelationMatch, CorrelationEvent, CorrelationConfidence) matching `docs/correlation.txt` I/O schema
  - `science/correlationEngine/windows.ts` — All configurable temporal/spatial thresholds with astrophysical justification (GW170817/GRB 170817A cited)
  - `science/correlationEngine/pairingRules.ts` — 6 physically motivated event type pairings (GW+GRB=40, GW+NU=30, GW+FRB=20, GRB+NU=25, GRB+FRB=10, NU+FRB=8)
  - `science/correlationEngine/scorer.ts` — Haversine angular separation, temporal score (linear falloff to window edge), spatial score, pairing rule lookup
  - `science/correlationEngine/engine.ts` — Orchestrator: scores all candidates, picks best temporal match, maps score → HIGH/MEDIUM/LOW/NONE, generates narratives
  - `science/correlationEngine/index.ts` — Public re-exports
  - `notifications/notificationService.ts` — `fetchCandidateEvents()` DB helper + `correlate()` call wired between priority gate and email build
  - `notifications/notificationTemplates.ts` — `correlationResult` field added to `TemplateInput`
  - `notifications/templates/eventTemplate.ts` — `correlationSection()` replaces static placeholder; follow-up section uses real recommendation when confidence ≠ NONE
  - `.env.example` — 11 new `CORR_*` env vars with justification comments
- **Phase 5.3 — Scientific Email Template System:** 7-section responsive email (dark mode, Outlook, mobile, print)
- **Phase 5.2 — Scientific Priority Engine:** P0-P3 scoring (11 rules, all thresholds configurable)
- **Phase 5.1 — Email Notification Infrastructure:** SMTP/Resend/SendGrid, 3-retry queue, audit log

---

## Priorities (Next Tasks)

1. Configure email provider in `.env` (`EMAIL_PROVIDER=smtp|resend|sendgrid`) and test a live email
2. Fix `byObservatory` in `/events/stats` (always returns `[]`)
3. Fix `event_updated` WebSocket handling in `useAstroWebSocket.ts`
4. Remove `eventIngestion.ts` dead code (no-op simulator)
5. Write unit tests for `src/science/priorityEngine/` scoring rules (11 pure functions)
6. Write unit tests for `src/science/correlationEngine/` (scorer, engine, pairingRules)
7. Write unit tests for `src/notifications/deduplicationEngine/` (changeDetector, engine)
8. Wire telescope follow-up request UI
9. Add `lab_id` index on `core.events` (missing, high performance impact)
