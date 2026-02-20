import { db } from "../../db";
import { messages } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IChatStorage {
  getMessagesByAccount(subAccountId: number): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(subAccountId: number, body: string, direction: string, contactPhone: string, channel: string): Promise<typeof messages.$inferSelect>;
}

export const chatStorage: IChatStorage = {
  async getMessagesByAccount(subAccountId: number) {
    return db.select().from(messages).where(eq(messages.subAccountId, subAccountId)).orderBy(desc(messages.createdAt));
  },

  async createMessage(subAccountId: number, body: string, direction: string, contactPhone: string, channel: string) {
    const [message] = await db.insert(messages).values({
      subAccountId,
      body,
      direction,
      contactPhone,
      channel,
      status: "sent",
    }).returning();
    return message;
  },
};
