import OpenAI from 'openai';

/**
 * OpenAI embeddings service
 *
 * Generates vector embeddings for semantic search using OpenAI's API.
 * Uses text-embedding-3-small model for cost-effective, high-quality embeddings.
 */
export class EmbeddingsService {
  private readonly openai: OpenAI;
  private readonly model: string = 'text-embedding-3-small';

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate embedding for a single text string
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text,
      });

      const embedding = response.data[0]?.embedding;

      if (!embedding) {
        throw new Error('No embedding returned from OpenAI');
      }

      return embedding;
    } catch (error) {
      throw new Error(
        `Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate embeddings for multiple text strings
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts,
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      throw new Error(
        `Failed to generate batch embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
