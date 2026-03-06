import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientName: text("client_name").notNull(),
  machineName: text("machine_name").notNull(),
  industryConfig: text("industry_config").notNull().default("industrial"),
  territory: text("territory").notNull(),
  decisionMakerFocus: text("decision_maker_focus").notNull(),
  status: text("status").notNull().default("active"),
  airtableBaseId: text("airtable_base_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastRunAt: timestamp("last_run_at"),
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  lastRunAt: true,
});

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("operator"),
  clientId: varchar("client_id"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const clientConfig = pgTable("client_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  maxTopPerRun: integer("max_top_per_run").notNull().default(25),
  maxDmEnrichPerRun: integer("max_dm_enrich_per_run").notNull().default(25),
  maxQueryGeneratePerRun: integer("max_query_generate_per_run").notNull().default(20),
  maxPlaybooksPerRun: integer("max_playbooks_per_run").notNull().default(25),
  maxLeadFeedPerRun: integer("max_lead_feed_per_run").notNull().default(5),
});

export const insertClientConfigSchema = createInsertSchema(clientConfig).omit({ id: true });
export type InsertClientConfig = z.infer<typeof insertClientConfigSchema>;
export type ClientConfig = typeof clientConfig.$inferSelect;

export const usageLogs = pgTable("usage_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  runId: text("run_id"),
  step: text("step").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: integer("metric_value").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUsageLogSchema = createInsertSchema(usageLogs).omit({ id: true, createdAt: true });
export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;
export type UsageLog = typeof usageLogs.$inferSelect;

export const webhookLogs = pgTable("webhook_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  airtableRecordId: text("airtable_record_id").notNull(),
  status: text("status").notNull().default("pending"),
  transcription: text("transcription"),
  analysis: text("analysis"),
  errorMessage: text("error_message"),
  audioFileName: text("audio_file_name"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;

export const insertWebhookLogSchema = z.object({
  airtableRecordId: z.string(),
  status: z.string().optional(),
  transcription: z.string().nullable().optional(),
  analysis: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  audioFileName: z.string().nullable().optional(),
  processingTimeMs: z.number().nullable().optional(),
});

export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;

export const webhookPayloadSchema = z.object({
  recordId: z.string().min(1, "Record ID is required"),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export const platformInsights = pgTable("platform_insights", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  industry: text("industry").notNull(),
  title: text("title").notNull(),
  conversionRate: integer("conversion_rate").notNull().default(0),
  sampleSize: integer("sample_size").notNull().default(0),
  reachedDmRate: integer("reached_dm_rate").notNull().default(0),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const insertPlatformInsightSchema = createInsertSchema(platformInsights).omit({ id: true });
export type InsertPlatformInsight = z.infer<typeof insertPlatformInsightSchema>;
export type PlatformInsight = typeof platformInsights.$inferSelect;

export const authorityTrends = pgTable("authority_trends", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  title: text("title").notNull(),
  snapshotDate: timestamp("snapshot_date").notNull(),
  conversionRate: integer("conversion_rate").notNull().default(0),
  sampleSize: integer("sample_size").notNull().default(0),
});

export const insertAuthorityTrendSchema = createInsertSchema(authorityTrends).omit({ id: true });
export type InsertAuthorityTrend = z.infer<typeof insertAuthorityTrendSchema>;
export type AuthorityTrend = typeof authorityTrends.$inferSelect;

export const machineAlerts = pgTable("machine_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  alertType: text("alert_type").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull().default("info"),
  resolved: integer("resolved").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMachineAlertSchema = createInsertSchema(machineAlerts).omit({ id: true, createdAt: true });
export type InsertMachineAlert = z.infer<typeof insertMachineAlertSchema>;
export type MachineAlert = typeof machineAlerts.$inferSelect;

export const recoveryQueue = pgTable("recovery_queue", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name").notNull(),
  dmStatus: text("dm_status").notNull(),
  priority: text("priority").notNull().default("medium"),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: timestamp("next_attempt").notNull(),
  lastResult: text("last_result"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRecoveryQueueSchema = createInsertSchema(recoveryQueue).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecoveryQueueItem = z.infer<typeof insertRecoveryQueueSchema>;
export type RecoveryQueueItem = typeof recoveryQueue.$inferSelect;

export const outreachPipeline = pgTable("outreach_pipeline", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  touch1Email: text("touch_1_email"),
  touch2Call: text("touch_2_call"),
  touch3Email: text("touch_3_email"),
  touch4Call: text("touch_4_call"),
  touch5Email: text("touch_5_email"),
  touch6Call: text("touch_6_call"),
  pipelineStatus: text("pipeline_status").notNull().default("ACTIVE"),
  nextTouchDate: timestamp("next_touch_date").notNull(),
  touchesCompleted: integer("touches_completed").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOutreachPipelineSchema = createInsertSchema(outreachPipeline).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOutreachPipeline = z.infer<typeof insertOutreachPipelineSchema>;
export type OutreachPipeline = typeof outreachPipeline.$inferSelect;

export const clientEmailSettings = pgTable("client_email_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull().unique(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user").notNull(),
  smtpPass: text("smtp_pass").notNull(),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  signature: text("signature"),
  dailyLimit: integer("daily_limit").notNull().default(50),
  sentToday: integer("sent_today").notNull().default(0),
  lastResetDate: text("last_reset_date"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertClientEmailSettingsSchema = createInsertSchema(clientEmailSettings).omit({ id: true, createdAt: true, updatedAt: true, sentToday: true, lastResetDate: true });
export type InsertClientEmailSettings = z.infer<typeof insertClientEmailSettingsSchema>;
export type ClientEmailSettings = typeof clientEmailSettings.$inferSelect;

export const emailSends = pgTable("email_sends", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  outreachPipelineId: integer("outreach_pipeline_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name"),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  touchNumber: integer("touch_number").notNull(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  trackingId: varchar("tracking_id").notNull().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  errorMessage: text("error_message"),
  openCount: integer("open_count").notNull().default(0),
  firstOpenedAt: timestamp("first_opened_at"),
  clickCount: integer("click_count").notNull().default(0),
  firstClickedAt: timestamp("first_clicked_at"),
});

export const insertEmailSendSchema = createInsertSchema(emailSends).omit({ id: true, sentAt: true, openCount: true, firstOpenedAt: true, clickCount: true, firstClickedAt: true });
export type InsertEmailSend = z.infer<typeof insertEmailSendSchema>;
export type EmailSend = typeof emailSends.$inferSelect;

export const emailTrackingEvents = pgTable("email_tracking_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  emailSendId: integer("email_send_id").notNull(),
  trackingId: varchar("tracking_id").notNull(),
  eventType: text("event_type").notNull(),
  linkUrl: text("link_url"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailTrackingEventSchema = createInsertSchema(emailTrackingEvents).omit({ id: true, createdAt: true });
export type InsertEmailTrackingEvent = z.infer<typeof insertEmailTrackingEventSchema>;
export type EmailTrackingEvent = typeof emailTrackingEvents.$inferSelect;
