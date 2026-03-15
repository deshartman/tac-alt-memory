/**
 * LLM Service for TAC Exec Connect Demo
 *
 * This module provides an LLM service that processes messages with context from TAC memory.
 * It builds enhanced system prompts with customer profile information and conversation history.
 * Uses OpenAI Agents SDK for tool integration and conversation management.
 */

import { Agent, run, setDefaultOpenAIKey, setTracingDisabled } from '@openai/agents';
import type { TAC, ConversationSession, TACMemoryResponse } from 'twilio-agent-connect';
import type { WebSocket } from 'ws';
import {
  getAvailablePlans,
  lookUpOrderPrice,
  lookUpDiscounts,
  lookUpOutage,
  runDiagnostic,
  createConfirmOrderTool,
  createFlexEscalationTool,
  createRetrieveProfileTool,
  createUpdateProfileTool,
  createRetrieveMemoryTool,
  createStoreMemoryTool,
  type ProfileMemoryToolContext,
} from './tools';
import { VectorMemoryStore } from './services/vector-memory.js';
import { EmbeddingsService } from './services/embeddings.js';
import { CustomerStateStore } from './services/customer-state.js';

/**
 * OpenAI ChatCompletion message type (simplified)
 */
interface ChatCompletionMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private readonly baseTools;
  private readonly vectorDb: VectorMemoryStore;
  private readonly embeddings: EmbeddingsService;
  private readonly customerState: CustomerStateStore;

  constructor(private readonly tac: TAC) {
    // Configure OpenAI API key for Agents SDK
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      setDefaultOpenAIKey(openaiApiKey);
    }

    // Disable tracing to avoid ZDR (zero data retention) errors
    setTracingDisabled(true);

    // Initialize storage
    this.vectorDb = new VectorMemoryStore('./memories.db');
    this.embeddings = new EmbeddingsService(openaiApiKey);
    this.customerState = new CustomerStateStore('./customer-state.db');

    // Base tools that don't need context injection
    this.baseTools = [
      getAvailablePlans,
      lookUpOrderPrice,
      lookUpDiscounts,
      lookUpOutage,
      runDiagnostic,
    ];
  }

  /**
   * Process user message with LLM tool-based memory/profile access.
   * Memory and profile data are NOT pre-injected - LLM calls tools explicitly.
   */
  async processMessage(
    userMessage: string,
    _memoryResponse: TACMemoryResponse | null,
    context: ConversationSession,
    websocket: WebSocket | null,
    conversationHistory: ChatCompletionMessageParam[] | null = null
  ): Promise<string> {
    try {
      // Build minimal instructions without pre-injected memory
      const enhancedInstructions = this._buildEnhancedInstructions(context);

      // Get phone number from context
      const phone = context.author_info?.address || '';

      // Create profile/memory tool context
      const profileMemoryContext: ProfileMemoryToolContext = {
        phone,
        profileService: this.tac.getProfileService(),
        vectorDb: this.vectorDb,
        embeddings: this.embeddings,
        customerState: this.customerState,
      };

      // Create context-aware tools dynamically
      const tools = [
        ...this.baseTools,
        createConfirmOrderTool(this.tac, context),
        // Profile and memory tools - LLM calls these explicitly
        createRetrieveProfileTool(profileMemoryContext),
        createUpdateProfileTool(profileMemoryContext),
        createRetrieveMemoryTool(profileMemoryContext),
        createStoreMemoryTool(profileMemoryContext),
        // Conditional voice-only tool
        ...(websocket ? [createFlexEscalationTool(context)] : []),
      ];

      // Create agent with TAC-enhanced instructions
      const agent = new Agent({
        name: 'Owl Internet Customer Service',
        instructions: enhancedInstructions,
        model: 'gpt-4o',
        tools,
      });

      // Use passed conversation history if provided, otherwise empty (LLM retrieves context via tools)
      const messagesHistory = conversationHistory || [];

      // Format conversation history for agent context
      // Exclude the current user message to avoid duplication (it's at the end of the history)
      const previousMessages = messagesHistory.slice(0, -1);

      let agentInput: string;
      if (previousMessages.length > 0) {
        // Format previous messages as context
        const historyLines = previousMessages.map(msg => `${msg.role}: ${msg.content}`);
        const historyContext = historyLines.join('\n');
        agentInput = `[Previous conversation]\n${historyContext}\n\n[Current message]\n${userMessage}`;
      } else {
        // No previous history, just use the current message
        agentInput = userMessage;
      }

      // Run the agent with the message (tools are executed automatically)
      const result = await run(agent, agentInput);

      // Extract response
      return String(result.finalOutput);
    } catch (error) {
      console.error('[LLM] Error processing message:', error);
      return "I'm sorry, I'm having trouble processing your message right now. Please try again.";
    }
  }

  /**
   * Build agent instructions WITHOUT pre-injected memory.
   * LLM uses tools to explicitly retrieve profile/memory data.
   */
  private _buildEnhancedInstructions(context: ConversationSession): string {
    // Build instructions parts
    const instructionParts = [
      "You are Owl Internet's comprehensive customer service assistant.",
      'Your goal is to provide personalized, helpful support by actively retrieving ' +
        "customer information when needed using the tools available to you.",
      '',
      '=== CUSTOMER CONTEXT ===',
      `- Phone: ${context.author_info?.address || 'Unknown'}`,
      `- Channel: ${context.channel}`,
      `- Profile ID: ${context.profile_id || 'N/A'}`,
      '',
      '=== CRITICAL: ALWAYS USE THESE TOOLS ===',
      'You MUST use these tools to access customer data. Data is NOT pre-loaded.',
      '',
      '**FIRST MESSAGE - ALWAYS call retrieve_profile**',
      '  → Call it IMMEDIATELY at the start of ANY conversation',
      '  → Even if you think you don\'t need it, CALL IT',
      '  → This is how you personalize the experience',
      '',
      '**WHEN USER SHARES INFO - ALWAYS call update_profile or store_memory**',
      '  → User mentions plan choice → update_profile with {"plan": "standard"}',
      '  → User mentions name → update_profile with {"name": "John"}',
      '  → User mentions ANY preference → store_memory with type "preference"',
      '  → User shares ANY fact → store_memory with appropriate type',
      '',
      '**WHEN ASKED ABOUT PAST INFO - ALWAYS call retrieve_profile or retrieve_memory**',
      '  → "What plan do I have?" → retrieve_profile (check "plan" field)',
      '  → "What did I say before?" → retrieve_memory with query',
      '  → "What\'s my account number?" → retrieve_profile (check "account_number")',
      '',
      '=== MEMORY & PROFILE TOOLS ===',
      '',
      '**retrieve_profile** - Get stored customer traits from Segment/Memora',
      '  → Returns: {traits: {name: "...", plan: "...", ...}}',
      '  → Call with empty fields array to get all traits',
      '',
      '**update_profile** - Store permanent customer traits',
      '  → Input: traits_json string like \'{"plan": "standard", "name": "John"}\'',
      '  → Use for persistent data: names, plans, account numbers, preferences',
      '',
      '**retrieve_memory** - Search past conversations using semantic search',
      '  → Input: query string describing what to find',
      '  → Returns: list of relevant memories with similarity scores',
      '',
      '**store_memory** - Remember facts from this conversation',
      '  → Input: memory text + type (fact/preference/issue/resolution)',
      '  → Be proactive - store anything useful for future interactions',
      '',
      '=== BEHAVIOR GUIDELINES ===',
      '1. PROACTIVE MEMORY USE (CRITICAL):',
      '   - FIRST message → retrieve_profile (always)',
      '   - User shares info → update_profile or store_memory (always)',
      '   - User asks about past → retrieve_profile or retrieve_memory (always)',
      '   - After helping → store_memory with resolution (always)',
      '',
      '2. COMMUNICATION STYLE:',
      '   - Keep responses clear, concise, and professional',
      '   - Show empathy and understanding of their situation',
      '   - Be helpful and proactive',
      '',
      '3. SERVICE EXCELLENCE:',
      '   - Use tools to provide better service',
      '   - Ask clarifying questions when needed',
      '   - Store learnings for future interactions',
      ''
    ];

    // Add channel-specific formatting instructions
    if (context.channel === 'voice') {
      instructionParts.push(
        '=== IMPORTANT: VOICE/PHONE FORMATTING ===',
        'This conversation is over the PHONE using text-to-speech.',
        '- Use PLAIN TEXT ONLY - no markdown formatting',
        '- Do NOT use asterisks (**bold**), hashtags (#headings), or brackets',
        "- Do NOT use numbered lists (1. 2. 3.) - say 'first, second, third' instead",
        '- Do NOT use bullet points (- or *) - speak naturally',
        '- Speak as you would in a natural phone conversation',
        ''
      );
    } else if (context.channel === 'sms') {
      instructionParts.push(
        '=== SMS FORMATTING ===',
        'This conversation is via SMS text message.',
        '- Use markdown formatting for clarity (bold, lists, etc.)',
        '- Use **bold** for emphasis on important information',
        '- Use numbered lists (1. 2. 3.) for multiple options',
        '- Keep messages concise but well-formatted',
        ''
      );
    }

    return instructionParts.join('\n');
  }

  /**
   * Extract key learnings from conversation for observation storage.
   * Returns concise observation string or null if nothing substantive.
   */
  public extractKeyLearning(
    userMessage: string,
    _aiResponse: string,
    _context: ConversationSession
  ): string | null {
    // Simple heuristic-based extraction
    const lowerMessage = userMessage.toLowerCase();

    // Look for name updates/inquiries
    if (
      lowerMessage.includes('name') ||
      lowerMessage.includes('update') ||
      lowerMessage.includes('change my')
    ) {
      return `Customer requested account information update: ${userMessage.substring(0, 100)}`;
    }

    // Look for plan preferences
    if (lowerMessage.includes('plan') || lowerMessage.includes('upgrade')) {
      return `Customer inquired about internet plans`;
    }

    // Look for technical issues
    if (
      lowerMessage.includes('slow') ||
      lowerMessage.includes('problem') ||
      lowerMessage.includes('issue')
    ) {
      return `Customer reported technical issue: ${userMessage.substring(0, 100)}`;
    }

    // Look for service requests
    if (lowerMessage.includes('need') || lowerMessage.includes('want')) {
      return `Customer expressed need: ${userMessage.substring(0, 100)}`;
    }

    // Look for outage checks
    if (lowerMessage.includes('outage') || lowerMessage.includes('down')) {
      return `Customer checked service status`;
    }

    // Look for diagnostics
    if (lowerMessage.includes('diagnostic') || lowerMessage.includes('router')) {
      return `Customer ran router diagnostics`;
    }

    // Look for pricing inquiries
    if (
      lowerMessage.includes('price') ||
      lowerMessage.includes('cost') ||
      lowerMessage.includes('how much')
    ) {
      return `Customer inquired about pricing`;
    }

    // No substantive learning to store
    return null;
  }

  /**
   * Cleanup resources (close database connections)
   */
  close(): void {
    this.vectorDb.close();
    this.customerState.close();
  }
}
