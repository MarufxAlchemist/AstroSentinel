# CHANGELOG_AI.md — AstroSentinel

AI coding session log. Newest entries at top. Never rewrite previous entries.

---

## 2026-08-14 — Fix: Bookmarks not persisting + Event Archive not scrolling

### Fixed
- `lib/db/migrations/0002_event_bookmarks.sql` — Applied directly to the database. The `tenant.event_bookmarks` table did not exist at all (migration file existed in the repo but was never run against this DB), so every bookmark create/list/delete request was failing server-side. The event-detail page's optimistic UI update flipped the "Bookmarked" button regardless of request success, masking the failure.
- `artifacts/astro-sentinel/src/pages/event-detail.tsx` — `toggleBookmark()` now only flips local state when the fetch response is `ok`, so a failed bookmark request no longer lies to the user.
- `artifacts/astro-sentinel/src/pages/events.tsx` — Added `min-h-0` to the scrollable event grid container. Without it, the `flex-1 overflow-y-auto` div defaulted to `min-height: auto` and grew to fit all content instead of scrolling, so content past the first screenful was clipped by the ancestor `overflow-hidden` chain instead of being reachable via scroll.

---

## 2026-08-13 — Fix: Research Team invitations always failed with "Network error"

### Fixed
- `artifacts/api-server/src/routes/team.ts` — `GET/POST/DELETE /team/invitations` were never implemented server-side even though the frontend (`team.tsx`) called them. Requests 404'd with Express's default HTML error page, and the frontend's `res.json()` threw parsing it, surfacing as a generic "Network error". Added all three routes backed by the existing `labInvitations` table (already used by the registration accept-invite flow), including sending an actual invite email via the existing `EmailProvider` abstraction.

---

## 2026-08-09 — Fix: Docker build failure — missing `eventCorrelations` export

### Fixed
- `lib/db/src/schema/index.ts` — The Core schema re-export block imported `eventCorrelations` (and its `EventCorrelation`/`InsertEventCorrelation` types) from `./events.js` but never re-exported them from the `@workspace/db` barrel. `artifacts/api-server/src/science/correlationEngine/repository.ts` imports `eventCorrelations` from `@workspace/db`, so the API server's esbuild bundle failed with "No matching export in ../../lib/db/src/index.ts for import eventCorrelations", breaking `docker compose up --build`.

### Verified
- `pnpm --filter @workspace/api-server run build` succeeds.

---

## 2026-08-06 — Phase 5.6: AI Scientific Summary Generation

### Added
- `core.ai_scientific_summaries` table in `lib/db/src/schema/events.ts` and `0008_ai_scientific_summaries.sql` migration — caches AI generation outputs by a deterministic hash of the inputs.
- `src/science/summaryEngine/prompts.ts` — Prompts imposing a strict 200-word limit and forcing JSON schema output with 5 fields (significance, origin, followUp, characteristics, confidence).
- `src/science/summaryEngine/index.ts` — Engine that wraps the LLM call. Incorporates a fast 15-second timeout (via `GEMINI_TIMEOUT_MS`) to ensure the pipeline is never permanently blocked.

### Modified
- `src/notifications/notificationService.ts` — Invokes `generateSummary()` and passes `aiSummary` to the template input.
- `src/notifications/notificationTemplates.ts` & `eventTemplate.ts` — Added `aiSummary` to inputs. Renders the AI summary gracefully.
- `src/notifications/templates/components.ts` — Added `aiSummarySection()` to format the JSON data as nicely formatted paragraphs with an indigo border.

### Architecture Notes
- The email notification is sent even if AI generation fails, ensuring no high-priority alert is delayed by AI unreliability.
- Caching is performed by hashing the payload directly (`crypto.createHash('sha256')`), guaranteeing identical inputs aren't sent to the AI API twice.
- JSON output is validated at runtime before cache insertion to prevent bad structure from propagating.

---

## 2026-08-06 — Phase 5.5: Intelligent Notification Deduplication Engine

### Added
- `alerts.notification_history` table in `lib/db/src/schema/alerts.ts` — Append-only audit table storing every deduplication decision. Indexed by `(event_id, sent_at DESC)` for O(1) last-send lookup, and BRIN index on `sent_at` for range queries
- `src/notifications/deduplicationEngine/policy.ts` — Reads `DEDUP_SCORE_DELTA`, `DEDUP_LOCALIZATION_PCT`, `DEDUP_SEND_ON_CONFIRMED`
- `src/notifications/deduplicationEngine/changeDetector.ts` — Pure functions evaluating cross-revision state upgrades (priority increase, correlation upgrade, localization tightening)
- `src/notifications/deduplicationEngine/engine.ts` — `decide()` orchestrator. Suppresses noisy PRELIMINARY/INITIAL/UPDATE traffic unless a meaningful state jump occurs. Always sends on retraction. Emits formatted reasons for audit logs

### Modified
- `src/notifications/notificationService.ts` — Wired `decide()` as Step 5b, directly after Correlation. Calls `recordDecision()` on both send (after enqueue) and suppress (early return)
- `lib/db/src/schema/index.ts` — Exported `notificationHistory` and its types
- `lib/db/migrations/0007_notification_history.sql` — Raw SQL migration for the new table, complete with comments and BRIN index definition
- `.env.example` — Added 3 `DEDUP_*` configuration variables

### Architecture notes
- Complete audit trail: The engine explicitly records *suppressed* revisions alongside *sent* revisions. We can always query exactly why an update was swallowed.
- Total isolation: The change detector is pure math/logic; `engine.ts` handles the orchestration, `store.ts` handles DB I/O. Non-throwing DB operations ensure email dispatch is never blocked by audit log failure.

---

## 2026-08-06 — Phase 5.4: Multi-Messenger Correlation Engine

### Added
- `src/science/correlationEngine/types.ts` — All type definitions (CorrelationInput, CorrelationResult, CorrelationMatch, CorrelationEvent, CorrelationConfidence) matching `docs/correlation.txt` I/O schema exactly
- `src/science/correlationEngine/windows.ts` — Configurable temporal/spatial coincidence windows with scientific justification for every threshold (GW170817/GRB 170817A: ΔT = +1.74 s cited for GW+GRB 5 s window)
- `src/science/correlationEngine/pairingRules.ts` — 6 physically motivated event type pairings with scientific basis strings. Score: GW+GRB=40, GW+NU=30, GRB+NU=25, GW+FRB=20, GRB+FRB=10, NU+FRB=8
- `src/science/correlationEngine/scorer.ts` — Pure `scorePair()`: haversine angular separation, temporal score (linear falloff 35→0 at window edge), spatial score (25→0 at N-sigma threshold), pairing score. Returns full CorrelationMatch with reasoning string
- `src/science/correlationEngine/engine.ts` — Orchestrator: scores all candidates, filters temporally, picks best, maps score to HIGH/MEDIUM/LOW/NONE, generates scientific_assessment + followup_recommendation + reasoning narratives per event type pair
- `src/science/correlationEngine/index.ts` — Public re-exports only

### Modified
- `notifications/notificationService.ts` — Added `fetchCandidateEvents()` (non-throwing DB select within lookback window), added `correlate()` call (step 5a), passes `correlationResult` into `buildEmailContent()`
- `notifications/notificationTemplates.ts` — `correlationResult: CorrelationResult` added to `TemplateInput`. Fully rewritten to clean state
- `notifications/templates/eventTemplate.ts` — Added `CorrelationResult` import and field to `EventTemplateInput`. Added `correlationSection()` component (colour-coded by confidence level). Replaced static correlation placeholder with live data. Follow-up recommendation uses real result when confidence ≠ NONE. Plain-text builder updated in parallel
- `.env.example` — 11 new `CORR_*` vars: temporal windows (6), spatial factor (1), score boundaries (3), DB lookback (1)

### Architecture notes
- `correlationEngine/` is completely isolated from `notifications/` — no cross-dependency
- External scores hook: `CorrelationInput.correlation_scores` blends in pre-computed scores for future AI integration
- `fetchCandidateEvents()` is non-throwing — correlation failure never blocks email dispatch
- `correlationSection()` renders colour-coded card: green=HIGH, amber=MEDIUM, blue=LOW, grey=NONE
- Zero new TypeScript errors introduced

---

## 2026-08-06 — Phase 5.3: Scientific Email Template System

### Added
- `src/notifications/templates/styles.ts` — Priority colour tokens (4 levels), event type metadata, font stacks, `buildStyleBlock()` (dark mode @media, mobile @media, @media print)
- `src/notifications/templates/formatters.ts` — Pure scientific formatters: HMS/DMS sky coords, FAR as human recurrence rate, error radius with unit conversion, T90, fluence, DM, SNR, lifecycle labels
- `src/notifications/templates/components.ts` — 12 reusable HTML component functions: headerBlock, revisionBanner, priorityBadge, sectionHeading, dataRow, dataTable, placeholderSection, spacer, hrule, footerBlock
- `src/notifications/templates/eventTemplate.ts` — Main assembler: 7 named sections, MSO conditionals, full dark mode + responsive + print support, HTML + plain-text output

### Modified
- `notifications/notificationTemplates.ts` — Replaced with thin adapter (57 lines); all HTML delegated to templates/
- `notifications/notificationService.ts` — buildEmailContent now receives Phase 5.2 classification result (priorityLevel, score, reasons, recommendation) and t90

### Architecture notes
- Table-based layout for Outlook compatibility (MSO conditionals in outer wrapper)
- Inline styles on every element (Outlook Word engine)
- class= attributes on key elements for `<style>` block dark mode / responsive overrides
- `color-scheme` meta tag for iOS/macOS native dark mode signalling
- All 7 email sections assembled from component functions — zero duplicated HTML
- 3 placeholder sections (Scientific Summary, Multi-Messenger Correlation, Follow-up) ready for Phase 5.x population
- Zero new TypeScript errors introduced

---

## 2026-08-06 — Phase 5.2: Scientific Priority Classification Engine

### Added
- `src/science/priorityEngine/types.ts` — PriorityLevel (P0-P3), ScoringFactor, ClassificationResult, EventClassificationInput
- `src/science/priorityEngine/thresholds.ts` — All numeric thresholds configurable via env vars; getThresholds() factory
- `src/science/priorityEngine/scoringRules.ts` — 11 independent pure rule functions (retraction, historical, event type, lifecycle, observatory, tier, SNR, localization, revision, FAR, GRB properties)
- `src/science/priorityEngine/classifier.ts` — Aggregator: retraction veto, score sum [0-100], P0/P1/P2/P3 mapping, reasons[], recommendation string
- `src/science/priorityEngine/index.ts` — Public re-exports; all rules individually exported for unit testing

### Modified
- `notifications/priorityEngine.ts` — Replaced with thin compatibility shim (NotificationPriority type + P0→CRITICAL mapper)
- `notifications/notificationService.ts` — Now calls classify() from science engine; P0/P1 → email, P2/P3 → skip; full classification result logged
- `.env.example` — 12 new PRIORITY_* threshold env vars added
- `docs/CURRENT_STATE.md` — Phase 5.2 documented

### Notes
- Zero notification code inside the science engine — complete isolation maintained
- Retraction short-circuits to P3 regardless of other factor scores (−100 veto)
- AI scoring hook: classifier.ts accepts optional aiFactors[] parameter — 10th rule can be added without touching existing code
- All 11 rules exported individually for future unit testing without the full classifier
- Pre-existing TypeScript errors in bookmarks.ts, discussions.ts, notes.ts remain unaffected

---

## 2026-08-06 — Phase 5.1: Email Notification Infrastructure

### Added
- `src/notifications/notificationService.ts` — Orchestrator. Single public function `dispatchForEvent()`.
- `src/notifications/priorityEngine.ts` — Pure priority mapper: CRITICAL/HIGH/MEDIUM/LOW by event type.
- `src/notifications/notificationQueue.ts` — In-process FIFO queue, 3-attempt retry, exponential backoff.
- `src/notifications/emailService.ts` — Provider abstraction: SMTP (nodemailer), Resend, SendGrid, NoOp.
- `src/notifications/notificationTemplates.ts` — HTML + plain-text email templates per GW/GRB/FRB/NU type.
- `src/notifications/notificationLogger.ts` — Structured JSON-lines audit log to `logs/notifications.jsonl`.

### Improved
- `kafkaConsumer.ts` — Single integration point added (1 import + 1 fire-and-forget call).
- `.env.example` — Full notification configuration block added.

### Modified Files
- `artifacts/api-server/src/lib/kafkaConsumer.ts`
- `.env.example`
- `docs/CURRENT_STATE.md`

### Notes
- `EMAIL_PROVIDER=none` (default) keeps system silent — no emails without explicit configuration.
- Priority: CRITICAL → GW new + IceCube GOLD; HIGH → FRB, Swift/EP GRB; MEDIUM → others; LOW → historical.
- Permanent provider errors (4xx) are not retried. Transient errors retry with 2s→4s→8s backoff.
- Pre-existing TypeScript errors in `bookmarks.ts`, `discussions.ts`, `notes.ts` remain unrelated.
- Phase 5.2 will wire `alerts.alert_subscriptions` for per-user preferences.

---

## 2026-08-06

### Added
- Workspace agent rules (`.agents/AGENTS.md`) — docs-first context loading policy
- `docs/PROJECT_CONTEXT.md` — project overview, stack, structure, key entry points
- `docs/CURRENT_STATE.md` — feature status, known bugs, recent changes, priorities
- `docs/ARCHITECTURE.md` — data flow, service communication, Docker stack, auth flow
- `docs/DATABASE.md` — full schema reference, indexes, migration system
- `docs/API_REFERENCE.md` — REST + WebSocket API reference
- `docs/CHANGELOG_AI.md` — this file

### Improved
- Docker setup consolidated: 3 compose files → 1 (`docker-compose.yml`)
- All Dockerfiles moved to repository root (`Dockerfile.api`, `.frontend`, `.python`, `.migrate`)
- `.dockerignore` consolidated from 3 sub-ignores into single root file
- `Dockerfile.python` adapted to use root build context (COPY backend/...)
- `README.md` rewritten with single-command workflow
- `DOCKER.md` updated to remove all `-f docker-compose.*.yml` references

### Fixed
- GitHub push protection violation: `.env` file containing real Gemini API key was committed in refactoring commit. Fixed by `git rm --cached .env` + `git commit --amend`.

### Removed
- `docker-compose.prod.yml` — merged into `docker-compose.yml`
- `docker-compose.dev.yml` — dev workflow documented in README
- `docker/migrate.Dockerfile` — moved to root as `Dockerfile.migrate`
- `docker/` directory
- `artifacts/api-server/Dockerfile` — moved to root
- `artifacts/api-server/.dockerignore` — merged into root
- `artifacts/astro-sentinel/Dockerfile` — moved to root
- `artifacts/astro-sentinel/.dockerignore` — merged into root
- `backend/Dockerfile` — moved to root
- `backend/.dockerignore` — merged into root

### Modified Files
- `docker-compose.yml` (rewritten)
- `.dockerignore` (rewritten/consolidated)
- `.env` (untracked from git; GCN credentials added)
- `.env.example` (GCN_CLIENT_ID, GCN_CLIENT_SECRET added)
- `README.md` (rewritten)
- `DOCKER.md` (rewritten)

### Notes
- The Python Dockerfile was the only one requiring a build context change (was `context: ./backend`, now `context: .` with adjusted COPY paths)
- GCN credentials (`GCN_CLIENT_ID`, `GCN_CLIENT_SECRET`) consolidated from `backend/.env` into root `.env` — single env file for all services
- `backend/.env` retained for local (non-Docker) Python development
-   * * 2 0 2 6 - 0 8 - 0 6 * * :   I n t e g r a t e d   P h a s e   5 . 6   C o r r e l a t i o n - A w a r e   S c i e n t i f i c   N o t i f i c a t i o n s .   U p d a t e d   e v e n t T e m p l a t e . t s   t o   i n c l u d e   c a n d i d a t e   e v e n t s   a n d   d y n a m i c a l l y   h i d e   t h e   c o r r e l a t i o n   s e c t i o n   w h e n   c o n f i d e n c e   i s   N O N E ,   a d h e r i n g   t o   s c i e n t i f i c   r e p o r t i n g   r e q u i r e m e n t s .  
 