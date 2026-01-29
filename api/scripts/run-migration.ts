import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const db = new Pool({
  host: "localhost",
  port: 5432,
  database: "mailarchive",
  user: "mailarchive",
  password: "mailarchive",
});

async function runMigration() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    
    // Check if migration table exists
    const migrationTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'pgmigrations'
      );
    `);
    
    if (!migrationTableExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE pgmigrations (
          name VARCHAR(100) PRIMARY KEY,
          run_on TIMESTAMP NOT NULL
        );
      `);
    }
    
    // Initial schema migration (idempotent)
    const migrationRan = await client.query(
      "SELECT name FROM pgmigrations WHERE name = $1",
      ["1738012800000_create-initial-tables"]
    );
    
    if (migrationRan.rows.length === 0) {
      await client.query(`
        CREATE TABLE mailarchive_users (
          id VARCHAR(22) PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      
      await client.query(`
        CREATE TABLE mailarchive_connections (
          id VARCHAR(22) PRIMARY KEY,
          user_id VARCHAR(22) NOT NULL REFERENCES mailarchive_users(id) ON DELETE CASCADE,
          provider VARCHAR(50) NOT NULL,
          config_encrypted TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      
      await client.query(`
        CREATE INDEX ON mailarchive_connections(user_id);
      `);
      
      await client.query(`
        CREATE TABLE mailarchive_rules (
          id VARCHAR(22) PRIMARY KEY,
          user_id VARCHAR(22) NOT NULL REFERENCES mailarchive_users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          age_threshold_days INTEGER NOT NULL,
          folder_ids JSONB NOT NULL DEFAULT '[]',
          safety_mode VARCHAR(20) NOT NULL,
          schedule VARCHAR(20) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      
      await client.query(`
        CREATE INDEX ON mailarchive_rules(user_id);
      `);
      
      await client.query(
        "INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())",
        ["1738012800000_create-initial-tables"]
      );
    }

    // Ensure new columns exist (idempotent)
    const lastRunCol = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns 
        WHERE table_schema = 'public'
          AND table_name = 'mailarchive_rules'
          AND column_name = 'last_run_at'
      );
    `);

    if (!lastRunCol.rows[0].exists) {
      await client.query(`ALTER TABLE mailarchive_rules ADD COLUMN last_run_at TIMESTAMPTZ;`);
    }

    const maxPerRunCol = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'mailarchive_rules'
          AND column_name = 'max_per_run'
      );
    `);
    if (!maxPerRunCol.rows[0].exists) {
      await client.query(`ALTER TABLE mailarchive_rules ADD COLUMN max_per_run INTEGER NOT NULL DEFAULT 50;`);
    }

    await client.query("COMMIT");
    console.log("Migration completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
