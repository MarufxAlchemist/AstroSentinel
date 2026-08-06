/**
 * priorityEngine.ts — SUPERSEDED
 * --------------------------------
 * This module is superseded by the Phase 5.2 Scientific Priority Classification
 * Engine at src/science/priorityEngine/.
 *
 * This file is retained only as a compatibility shim. It re-exports the
 * types that notificationTemplates.ts still uses for badge colouring.
 *
 * DO NOT add new logic here. Extend src/science/priorityEngine/scoringRules.ts
 * for any new priority logic.
 *
 * @deprecated Use classify() from src/science/priorityEngine/index.ts instead.
 */

/**
 * Notification-layer priority labels derived from the P0–P3 science scale.
 * Used exclusively by notificationTemplates.ts for email badge colours.
 *
 *   P0 → CRITICAL
 *   P1 → HIGH
 *   P2 → MEDIUM   (no email, kept for template completeness)
 *   P3 → LOW      (no email, kept for template completeness)
 */
export type NotificationPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * Map a P0–P3 science priority level to the notification-layer label.
 * Used by notificationService.ts when building email content.
 */
export function toNotificationPriority(
  scientificPriority: "P0" | "P1" | "P2" | "P3",
): NotificationPriority {
  switch (scientificPriority) {
    case "P0": return "CRITICAL";
    case "P1": return "HIGH";
    case "P2": return "MEDIUM";
    case "P3": return "LOW";
  }
}
