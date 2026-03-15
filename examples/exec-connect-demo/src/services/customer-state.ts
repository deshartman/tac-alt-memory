import Database from 'better-sqlite3';

/**
 * Application-specific customer state for Owl Internet
 *
 * This stores CRM-level data specific to THIS application (plan choices, preferences, etc.)
 * Different LLM implementations would have their own state structure.
 */
export class CustomerStateStore {
  private db: Database.Database;

  constructor(dbPath: string = './customer-state.db') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Initialize database schema for Owl Internet CRM data
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customer_state (
        phone TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Get customer state (plan, preferences, etc.)
   */
  async getState(phone: string): Promise<Record<string, unknown>> {
    const row = this.db
      .prepare('SELECT state FROM customer_state WHERE phone = ?')
      .get(phone) as { state: string } | undefined;

    if (!row) {
      return {};
    }

    try {
      return JSON.parse(row.state) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Update customer state (merge with existing)
   */
  async updateState(phone: string, updates: Record<string, unknown>): Promise<void> {
    const existingState = await this.getState(phone);
    const mergedState = { ...existingState, ...updates };
    const stateJson = JSON.stringify(mergedState);
    const updatedAt = Date.now();

    // Upsert: insert or replace if exists
    this.db
      .prepare(
        `
      INSERT INTO customer_state (phone, state, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at
    `
      )
      .run(phone, stateJson, updatedAt);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
