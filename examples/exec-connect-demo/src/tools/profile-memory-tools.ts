/**
 * Profile and Memory Tools for Agents SDK
 *
 * These tools allow the LLM to explicitly retrieve and store customer data
 * instead of having it pre-injected into the system prompt.
 */

import { tool } from '@openai/agents';
import { z } from 'zod';
import type { ProfileService } from 'twilio-agent-connect';
import { VectorMemoryStore } from '../services/vector-memory.js';
import { EmbeddingsService } from '../services/embeddings.js';
import { CustomerStateStore } from '../services/customer-state.js';

/**
 * Context passed to profile/memory tools
 */
export interface ProfileMemoryToolContext {
  phone: string;
  profileService: ProfileService | undefined;
  vectorDb: VectorMemoryStore;
  embeddings: EmbeddingsService;
  customerState: CustomerStateStore;
}

/**
 * Create retrieve_profile tool for Agents SDK
 */
export function createRetrieveProfileTool(context: ProfileMemoryToolContext) {
  return tool({
    name: 'retrieve_profile',
    description:
      'Get customer CRM data (plan, preferences, account details). Reads from local storage for instant access.',
    parameters: z.object({
      fields: z
        .array(z.string())
        .default([])
        .describe('Specific fields to retrieve. Pass empty array to get all fields (e.g., ["name", "plan"])'),
    }),
    execute: async (input): Promise<string> => {
      console.log('[TOOL] retrieve_profile called', { phone: context.phone, fields: input.fields });

      // Read from CustomerStateStore (instant, application-specific CRM data)
      const crmData = await context.customerState.getState(context.phone);

      // Optionally merge with Segment generic traits (eventual consistency)
      let allTraits = { ...crmData };
      if (context.profileService) {
        try {
          const fields = input.fields.length > 0 ? input.fields : undefined;
          const segmentTraits = await context.profileService.getProfile(context.phone, fields);
          allTraits = { ...segmentTraits, ...crmData }; // CRM data takes precedence
        } catch (error) {
          console.log('[TOOL] retrieve_profile - Segment fetch failed, using CRM data only', error);
        }
      }

      console.log('[TOOL] retrieve_profile result', { traits: allTraits });
      return JSON.stringify({ traits: allTraits });
    },
  });
}

/**
 * Create update_profile tool for Agents SDK
 */
export function createUpdateProfileTool(context: ProfileMemoryToolContext) {
  return tool({
    name: 'update_profile',
    description:
      'Update customer CRM data (plan, preferences, account info). Stores immediately in local database for instant retrieval.',
    parameters: z.object({
      traits_json: z
        .string()
        .describe(
          'JSON string of CRM data to update (e.g., \'{"preferred_name": "John", "plan": "premium"}\')'
        ),
    }),
    execute: async (input): Promise<string> => {
      console.log('[TOOL] update_profile called', { phone: context.phone, traits_json: input.traits_json });

      const traits = JSON.parse(input.traits_json) as Record<string, unknown>;

      // Write to CustomerStateStore (instant access for CRM data)
      await context.customerState.updateState(context.phone, traits);
      console.log('[TOOL] update_profile - saved to local CRM store', { traits });

      // Also send to Segment for analytics/unified profiles (eventual consistency)
      if (context.profileService) {
        try {
          await context.profileService.updateProfile(context.phone, traits);
          console.log('[TOOL] update_profile - synced to Segment');
        } catch (error) {
          console.log('[TOOL] update_profile - Segment sync failed (non-blocking)', error);
        }
      }

      console.log('[TOOL] update_profile success', { traits });
      return JSON.stringify({ success: true });
    },
  });
}

/**
 * Create retrieve_memory tool for Agents SDK
 */
export function createRetrieveMemoryTool(context: ProfileMemoryToolContext) {
  return tool({
    name: 'retrieve_memory',
    description:
      'Retrieve relevant memories using semantic search. Searches past conversations, facts, and context about the customer. Use this to recall previous issues, preferences, or any historical information.',
    parameters: z.object({
      query: z
        .string()
        .describe(
          'Search query describing what you want to find (e.g., "What is their account number?" or "Previous internet outage issues")'
        ),
      top_k: z.number().default(5).describe('Number of memories to return (default: 5)'),
    }),
    execute: async (input): Promise<string> => {
      console.log('[TOOL] retrieve_memory called', { phone: context.phone, query: input.query, top_k: input.top_k });

      const userId = `phone_${context.phone}`;

      // Generate embedding for query
      const queryEmbedding = await context.embeddings.embed(input.query);

      // Search vector DB
      const memories = await context.vectorDb.search(userId, queryEmbedding, input.top_k);

      console.log('[TOOL] retrieve_memory result', { memory_count: memories.length });
      return JSON.stringify({
        memories: memories.map(m => ({
          memory: m.memory,
          type: m.type,
          similarity: m.similarity || 0,
          created_at: m.created_at,
        })),
      });
    },
  });
}

/**
 * Create store_memory tool for Agents SDK
 */
export function createStoreMemoryTool(context: ProfileMemoryToolContext) {
  return tool({
    name: 'store_memory',
    description:
      'Store a new memory about the customer. Use this to remember important facts, preferences, issues, resolutions, or any context that will be useful in future conversations.',
    parameters: z.object({
      memory: z
        .string()
        .describe(
          'The memory to store (e.g., "Customer prefers email over phone" or "Account number is 12345")'
        ),
      type: z
        .string()
        .describe(
          'Memory type for categorization (e.g., "fact", "preference", "issue", "resolution")'
        ),
    }),
    execute: async (input): Promise<string> => {
      console.log('[TOOL] store_memory called', { phone: context.phone, memory: input.memory.substring(0, 50) + '...', type: input.type });

      const userId = `phone_${context.phone}`;

      // Generate embedding for memory
      const embedding = await context.embeddings.embed(input.memory);

      // Store in vector DB
      await context.vectorDb.store(userId, input.memory, input.type, embedding);

      console.log('[TOOL] store_memory success');
      return JSON.stringify({ success: true, message: 'Memory stored successfully' });
    },
  });
}
