import { z } from "zod";

export const operatorTaskStatusSchema = z.enum([
  "queued",
  "inspecting",
  "planning",
  "executing",
  "testing",
  "diagnosing",
  "deploying",
  "verifying",
  "awaiting_approval",
  "blocked_external",
  "completed",
  "failed_terminal",
]);

export const operatorGateSchema = z.object({
  id: z.string().min(1),
  required: z.boolean().default(true),
  status: z.enum(["pending", "passed", "failed", "not_applicable"]),
  evidence: z.array(z.string()).default([]),
  detail: z.string().optional(),
});

export const operatorTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  repository: z.string().optional(),
  branch: z.string().optional(),
  status: operatorTaskStatusSchema,
  acceptanceCriteria: z.array(z.string()).min(1),
  gates: z.array(operatorGateSchema).default([]),
  blocker: z
    .object({
      type: z.enum(["approval", "credential", "mfa", "identity", "platform", "external_dependency"]),
      detail: z.string().min(1),
      ownerActionRequired: z.string().optional(),
    })
    .nullable()
    .default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const operatorAuditEventSchema = z.object({
  eventId: z.string().min(1),
  taskId: z.string().min(1),
  timestamp: z.string(),
  actionType: z.string().min(1),
  targetSystem: z.string().min(1),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  status: z.enum(["started", "succeeded", "failed", "blocked"]),
  approvalId: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});

export type OperatorTask = z.infer<typeof operatorTaskSchema>;
export type OperatorAuditEvent = z.infer<typeof operatorAuditEventSchema>;
