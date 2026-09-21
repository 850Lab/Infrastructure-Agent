import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const operatorTasks = pgTable(
  "operator_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    repository: text("repository"),
    branch: text("branch"),
    status: text("status").notNull().default("queued"),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    gates: jsonb("gates").$type<Array<Record<string, unknown>>>().notNull().default([]),
    blocker: jsonb("blocker").$type<Record<string, unknown> | null>(),
    paidExecutionAllowed: boolean("paid_execution_allowed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("operator_tasks_status_idx").on(table.status),
    index("operator_tasks_updated_idx").on(table.updatedAt),
  ],
);

export const operatorApprovals = pgTable(
  "operator_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => operatorTasks.id, { onDelete: "cascade" }),
    authorityClass: text("authority_class").notNull(),
    actionSummary: text("action_summary").notNull(),
    targetSystem: text("target_system").notNull(),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
  },
  (table) => [
    index("operator_approvals_task_idx").on(table.taskId),
    index("operator_approvals_status_idx").on(table.status),
  ],
);

export const operatorAuditEvents = pgTable(
  "operator_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => operatorTasks.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    targetSystem: text("target_system").notNull(),
    inputSummary: text("input_summary"),
    outputSummary: text("output_summary"),
    status: text("status").notNull(),
    approvalId: uuid("approval_id").references(() => operatorApprovals.id, {
      onDelete: "set null",
    }),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("operator_audit_task_idx").on(table.taskId),
    index("operator_audit_created_idx").on(table.createdAt),
  ],
);
