// ─── Tenant ──────────────────────────────────────────────────────────────────
export {
  tenantSchema,
  labs,
  labMembers,
  labInvitations,
  labsRelations,
  labMembersRelations,
  labInvitationsRelations,
} from "./tenant.js";
export type { Lab, InsertLab, LabMember, InsertLabMember, LabInvitation, InsertLabInvitation } from "./tenant.js";

// ─── Identity ─────────────────────────────────────────────────────────────────
export {
  identitySchema,
  users,
  sessions,
  apiKeys,
  usersRelations,
  sessionsRelations,
  apiKeysRelations,
} from "./identity.js";
export type { User, InsertUser, Session, InsertSession, ApiKey, InsertApiKey } from "./identity.js";

// ─── Catalog ──────────────────────────────────────────────────────────────────
export {
  catalogSchema,
  observatories,
  observatoryCapabilities,
  skyRegions,
  observatoriesRelations,
  observatoryCapabilitiesRelations,
} from "./catalog.js";
export type {
  Observatory,
  InsertObservatory,
  ObservatoryCapability,
  InsertObservatoryCapability,
  SkyRegion,
  InsertSkyRegion,
} from "./catalog.js";

// ─── Core ─────────────────────────────────────────────────────────────────────
export {
  coreSchema,
  events,
  eventDetections,
  eventLocalizations,
  eventClassifications,
  eventFollowupRequests,
  eventAnnotations,
  eventEmbeddings,
  eventsRelations,
  eventDetectionsRelations,
  eventLocalizationsRelations,
  eventClassificationsRelations,
  eventFollowupRequestsRelations,
  eventAnnotationsRelations,
  eventEmbeddingsRelations,
} from "./events.js";
export type {
  AstroEvent,
  InsertAstroEvent,
  EventDetection,
  InsertEventDetection,
  EventLocalization,
  InsertEventLocalization,
  EventClassification,
  InsertEventClassification,
  EventFollowupRequest,
  InsertEventFollowupRequest,
  EventAnnotation,
  InsertEventAnnotation,
  EventEmbedding,
  InsertEventEmbedding,
} from "./events.js";

// ─── Alerts ───────────────────────────────────────────────────────────────────
export {
  alertsSchema,
  alertSubscriptions,
  alerts,
  alertSubscriptionsRelations,
  alertsRelations,
} from "./alerts.js";
export type {
  AlertSubscription,
  InsertAlertSubscription,
  Alert,
  InsertAlert,
} from "./alerts.js";

// ─── Metrics ──────────────────────────────────────────────────────────────────
export {
  metricsSchema,
  eventMetrics,
  eventMetricsRelations,
} from "./metrics.js";
export type { EventMetric, InsertEventMetric } from "./metrics.js";

// ─── Audit ────────────────────────────────────────────────────────────────────
export {
  auditSchema,
  auditLogs,
  auditLogsRelations,
} from "./audit.js";
export type { AuditLog, InsertAuditLog } from "./audit.js";

// ─── Legacy re-exports (maintained for backward-compat) ──────────────────────
// The old users/team_members tables from the public schema are replaced
// by identity.users and tenant.lab_members. Keep the old exports as aliases
// so existing application code doesn't break immediately.
export { users as usersTable } from "./identity.js";
export { events as eventsTable } from "./events.js";
