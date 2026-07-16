import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.resolve(process.cwd(), 'server/data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'churn_dashboard.db');

export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', DB_PATH);
  }
});

// Helper wrapper functions for Promisified DB access
export const dbRun = (sql: string, params: any[] = []): Promise<{ lastID?: number; changes?: number }> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbAll = <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

export const dbGet = <T = any>(sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
};

// Initialize schema
export async function initSchema(): Promise<void> {
  // Enable foreign keys
  await dbRun('PRAGMA foreign_keys = ON;');

  // Create merchants table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS merchants (
      merchant_id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      industry_vertical TEXT NOT NULL,
      pricing_tier TEXT NOT NULL,
      signup_date TEXT NOT NULL,
      current_status TEXT NOT NULL CHECK(current_status IN ('Active', 'Churned', 'Suspended'))
    )
  `);

  // Create transaction_summary_daily table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS transaction_summary_daily (
      summary_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      transaction_volume_usd REAL NOT NULL,
      transaction_count INTEGER NOT NULL,
      failed_transaction_count INTEGER NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE
    )
  `);

  // Create support_tickets table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      created_date TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
      ticket_status TEXT NOT NULL CHECK(ticket_status IN ('OPEN', 'PENDING', 'CLOSED')),
      category TEXT NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE
    )
  `);

  // Create risk_history table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS risk_history (
      history_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      calculated_date TEXT NOT NULL,
      risk_score REAL NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('Low', 'Medium', 'High')),
      primary_driver TEXT NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE
    )
  `);

  // Create audit_actions table (for tracking CSM recommendations executed)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit_actions (
      action_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_description TEXT NOT NULL,
      executed_at TEXT NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE
    )
  `);

  console.log('Database schema successfully initialized.');
}
