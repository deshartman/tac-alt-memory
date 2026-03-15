import Database from 'better-sqlite3';

/**
 * Memory entry with vector embedding for semantic search
 */
export interface Memory {
  id: string;
  memory: string;
  type: string;
  similarity?: number;
  created_at: number;
}

/**
 * SQLite-based vector memory store with semantic search
 *
 * Stores customer memories with embeddings for semantic retrieval.
 * Uses cosine similarity for searching related memories.
 */
export class VectorMemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = './memories.db') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        memory TEXT NOT NULL,
        type TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON memories(created_at);
    `);
  }

  /**
   * Store a memory with its embedding
   */
  async store(userId: string, memory: string, type: string, embedding: number[]): Promise<void> {
    const id = `${userId}_${Date.now()}`;
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
    const createdAt = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO memories (id, user_id, memory, type, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, userId, memory, type, embeddingBlob, createdAt);
  }

  /**
   * Search for memories using semantic similarity
   */
  async search(userId: string, queryEmbedding: number[], topK: number = 5): Promise<Memory[]> {
    // Get all user memories
    const rows = this.db
      .prepare(
        `
      SELECT id, memory, type, embedding, created_at
      FROM memories
      WHERE user_id = ?
      ORDER BY created_at DESC
    `
      )
      .all(userId) as Array<{
      id: string;
      memory: string;
      type: string;
      embedding: Buffer;
      created_at: number;
    }>;

    if (rows.length === 0) {
      return [];
    }

    // Calculate cosine similarity for each memory
    const scored = rows.map(row => {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4
      );
      const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding));

      return {
        id: row.id,
        memory: row.memory,
        type: row.type,
        similarity,
        created_at: row.created_at,
      };
    });

    // Sort by similarity and return top K
    return scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, topK);
  }

  /**
   * Get recent memories for a user (without embedding search)
   */
  async getRecent(userId: string, limit: number = 10): Promise<Memory[]> {
    const rows = this.db
      .prepare(
        `
      SELECT id, memory, type, created_at
      FROM memories
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `
      )
      .all(userId, limit) as Array<{
      id: string;
      memory: string;
      type: string;
      created_at: number;
    }>;

    return rows;
  }

  /**
   * Delete all memories for a user
   */
  async clear(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);

  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}
