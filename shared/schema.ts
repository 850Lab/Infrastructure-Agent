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
  contactEmail: text("contact_email"),
  touch1Email: text("touch_1_email"),
  touch2Call: text("touch_2_call"),
  touch3Email: text("touch_3_email"),
  touch4Call: text("touch_4_call"),
  touch5Email: text("touch_5_email"),
  touch6Call: text("touch_6_call"),
  pipelineStatus: text("pipeline_status").notNull().default("ACTIVE"),
  nextTouchDate: timestamp("next_touch_date").notNull(),
  touchesCompleted: integer("touches_completed").notNull().default(0),
  respondedAt: timestamp("responded_at"),
  respondedVia: text("responded_via"),
  contentSource: text("content_source").default("ai_generated"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  phone: text("phone"),
  website: text("website"),
  linkedinUrl: text("linkedin_url"),
  city: text("city"),
  state: text("state"),
  industry: text("industry"),
  source: text("source"),
  relevanceStatus: text("relevance_status").default("relevant"),
  lastOutcome: text("last_outcome"),
  callFollowupRequired: boolean("call_followup_required").default(false),
  assignedOffer: text("assigned_offer"),
  notes: text("notes"),
  personalizationLine: text("personalization_line"),
  emailTemplateVersion: text("email_template_version"),
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
  imapHost: text("imap_host"),
  imapPort: integer("imap_port").default(993),
  imapSecure: boolean("imap_secure").default(true),
  providerType: text("provider_type").notNull().default("custom"),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  signature: text("signature"),
  dailyLimit: integer("daily_limit").notNull().default(50),
  providerMaxLimit: integer("provider_max_limit").notNull().default(500),
  sendIntervalMs: integer("send_interval_ms").notNull().default(5000),
  sentToday: integer("sent_today").notNull().default(0),
  lastResetDate: text("last_reset_date"),
  autoSendEnabled: boolean("auto_send_enabled").notNull().default(false),
  replyCheckEnabled: boolean("reply_check_enabled").notNull().default(false),
  lastReplyCheck: timestamp("last_reply_check"),
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
  messageId: text("message_id"),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  errorMessage: text("error_message"),
  openCount: integer("open_count").notNull().default(0),
  firstOpenedAt: timestamp("first_opened_at"),
  clickCount: integer("click_count").notNull().default(0),
  firstClickedAt: timestamp("first_clicked_at"),
  replyDetectedAt: timestamp("reply_detected_at"),
  sentVia: text("sent_via"),
  deferredAt: timestamp("deferred_at"),
  deferReason: text("defer_reason"),
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

export const emailReplies = pgTable("email_replies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  emailSendId: integer("email_send_id").notNull(),
  outreachPipelineId: integer("outreach_pipeline_id").notNull(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject"),
  snippet: text("snippet"),
  imapMessageId: text("imap_message_id"),
  inReplyTo: text("in_reply_to"),
  receivedAt: timestamp("received_at").notNull(),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});

export const insertEmailReplySchema = createInsertSchema(emailReplies).omit({ id: true, detectedAt: true });
export type InsertEmailReply = z.infer<typeof insertEmailReplySchema>;
export type EmailReply = typeof emailReplies.$inferSelect;

export const emailTemplates = pgTable("email_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  touchNumber: integer("touch_number"),
  source: text("source").notNull().default("saved_template"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;

export const manualLeads = pgTable("manual_leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  airtableRecordId: text("airtable_record_id").notNull(),
  companyName: text("company_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertManualLeadSchema = createInsertSchema(manualLeads).omit({ id: true, createdAt: true });
export type InsertManualLead = z.infer<typeof insertManualLeadSchema>;
export type ManualLead = typeof manualLeads.$inferSelect;

export const hubspotTokens = pgTable("hubspot_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  hubId: text("hub_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertHubspotTokenSchema = createInsertSchema(hubspotTokens).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHubspotToken = z.infer<typeof insertHubspotTokenSchema>;
export type HubspotToken = typeof hubspotTokens.$inferSelect;

export const lngProjects = pgTable("lng_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  projectName: text("project_name").notNull(),
  operator: text("operator"),
  location: text("location"),
  state: text("state"),
  status: text("status"),
  capacity: text("capacity"),
  estimatedValue: text("estimated_value"),
  description: text("description"),
  contractors: text("contractors"),
  timeline: text("timeline"),
  source: text("source"),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  savedAt: timestamp("saved_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLngProjectSchema = createInsertSchema(lngProjects).omit({ id: true, savedAt: true, updatedAt: true });
export type InsertLngProject = z.infer<typeof insertLngProjectSchema>;
export type LngProject = typeof lngProjects.$inferSelect;

export const lngContacts = pgTable("lng_contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  projectId: integer("project_id"),
  fullName: text("full_name").notNull(),
  title: text("title"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  source: text("source"),
  notes: text("notes"),
  communityInvolvement: text("community_involvement"),
  upcomingEvents: text("upcoming_events"),
  interests: text("interests"),
  socialMedia: text("social_media"),
  personalNotes: text("personal_notes"),
  savedAt: timestamp("saved_at").defaultNow().notNull(),
});

export const insertLngContactSchema = createInsertSchema(lngContacts).omit({ id: true, savedAt: true });
export type InsertLngContact = z.infer<typeof insertLngContactSchema>;
export type LngContact = typeof lngContacts.$inferSelect;

export const lngIntel = pgTable("lng_intel", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  projectId: integer("project_id"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  url: text("url"),
  date: text("date"),
  rawData: text("raw_data"),
  savedAt: timestamp("saved_at").defaultNow().notNull(),
});

export const insertLngIntelSchema = createInsertSchema(lngIntel).omit({ id: true, savedAt: true });
export type InsertLngIntel = z.infer<typeof insertLngIntelSchema>;
export type LngIntel = typeof lngIntel.$inferSelect;

export const lngOperatorCards = pgTable("lng_operator_cards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyName: text("company_name").notNull(),
  industryType: text("industry_type"),
  region: text("region"),
  cardData: text("card_data").notNull(),
  confidence: integer("confidence"),
  bestNextRoom: text("best_next_room"),
  bestConnector: text("best_connector"),
  bestAction: text("best_action"),
  status: text("status").default("active"),
  notes: text("notes"),
  savedAt: timestamp("saved_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLngOperatorCardSchema = createInsertSchema(lngOperatorCards).omit({ id: true, savedAt: true, updatedAt: true });
export type InsertLngOperatorCard = z.infer<typeof insertLngOperatorCardSchema>;
export type LngOperatorCard = typeof lngOperatorCards.$inferSelect;

export const twilioRecordings = pgTable("twilio_recordings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  callSid: text("call_sid").notNull(),
  recordingSid: text("recording_sid").notNull().unique(),
  clientId: varchar("client_id"),
  toNumber: text("to_number"),
  fromNumber: text("from_number"),
  duration: integer("duration").default(0),
  transcription: text("transcription"),
  analysis: text("analysis"),
  analysisJson: text("analysis_json"),
  problemDetected: text("problem_detected"),
  proposedPatchType: text("proposed_patch_type"),
  analysisConfidence: text("analysis_confidence"),
  noAuthority: boolean("no_authority").default(false),
  authorityReason: text("authority_reason"),
  suggestedRole: text("suggested_role"),
  followupDate: text("followup_date"),
  followupSource: text("followup_source"),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const insertTwilioRecordingSchema = createInsertSchema(twilioRecordings).omit({ id: true, createdAt: true, processedAt: true });
export type InsertTwilioRecording = z.infer<typeof insertTwilioRecordingSchema>;
export type TwilioRecording = typeof twilioRecordings.$inferSelect;
