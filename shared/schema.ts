import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, uuid, unique, index } from "drizzle-orm/pg-core";
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
  coachingEnabled: boolean("coaching_enabled").notNull().default(true),
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

export const outreachPipeline = pgTable(
  "outreach_pipeline",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    clientId: varchar("client_id").notNull(),
    companyId: varchar("company_id").notNull(),
    companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  touch0Email: text("touch_0_email"),
  firstTouchSent: boolean("first_touch_sent").default(false),
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
  websiteLookupRan: boolean("website_lookup_ran").default(false),
  websiteLookupAt: timestamp("website_lookup_at"),
  websiteLookupStatus: text("website_lookup_status"),
  websiteConfidenceScore: integer("website_confidence_score"),
  websiteSource: text("website_source"),
  websiteReasoning: text("website_reasoning"),
  websiteCandidate: text("website_candidate"),
  websiteCandidateConfidence: integer("website_candidate_confidence"),
  websiteCandidateSource: text("website_candidate_source"),
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
  },
  (table) => [unique("outreach_pipeline_client_company_idx").on(table.clientId, table.companyId)]
);

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

/** Browser Voice SDK seat: one row per (client, user), stable Twilio Client identity. */
export const voiceSeats = pgTable(
  "voice_seats",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: varchar("client_id").notNull(),
    userId: varchar("user_id").notNull(),
    twilioIdentity: text("twilio_identity").notNull().unique(),
    defaultCallerIdNumber: text("default_caller_id_number"),
    status: text("status").notNull().default("active"),
    /** Browser Voice: call_sessions.id for this operator’s in-flight session; cleared when that session is terminal. */
    activeCallSessionId: varchar("active_call_session_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("voice_seats_client_id_user_id_idx").on(table.clientId, table.userId)],
);

export const insertVoiceSeatSchema = createInsertSchema(voiceSeats).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVoiceSeat = z.infer<typeof insertVoiceSeatSchema>;
export type VoiceSeat = typeof voiceSeats.$inferSelect;

/** Outbound browser call session: created before Device.connect, linked to webhooks/recording. */
export const callSessions = pgTable(
  "call_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: varchar("client_id").notNull(),
    workspaceKey: text("workspace_key").notNull(),
    userId: varchar("user_id").notNull(),
    seatId: varchar("seat_id"),
    leadE164: text("lead_e164").notNull(),
    fromNumber: text("from_number"),
    parentCallSid: text("parent_call_sid"),
    /** Outbound browser Dial: PSTN/child leg CallSid (set from status webhook). */
    childCallSid: text("child_call_sid"),
    leadCallSid: text("lead_call_sid"),
    status: text("status").notNull().default("created"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    /** Why the session became terminal (Twilio-mapped outcome or browser abort); first write wins. */
    endedReason: text("ended_reason"),
    /** Browser Device.connect / signaling succeeded for this session (distinct from callee answer → answered_at). */
    connectedAt: timestamp("connected_at"),
    /** First time the dialed leg was promoted to in-progress (browser session); used for session-native duration. */
    answeredAt: timestamp("answered_at"),
    /** Browser SDK call object disconnected (leg down); distinct from PSTN/call terminal ended_at. */
    disconnectedAt: timestamp("disconnected_at"),
  },
  (t) => [index("call_sessions_child_call_sid_idx").on(t.childCallSid)],
);

export const insertCallSessionSchema = createInsertSchema(callSessions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCallSession = z.infer<typeof insertCallSessionSchema>;
export type CallSession = typeof callSessions.$inferSelect;

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
  leadQualityScore: integer("lead_quality_score"),
  leadQualityLabel: text("lead_quality_label"),
  leadQualitySignals: text("lead_quality_signals"),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  /** Stable company row id when known (Focus / pipeline). */
  companyId: varchar("company_id"),
  /** Stable contact row id when known — preferred over contact_name matching. */
  contactId: varchar("contact_id"),
  /** company_flows.id when the call was placed from a flow (attempt-scoped review). */
  flowId: integer("flow_id"),
  /** When true, exclude from production reporting / cohort analytics. */
  isSandboxCall: boolean("is_sandbox_call").notNull().default(false),
  callIntelligenceJson: text("call_intelligence_json"),
  /** Browser Voice session id (call_sessions.id), optional for legacy bridge calls. */
  callSessionId: varchar("call_session_id"),
  workspaceKey: text("workspace_key"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
},
  (t) => [
    index("twilio_recordings_call_session_id_idx").on(t.callSessionId),
    index("twilio_recordings_client_company_flow_idx").on(t.clientId, t.companyId, t.flowId),
  ],
);

export const insertTwilioRecordingSchema = createInsertSchema(twilioRecordings).omit({ id: true, createdAt: true, processedAt: true });
export type InsertTwilioRecording = z.infer<typeof insertTwilioRecordingSchema>;
export type TwilioRecording = typeof twilioRecordings.$inferSelect;

export const companyFlows = pgTable("company_flows", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name").notNull(),
  contactId: varchar("contact_id"),
  contactName: text("contact_name"),
  flowType: text("flow_type").notNull(),
  status: text("status").notNull().default("active"),
  stage: integer("stage").notNull().default(1),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(6),
  nextAction: text("next_action"),
  nextDueAt: timestamp("next_due_at"),
  lastOutcome: text("last_outcome"),
  lastAttemptAt: timestamp("last_attempt_at"),
  priority: integer("priority").notNull().default(50),
  notes: text("notes"),
  verifiedQualityScore: integer("verified_quality_score"),
  verifiedQualityLabel: text("verified_quality_label"),
  outcomeSource: text("outcome_source"),
  qualitySignals: text("quality_signals"),
  transcriptSummary: text("transcript_summary"),
  warmStage: text("warm_stage"),
  warmStageUpdatedAt: timestamp("warm_stage_updated_at"),
  revenuePotentialScore: integer("revenue_potential_score"),
  reachabilityScore: integer("reachability_score"),
  heatRelevanceScore: integer("heat_relevance_score"),
  contactConfidenceScore: integer("contact_confidence_score"),
  compositeScore: integer("composite_score"),
  bestChannel: text("best_channel"),
  routingReason: text("routing_reason"),
  bestContactPath: text("best_contact_path"),
  scoringSignals: text("scoring_signals"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  researchBlockerReasons: text("research_blocker_reasons"),
  researchConvertedFrom: text("research_converted_from"),
  deepEnrichmentRan: boolean("deep_enrichment_ran").default(false),
  deepResearchRan: boolean("deep_research_ran").default(false),
  deepResearchBlockerReasons: text("deep_research_blocker_reasons"),
  deepResearchSignals: text("deep_research_signals"),
  deepResearchBestInferredEmail: text("deep_research_best_inferred_email"),
  deepResearchBestInferredEmailConfidence: integer("deep_research_best_inferred_email_confidence"),
  deepResearchSelectedRole: text("deep_research_selected_role"),
  discoveredContacts: text("discovered_contacts"),
  phonePaths: text("phone_paths"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  websiteStatus: text("website_status"),
  contactStatus: text("contact_status"),
  outreachReadiness: text("outreach_readiness"),
  triageAt: timestamp("triage_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCompanyFlowSchema = createInsertSchema(companyFlows).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyFlow = z.infer<typeof insertCompanyFlowSchema>;
export type CompanyFlow = typeof companyFlows.$inferSelect;

export const flowAttempts = pgTable("flow_attempts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  flowId: integer("flow_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name").notNull(),
  contactId: varchar("contact_id"),
  contactName: text("contact_name"),
  channel: text("channel").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  outcome: text("outcome").notNull(),
  notes: text("notes"),
  callbackAt: timestamp("callback_at"),
  capturedInfo: text("captured_info"),
  /** Browser Voice dial session (call_sessions.id), optional. */
  callSessionId: varchar("call_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
});

export const insertFlowAttemptSchema = createInsertSchema(flowAttempts).omit({ id: true, createdAt: true });
export type InsertFlowAttempt = z.infer<typeof insertFlowAttemptSchema>;
export type FlowAttempt = typeof flowAttempts.$inferSelect;

export const actionQueue = pgTable("action_queue", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name").notNull(),
  contactId: varchar("contact_id"),
  contactName: text("contact_name"),
  flowId: integer("flow_id"),
  flowType: text("flow_type").notNull(),
  taskType: text("task_type").notNull(),
  dueAt: timestamp("due_at").notNull(),
  priority: integer("priority").notNull().default(50),
  status: text("status").notNull().default("pending"),
  recommendationText: text("recommendation_text"),
  lastOutcome: text("last_outcome"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  companyPhone: text("company_phone"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  companyCity: text("company_city"),
  companyCategory: text("company_category"),
  bucket: text("bucket"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertActionQueueSchema = createInsertSchema(actionQueue).omit({ id: true, createdAt: true, completedAt: true });
export type InsertActionQueue = z.infer<typeof insertActionQueueSchema>;
export type ActionQueueItem = typeof actionQueue.$inferSelect;

export const targetProfiles = pgTable("target_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  name: text("name").notNull(),
  filters: text("filters").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTargetProfileSchema = createInsertSchema(targetProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTargetProfile = z.infer<typeof insertTargetProfileSchema>;
export type TargetProfile = typeof targetProfiles.$inferSelect;

export const inboundMessages = pgTable("inbound_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  messageSid: varchar("message_sid"),
  fromNumber: varchar("from_number").notNull(),
  toNumber: varchar("to_number").notNull(),
  body: text("body").notNull(),
  mediaUrl: text("media_url"),
  matchedCompany: text("matched_company"),
  matchedFlowId: integer("matched_flow_id"),
  status: text("status").notNull().default("unread"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInboundMessageSchema = createInsertSchema(inboundMessages).omit({ id: true, createdAt: true });
export type InsertInboundMessage = z.infer<typeof insertInboundMessageSchema>;
export type InboundMessage = typeof inboundMessages.$inferSelect;

export const inferredContacts = pgTable("inferred_contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  companyName: text("company_name"),
  domain: text("domain"),
  inferredEmail: text("inferred_email").notNull(),
  pattern: text("pattern"),
  confidence: text("confidence").notNull().default("low"),
  emailConfidenceScore: integer("email_confidence_score").notNull().default(0),
  decisionMakerRole: text("decision_maker_role").notNull().default("unknown"),
  roleConfidenceScore: integer("role_confidence_score").notNull().default(0),
  evidence: text("evidence"),
  source: text("source"),
  personName: text("person_name"),
  personTitle: text("person_title"),
  verified: boolean("verified").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInferredContactSchema = createInsertSchema(inferredContacts).omit({ id: true, createdAt: true });
export type InsertInferredContact = z.infer<typeof insertInferredContactSchema>;
export type InferredContact = typeof inferredContacts.$inferSelect;

export const callIntelligence = pgTable("call_intelligence", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  contactId: varchar("contact_id"),
  callSid: text("call_sid"),
  recordingSid: text("recording_sid"),
  phoneNumber: text("phone_number").notNull(),
  transcriptText: text("transcript_text").notNull(),
  primaryOutcome: text("primary_outcome").notNull().default("unknown"),
  hasHeatExposure: text("has_heat_exposure").default("unknown"),
  currentSolution: text("current_solution").default("unknown"),
  urgencyLevel: text("urgency_level").default("unknown"),
  jobType: text("job_type").default("unknown"),
  decisionMakerName: text("decision_maker_name"),
  timeline: text("timeline").default("unknown"),
  interestScore: integer("interest_score").default(0),
  buyingSignals: text("buying_signals"),
  objections: text("objections"),
  summary: text("summary"),
  nextAction: text("next_action").default("unknown"),
  suggestedFollowUpDate: text("suggested_follow_up_date"),
  analysisRaw: text("analysis_raw"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCallIntelligenceSchema = createInsertSchema(callIntelligence).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCallIntelligence = z.infer<typeof insertCallIntelligenceSchema>;
export type CallIntelligence = typeof callIntelligence.$inferSelect;

/** AI Call Bot supervised transfer + post-call contract fields (checklist-aligned). */
export const aiCallBotSessions = pgTable("ai_call_bot_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  companyId: varchar("company_id").notNull(),
  contactId: varchar("contact_id"),
  flowId: integer("flow_id"),
  callSid: text("call_sid"),
  streamSid: text("stream_sid"),
  outreachReason: text("outreach_reason").notNull().default(""),
  currentState: text("current_state").notNull().default("queued_ready_call"),
  callOutcome: text("call_outcome"),
  decisionMakerName: text("decision_maker_name"),
  decisionMakerTitle: text("decision_maker_title"),
  interestLevel: text("interest_level"),
  objections: text("objections"),
  followUpDate: text("follow_up_date"),
  nextBestAction: text("next_best_action"),
  transferStatus: text("transfer_status"),
  transferBlockReason: text("transfer_block_reason"),
  transferFailureReason: text("transfer_failure_reason"),
  transferFailureDetail: text("transfer_failure_detail"),
  transferOfferedAt: timestamp("transfer_offered_at"),
  transferAgreedAt: timestamp("transfer_agreed_at"),
  transferInitiatedAt: timestamp("transfer_initiated_at"),
  transferCompletedAt: timestamp("transfer_completed_at"),
  agentAnswered: boolean("agent_answered").notNull().default(false),
  agentAnsweredAt: timestamp("agent_answered_at"),
  agentIntercepted: boolean("agent_intercepted").notNull().default(false),
  agentInterceptedAt: timestamp("agent_intercepted_at"),
  supervisedMode: boolean("supervised_mode").notNull().default(true),
  calleeType: text("callee_type"),
  relevanceStatus: text("relevance_status"),
  opennessStatus: text("openness_status"),
  hesitationDetected: boolean("hesitation_detected").notNull().default(false),
  hesitationReason: text("hesitation_reason"),
  fallbackCaptureUsed: boolean("fallback_capture_used").notNull().default(false),
  fallbackCaptureType: text("fallback_capture_type"),
  otherNotes: text("other_notes"),
  manualCleanupRequired: boolean("manual_cleanup_required").notNull().default(false),
  buyingSignals: text("buying_signals"),
  /** Auditable count of FSM transition attempts rejected by transfer-controller (invalid edge or guardrail). */
  fsmRejectedTransitionCount: integer("fsm_rejected_transition_count").notNull().default(0),
  lastFsmRejectedReason: text("last_fsm_rejected_reason"),
  /** Operator: block initiate_transfer until cleared (live rollout). */
  supervisorPauseAutoTransfer: boolean("supervisor_pause_auto_transfer").notNull().default(false),
  supervisorPausedAt: timestamp("supervisor_paused_at"),
  supervisorPauseReason: text("supervisor_pause_reason"),
  /** Persistent “needs supervisor attention” — JSON string[] of reason codes (see supervisor-escalation.ts). */
  supervisorAttentionRequired: boolean("supervisor_attention_required").notNull().default(false),
  supervisorAttentionReasons: text("supervisor_attention_reasons"),
  /** Count of successful FSM fallback_capture_started transitions on this session (escalation input). */
  sessionFallbackFsmCount: integer("session_fallback_fsm_count").notNull().default(0),
  /** Isolated test calls — never join to production outreach queues. */
  isSandboxSession: boolean("is_sandbox_session").notNull().default(false),
  sandboxContactId: integer("sandbox_contact_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Trusted testers — explicit consent; no pipeline rows. */
export const aiCallBotSandboxContacts = pgTable("ai_call_bot_sandbox_contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  fullName: text("full_name").notNull(),
  phoneE164: text("phone_e164").notNull(),
  companyName: text("company_name").notNull(),
  titleOrRole: text("title_or_role"),
  relationshipTag: text("relationship_tag").notNull(),
  testScenarioType: text("test_scenario_type").notNull(),
  /** When true, satisfies “ready_call-style” gate for sandbox dialer only. */
  sandboxReadyCall: boolean("sandbox_ready_call").notNull().default(true),
  outreachReason: text("outreach_reason").notNull(),
  notes: text("notes"),
  consentConfirmed: boolean("consent_confirmed").notNull().default(false),
  active: boolean("active").notNull().default(true),
  /** Supervised rollout: sandbox dials require true (no unsupervised sandbox). */
  supervisedModeRequired: boolean("supervised_mode_required").notNull().default(true),
  preferredOpeningStyle: text("preferred_opening_style"),
  expectedBehavior: text("expected_behavior"),
  expectedOutcome: text("expected_outcome"),
  scenarioDifficulty: text("scenario_difficulty"),
  referralName: text("referral_name"),
  callbackPreference: text("callback_preference"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** One row per sandbox test dial — review + operator sign-off. */
export const aiCallBotSandboxRuns = pgTable("ai_call_bot_sandbox_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: varchar("client_id").notNull(),
  sandboxContactId: integer("sandbox_contact_id").notNull(),
  sessionId: integer("session_id"),
  callSid: text("call_sid"),
  intendedScenarioType: text("intended_scenario_type").notNull(),
  operatorNotes: text("operator_notes"),
  testPassed: boolean("test_passed"),
  issuesExposed: text("issues_exposed"),
  driftFlagsSnapshot: text("drift_flags_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiCallBotSessionSchema = createInsertSchema(aiCallBotSessions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCallBotSession = z.infer<typeof insertAiCallBotSessionSchema>;
export type AiCallBotSession = typeof aiCallBotSessions.$inferSelect;

export type AiCallBotSandboxContact = typeof aiCallBotSandboxContacts.$inferSelect;
export type AiCallBotSandboxRun = typeof aiCallBotSandboxRuns.$inferSelect;
