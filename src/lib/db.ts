import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  pgTable,
  uuid,
  timestamp,
  text,
  jsonb,
} from "drizzle-orm/pg-core";

const connectionString = process.env.DATABASE_URL ?? "";

export const sql = connectionString ? neon(connectionString) : null;
export const db = sql ? drizzle(sql) : null;

export const learnings = pgTable("learnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  source: text("source").notNull(),
  url: text("url"),
  title: text("title").notNull(),
  tldr: text("tldr"),
  takeaways: jsonb("takeaways").$type<string[]>(),
  tags: text("tags").array(),
  markdownPath: text("markdown_path"),
  book: text("book"),
});

export type Learning = typeof learnings.$inferSelect;
export type NewLearning = typeof learnings.$inferInsert;
