import { type User, type InsertUser, type WebhookLog, type InsertWebhookLog, type Client, type InsertClient, webhookLogs, clients } from "@shared/schema";
import { db } from "./db";
import { desc, eq } from "drizzle-orm";
import { users } from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getClient(id: string): Promise<Client | undefined>;
  getAllClients(): Promise<Client[]>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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
