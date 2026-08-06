import { z } from "zod";

export const NotificationBehaviourSchema = z.object({
  aiSummary: z.boolean(),
  correlation: z.boolean(),
  localization: z.boolean(),
  digest: z.boolean(),
  instant: z.boolean(),
});

export const NotificationPreferencesSchema = z.object({
  email: z.string().email(),
  channels: z.array(z.string()),
  eventTypes: z.array(z.string()),
  priorityLevel: z.enum(["critical_only", "critical_and_high", "all"]),
  observatories: z.array(z.string()),
  behaviour: NotificationBehaviourSchema,
  isActive: z.boolean().optional(),
});

export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
