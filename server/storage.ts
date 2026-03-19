import { type User, type InsertUser, type WebhookLog, type InsertWebhookLog, type Client, type InsertClient, type ClientConfig, type InsertClientConfig, type UsageLog, type InsertUsageLog, type PlatformInsight, type InsertPlatformInsight, type AuthorityTrend, type MachineAlert, type RecoveryQueueItem, type InsertRecoveryQueueItem, type OutreachPipeline, type InsertOutreachPipeline, webhookLogs, clients, clientConfig, usageLogs, platformInsights, authorityTrends, machineAlerts, recoveryQueue, outreachPipeline } from "@shared/schema";
import { db } from "./db";
import { desc, eq, and, gte, lte } from "drizzle-orm";
import { users } from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsersByClientId(clientId: string): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getClient(id: string): Promise<Client | undefined>;
  getAllClients(): Promise<Client[]>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;
  getClientConfig(clientId: string): Promise<ClientConfig | undefined>;
  upsertClientConfig(config: InsertClientConfig): Promise<ClientConfig>;
  logUsage(log: InsertUsageLog): Promise<UsageLog>;
  getUsageLogs(clientId: string, since?: Date): Promise<UsageLog[]>;
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;
  updateWebhookLog(id: number, data: Partial<InsertWebhookLog>): Promise<WebhookLog | undefined>;
  getWebhookLogs(limit?: number): Promise<WebhookLog[]>;
  getWebhookLog(id: number): Promise<WebhookLog | undefined>;
  getPlatformInsights(industry?: string): Promise<PlatformInsight[]>;
  upsertPlatformInsight(industry: string, title: string, conversionRate: number, sampleSize: number, reachedDmRate: number): Promise<PlatformInsight>;
  clearPlatformInsights(): Promise<void>;
  insertAuthorityTrend(clientId: string, title: string, snapshotDate: Date, conversionRate: number, sampleSize: number): Promise<AuthorityTrend>;
  getAuthorityTrends(clientId: string | null | undefined): Promise<AuthorityTrend[]>;
  createMachineAlert(clientId: string, alertType: string, message: string, severity: string): Promise<MachineAlert>;
  getMachineAlerts(clientId: string | null | undefined, unresolvedOnly?: boolean): Promise<MachineAlert[]>;
  resolveMachineAlert(id: number, clientId?: string | null): Promise<MachineAlert | undefined>;
  addToRecoveryQueue(item: InsertRecoveryQueueItem): Promise<RecoveryQueueItem>;
  getRecoveryQueueDue(clientId: string, limit?: number): Promise<RecoveryQueueItem[]>;
  getRecoveryQueue(clientId: string, activeOnly?: boolean): Promise<RecoveryQueueItem[]>;
  getRecoveryQueueItem(companyId: string, clientId: string): Promise<RecoveryQueueItem | undefined>;
  updateRecoveryQueueItem(id: number, data: Partial<{ attempts: number; nextAttempt: Date; lastResult: string; dmStatus: string; active: boolean; updatedAt: Date }>): Promise<RecoveryQueueItem | undefined>;
  removeFromRecoveryQueue(companyId: string, clientId: string): Promise<void>;
  createOutreachPipeline(item: InsertOutreachPipeline): Promise<OutreachPipeline>;
  getOutreachPipelines(clientId: string, status?: string): Promise<OutreachPipeline[]>;
  getOutreachPipelineByCompany(companyId: string, clientId: string): Promise<OutreachPipeline | undefined>;
  updateOutreachPipeline(id: number, data: Partial<InsertOutreachPipeline & { updatedAt: Date }>): Promise<OutreachPipeline | undefined>;
  getOutreachPipelinesDue(clientId: string, limit?: number): Promise<OutreachPipeline[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUsersByClientId(clientId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.clientId, clientId));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [result] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return result;
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async getAllClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [result] = await db.insert(clients).values(client).returning();
    return result;
  }

  async updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [result] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
    return result;
  }

  async getClientConfig(cId: string): Promise<ClientConfig | undefined> {
    const [result] = await db.select().from(clientConfig).where(eq(clientConfig.clientId, cId));
    return result;
  }

  async upsertClientConfig(config: InsertClientConfig): Promise<ClientConfig> {
    const existing = await this.getClientConfig(config.clientId);
    if (existing) {
      const [result] = await db.update(clientConfig).set(config).where(eq(clientConfig.id, existing.id)).returning();
      return result;
    }
    const [result] = await db.insert(clientConfig).values(config).returning();
    return result;
  }

  async logUsage(log: InsertUsageLog): Promise<UsageLog> {
    const [result] = await db.insert(usageLogs).values(log).returning();
    return result;
  }

  async getUsageLogs(cId: string, since?: Date): Promise<UsageLog[]> {
    if (since) {
      return db.select().from(usageLogs).where(and(eq(usageLogs.clientId, cId), gte(usageLogs.createdAt, since))).orderBy(desc(usageLogs.createdAt)).limit(200);
    }
    return db.select().from(usageLogs).where(eq(usageLogs.clientId, cId)).orderBy(desc(usageLogs.createdAt)).limit(200);
  }

  async createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog> {
    const [result] = await db.insert(webhookLogs).values(log).returning();
    return result;
  }

  async updateWebhookLog(id: number, data: Partial<InsertWebhookLog>): Promise<WebhookLog | undefined> {
    const [result] = await db.update(webhookLogs).set(data).where(eq(webhookLogs.id, id)).returning();
    return result;
  }

  async getWebhookLogs(limit = 50): Promise<WebhookLog[]> {
    return db.select().from(webhookLogs).orderBy(desc(webhookLogs.createdAt)).limit(limit);
  }

  async getWebhookLog(id: number): Promise<WebhookLog | undefined> {
    const [result] = await db.select().from(webhookLogs).where(eq(webhookLogs.id, id));
    return result;
  }

  async getPlatformInsights(industry?: string): Promise<PlatformInsight[]> {
    if (industry) {
      return db.select().from(platformInsights).where(eq(platformInsights.industry, industry)).orderBy(desc(platformInsights.conversionRate));
    }
    return db.select().from(platformInsights).orderBy(desc(platformInsights.conversionRate));
  }

  async upsertPlatformInsight(industry: string, title: string, conversionRate: number, sampleSize: number, reachedDmRate: number): Promise<PlatformInsight> {
    const existing = await db.select().from(platformInsights)
      .where(and(eq(platformInsights.industry, industry), eq(platformInsights.title, title)));
    if (existing.length > 0) {
      const [updated] = await db.update(platformInsights)
        .set({ conversionRate, sampleSize, reachedDmRate, lastUpdated: new Date() })
        .where(eq(platformInsights.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(platformInsights)
      .values({ industry, title, conversionRate, sampleSize, reachedDmRate, lastUpdated: new Date() })
      .returning();
    return created;
  }

  async clearPlatformInsights(): Promise<void> {
    await db.delete(platformInsights);
  }

  async insertAuthorityTrend(clientId: string, title: string, snapshotDate: Date, conversionRate: number, sampleSize: number): Promise<AuthorityTrend> {
    const [created] = await db.insert(authorityTrends)
      .values({ clientId, title, snapshotDate, conversionRate, sampleSize })
      .returning();
    return created;
  }

  async getAuthorityTrends(clientId: string | null | undefined): Promise<AuthorityTrend[]> {
    if (!clientId) return [];
    return db.select().from(authorityTrends)
      .where(eq(authorityTrends.clientId, clientId))
      .orderBy(authorityTrends.snapshotDate);
  }

  async createMachineAlert(clientId: string, alertType: string, message: string, severity: string): Promise<MachineAlert> {
    const [created] = await db.insert(machineAlerts)
      .values({ clientId, alertType, message, severity, resolved: 0 })
      .returning();
    return created;
  }

  async getMachineAlerts(clientId: string | null | undefined, unresolvedOnly = false): Promise<MachineAlert[]> {
    if (!clientId) return [];
    const conditions = [eq(machineAlerts.clientId, clientId)];
    if (unresolvedOnly) conditions.push(eq(machineAlerts.resolved, 0));
    return db.select().from(machineAlerts)
      .where(and(...conditions))
      .orderBy(desc(machineAlerts.createdAt));
  }

  async resolveMachineAlert(id: number, clientId?: string | null): Promise<MachineAlert | undefined> {
    const conditions = [eq(machineAlerts.id, id)];
    if (clientId) conditions.push(eq(machineAlerts.clientId, clientId));
    const [updated] = await db.update(machineAlerts)
      .set({ resolved: 1 })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async addToRecoveryQueue(item: InsertRecoveryQueueItem): Promise<RecoveryQueueItem> {
    const [created] = await db.insert(recoveryQueue).values(item).returning();
    return created;
  }

  async getRecoveryQueueDue(clientId: string, limit = 20): Promise<RecoveryQueueItem[]> {
    const now = new Date();
    return db.select().from(recoveryQueue)
      .where(and(
        eq(recoveryQueue.clientId, clientId),
        eq(recoveryQueue.active, true),
        lte(recoveryQueue.nextAttempt, now)
      ))
      .orderBy(recoveryQueue.priority, recoveryQueue.nextAttempt)
      .limit(limit);
  }

  async getRecoveryQueue(clientId: string, activeOnly = true): Promise<RecoveryQueueItem[]> {
    const conditions = [eq(recoveryQueue.clientId, clientId)];
    if (activeOnly) conditions.push(eq(recoveryQueue.active, true));
    return db.select().from(recoveryQueue)
      .where(and(...conditions))
      .orderBy(recoveryQueue.priority, recoveryQueue.nextAttempt);
  }

  async getRecoveryQueueItem(companyId: string, clientId: string): Promise<RecoveryQueueItem | undefined> {
    const [item] = await db.select().from(recoveryQueue)
      .where(and(
        eq(recoveryQueue.companyId, companyId),
        eq(recoveryQueue.clientId, clientId)
      ));
    return item;
  }

  async updateRecoveryQueueItem(id: number, data: Partial<{ attempts: number; nextAttempt: Date; lastResult: string; dmStatus: string; active: boolean; updatedAt: Date }>): Promise<RecoveryQueueItem | undefined> {
    const [updated] = await db.update(recoveryQueue)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(recoveryQueue.id, id))
      .returning();
    return updated;
  }

  async removeFromRecoveryQueue(companyId: string, clientId: string): Promise<void> {
    await db.update(recoveryQueue)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(recoveryQueue.companyId, companyId),
        eq(recoveryQueue.clientId, clientId)
      ));
  }

  async createOutreachPipeline(item: InsertOutreachPipeline): Promise<OutreachPipeline> {
    try {
      const inserted = await db
        .insert(outreachPipeline)
        .values(item)
        .onConflictDoNothing({
          target: [outreachPipeline.clientId, outreachPipeline.companyId],
        })
        .returning();
      if (inserted.length > 0) return inserted[0];
      const [existing] = await db
        .select()
        .from(outreachPipeline)
        .where(
          and(
            eq(outreachPipeline.clientId, item.clientId),
            eq(outreachPipeline.companyId, item.companyId)
          )
        )
        .limit(1);
      if (existing) return existing;
      throw new Error("Insert failed and no existing row found");
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "23505") {
        const [existing] = await db
          .select()
          .from(outreachPipeline)
          .where(
            and(
              eq(outreachPipeline.clientId, item.clientId),
              eq(outreachPipeline.companyId, item.companyId)
            )
          )
          .limit(1);
        if (existing) return existing;
      }
      throw e;
    }
  }

  async getOutreachPipelines(clientId: string, status?: string): Promise<OutreachPipeline[]> {
    if (status) {
      return db.select().from(outreachPipeline)
        .where(and(eq(outreachPipeline.clientId, clientId), eq(outreachPipeline.pipelineStatus, status)))
        .orderBy(outreachPipeline.nextTouchDate);
    }
    return db.select().from(outreachPipeline)
      .where(eq(outreachPipeline.clientId, clientId))
      .orderBy(desc(outreachPipeline.updatedAt));
  }

  async getOutreachPipelineByCompany(companyId: string, clientId: string): Promise<OutreachPipeline | undefined> {
    const [item] = await db.select().from(outreachPipeline)
      .where(and(
        eq(outreachPipeline.companyId, companyId),
        eq(outreachPipeline.clientId, clientId),
        eq(outreachPipeline.pipelineStatus, "ACTIVE")
      ));
    return item;
  }

  async updateOutreachPipeline(id: number, data: Partial<InsertOutreachPipeline & { updatedAt: Date }>): Promise<OutreachPipeline | undefined> {
    const [updated] = await db.update(outreachPipeline)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(outreachPipeline.id, id))
      .returning();
    return updated;
  }

  async getOutreachPipelinesDue(clientId: string, limit: number = 50): Promise<OutreachPipeline[]> {
    return db.select().from(outreachPipeline)
      .where(and(
        eq(outreachPipeline.clientId, clientId),
        eq(outreachPipeline.pipelineStatus, "ACTIVE"),
        lte(outreachPipeline.nextTouchDate, new Date())
      ))
      .orderBy(outreachPipeline.nextTouchDate)
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
