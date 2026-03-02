import { type User, type InsertUser, type WebhookLog, type InsertWebhookLog, webhookLogs } from "@shared/schema";
import { db } from "./db";
import { desc, eq } from "drizzle-orm";
import { users } from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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
