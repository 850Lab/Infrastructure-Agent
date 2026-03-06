import { type User, type InsertUser, type WebhookLog, type InsertWebhookLog, type Client, type InsertClient, type ClientConfig, type InsertClientConfig, type UsageLog, type InsertUsageLog, webhookLogs, clients, clientConfig, usageLogs } from "@shared/schema";
import { db } from "./db";
import { desc, eq, and, gte } from "drizzle-orm";
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
}

export const storage = new DatabaseStorage();
