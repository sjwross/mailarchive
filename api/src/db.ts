import pg from "pg";

const { Pool } = pg;

// Parse DATABASE_URL or use individual params
function getDbConfig() {
  const url = process.env.DATABASE_URL;
  if (url && !url.includes("://")) {
    // Already parsed or using individual env vars
    return {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || "mailarchive",
      user: process.env.DB_USER || "mailarchive",
      password: process.env.DB_PASSWORD || "mailarchive",
      max: 10,
    };
  }
  // Try to parse URL, but fallback to individual params if parsing fails
  try {
    const parsed = new URL(url || "");
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 5432,
      database: parsed.pathname.slice(1) || "mailarchive",
      user: parsed.username || "mailarchive",
      password: parsed.password || "mailarchive",
      max: 10,
    };
  } catch {
    return {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || "mailarchive",
      user: process.env.DB_USER || "mailarchive",
      password: process.env.DB_PASSWORD || "mailarchive",
      max: 10,
    };
  }
}

export const db = new Pool(getDbConfig());

export type User = {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
};

export type Connection = {
  id: string;
  user_id: string;
  provider: string;
  config_encrypted: string | null;
  created_at: Date;
};

export type Rule = {
  id: string;
  user_id: string;
  name: string;
  age_threshold_days: number;
  folder_ids: string[];
  safety_mode: "archive_only" | "archive_move" | "archive_delete";
  schedule: "manual" | "daily" | "weekly";
  created_at: Date;
};
