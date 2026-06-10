import { Router } from "express";
import { getReport } from "../lib/filterReport";

const router = Router();

/**
 * GET /api/filter-report
 *
 * Returns the live scientific quality filter statistics since server startup.
 *
 * Response shape:
 * {
 *   startedAt:          ISO timestamp when server started
 *   generatedAt:        ISO timestamp of this response
 *   uptimeSeconds:      seconds since server start
 *   totalReceived:      total events seen from Kafka (post topic-allowlist)
 *   totalAccepted:      events that passed all quality gates (persisted to DB)
 *   totalRejected:      events blocked by a quality gate
 *   acceptRate:         "XX.X%" — accepted / received
 *   byTopic:            per-topic { received, accepted, rejected }
 *   rejectedByCategory: counts grouped by rejection category
 *   rejectedByReason:   top rejection reasons sorted by frequency
 * }
 */
router.get("/filter-report", (_req, res) => {
  const report = getReport();
  res.json(report);
});

export default router;
