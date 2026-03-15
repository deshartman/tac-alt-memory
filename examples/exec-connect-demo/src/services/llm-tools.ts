import type { ProfileService } from 'twilio-agent-connect';
import { VectorMemoryStore } from './vector-memory.js';
import { EmbeddingsService } from './embeddings.js';

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

/**
 * LLM Tool Executor
 *
 * Executes tool calls from LLM with access to ProfileService and VectorMemoryStore.
 * Provides 4 tools: retrieve_profile, update_profile, retrieve_memory, store_memory
 */
export class LLMToolExecutor {
  private readonly profileService: ProfileService | undefined;
  private readonly vectorDb: VectorMemoryStore;
  private readonly embeddings: EmbeddingsService;

  constructor(
    profileService: ProfileService | undefined,
    vectorDb: VectorMemoryStore,
    embeddings: EmbeddingsService
  ) {
    this.profileService = profileService;
    this.vectorDb = vectorDb;
    this.embeddings = embeddings;
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map(tc => this.executeTool(tc)));
  }

  /**
   * Execute a single tool call
   */
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    try {
      let result: unknown;

      switch (toolCall.name) {
        case 'retrieve_profile':
          result = await this.retrieveProfile(toolCall.input);
          break;

        case 'update_profile':
          result = await this.updateProfile(toolCall.input);
          break;

        case 'retrieve_memory':
          result = await this.retrieveMemory(toolCall.input);
          break;

        case 'store_memory':
          result = await this.storeMemory(toolCall.input);
          break;

        default:
          throw new Error(`Unknown tool: ${toolCall.name}`);
      }

      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(result),
      };
    } catch (error) {
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }

  /**
   * Retrieve customer profile traits
   */
  private async retrieveProfile(input: {
    phone: string;
    fields?: string[];
  }): Promise<{ traits: Record<string, unknown> }> {
    if (!this.profileService) {
      return { traits: {} };
    }

    const traits = await this.profileService.getProfile(input.phone, input.fields);
    return { traits };
  }

  /**
   * Update customer profile traits
   */
  private async updateProfile(input: {
    phone: string;
    traits: Record<string, unknown>;
  }): Promise<{ success: boolean }> {
    if (!this.profileService) {
      throw new Error('ProfileService not configured');
    }

    await this.profileService.updateProfile(input.phone, input.traits);
    return { success: true };
  }

  /**
   * Retrieve memories using semantic search
   */
  private async retrieveMemory(input: {
    phone: string;
    query: string;
    top_k?: number;
  }): Promise<{ memories: Array<{ memory: string; type: string; similarity: number }> }> {
    const userId = `phone_${input.phone}`;
    const topK = input.top_k || 5;

    // Generate embedding for query
    const queryEmbedding = await this.embeddings.embed(input.query);

    // Search vector DB
    const memories = await this.vectorDb.search(userId, queryEmbedding, topK);

    return {
      memories: memories.map(m => ({
        memory: m.memory,
        type: m.type,
        similarity: m.similarity || 0,
      })),
    };
  }

  /**
   * Store a new memory
   */
  private async storeMemory(input: {
    phone: string;
    memory: string;
    type: string;
  }): Promise<{ success: boolean }> {
    const userId = `phone_${input.phone}`;

    // Generate embedding for memory
    const embedding = await this.embeddings.embed(input.memory);

    // Store in vector DB
    await this.vectorDb.store(userId, input.memory, input.type, embedding);

    return { success: true };
  }
}

/**
 * Tool definitions for OpenAI function calling
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'retrieve_profile',
      description:
        'Get customer profile traits from Segment or Memora. Phone number is available from callback context.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Customer phone number (from conversation context)',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: specific trait fields to retrieve',
          },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_profile',
      description: 'Update customer profile traits in Segment or Memora',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Customer phone number',
          },
          traits: {
            type: 'object',
            description:
              'Profile traits to update (e.g., {"preferred_name": "John", "plan": "premium"})',
          },
        },
        required: ['phone', 'traits'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'retrieve_memory',
      description:
        'Retrieve relevant memories using semantic search. Searches past conversations and facts about the customer.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Customer phone number',
          },
          query: {
            type: 'string',
            description:
              'Search query (e.g., "What is their account number?" or "Previous issues")',
          },
          top_k: {
            type: 'number',
            description: 'Number of memories to return (default: 5)',
          },
        },
        required: ['phone', 'query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'store_memory',
      description:
        'Store a new memory about the customer. Use this to remember important facts, preferences, or conversation context.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Customer phone number',
          },
          memory: {
            type: 'string',
            description:
              'The memory to store (e.g., "Customer prefers email over phone" or "Account number: 12345")',
          },
          type: {
            type: 'string',
            description: 'Memory type (e.g., "fact", "preference", "issue", "resolution")',
          },
        },
        required: ['phone', 'memory', 'type'],
      },
    },
  },
];
