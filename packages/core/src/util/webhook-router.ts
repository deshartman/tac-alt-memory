import type { TAC } from '../lib/tac';
import type { BaseChannel } from '../channels/base';
import type { ChannelType } from '../types/config';
import {
  type ConversationId,
  type ConversationsWebhookPayload,
  ConversationsWebhookPayloadSchema,
} from '../types/conversation';
import { extractChannelFromWebhook } from './webhooks';

/**
 * Webhook routing result - discriminated union for type safety
 */
export type WebhookRoutingResult = WebhookRoutingSuccess | WebhookRoutingSkip | WebhookRoutingError;

/**
 * Successful routing - webhook should be processed by the returned channel
 */
export interface WebhookRoutingSuccess {
  status: 'success';
  channel: BaseChannel;
  channelType: ChannelType;
  conversationId: string;
  eventType: string;
  shouldProcess: true;
  payload: ConversationsWebhookPayload;
}

/**
 * Skipped routing - webhook acknowledged but not processed (e.g., lifecycle events)
 */
export interface WebhookRoutingSkip {
  status: 'skip';
  reason: string;
  eventType: string;
  conversationId: string | undefined;
  shouldProcess: false;
}

/**
 * Routing error - webhook validation or configuration error
 */
export interface WebhookRoutingError {
  status: 'error';
  error: string;
  errorType: 'validation' | 'unknown_channel' | 'channel_not_registered' | 'internal';
  eventType?: string;
  conversationId?: string;
  channelType?: string;
  shouldProcess: false;
}

/**
 * WebhookRouter - Routes Conversations webhook payloads to appropriate channels
 *
 * Responsibilities:
 * - Validate webhook payload structure with Zod
 * - Extract channel information from various event types
 * - Route lifecycle events to owning channels
 * - Return structured routing decisions
 *
 * NOT responsible for:
 * - HTTP request/response handling
 * - Logging (returns data for caller to log)
 * - Webhook signature validation
 * - Calling channel.processWebhook() (returns target channel)
 *
 * @example
 * ```typescript
 * const router = new WebhookRouter(tac);
 * const result = router.route(webhookPayload);
 *
 * switch (result.status) {
 *   case 'success':
 *     await result.channel.processWebhook(result.payload);
 *     return { status: 'ok' };
 *   case 'skip':
 *     logger.info(result.reason);
 *     return { status: 'ok' };
 *   case 'error':
 *     logger.error(result.error);
 *     return { error: result.error };
 * }
 * ```
 */
export class WebhookRouter {
  constructor(private readonly tac: TAC) {}

  /**
   * Route a webhook payload to the appropriate channel
   *
   * @param payload - Raw webhook payload (unknown type for validation)
   * @returns Structured routing result indicating success, skip, or error
   */
  public route(payload: unknown): WebhookRoutingResult {
    // Step 1: Validate webhook payload structure
    const parseResult = ConversationsWebhookPayloadSchema.safeParse(payload);

    if (!parseResult.success) {
      return {
        status: 'error',
        error: 'Invalid webhook payload structure',
        errorType: 'validation',
        shouldProcess: false,
      };
    }

    const validatedPayload = parseResult.data;
    const webhookData = validatedPayload.data;
    const eventType = validatedPayload.eventType;

    // Step 2: Extract conversation ID (all events have this)
    const conversationId = this.extractConversationId(webhookData);

    // Step 3: Try to extract channel from webhook data
    const channelString = extractChannelFromWebhook(webhookData);

    // Step 4: Handle events without explicit channel information
    if (!channelString) {
      return this.routeLifecycleEvent(validatedPayload, conversationId, eventType);
    }

    // Step 5: Validate channel type
    if (!this.isValidChannelType(channelString)) {
      return {
        status: 'error',
        error: `Unknown channel type: ${channelString}`,
        errorType: 'unknown_channel',
        eventType,
        conversationId,
        channelType: channelString,
        shouldProcess: false,
      };
    }

    // Step 6: Get registered channel
    const targetChannel = this.tac.getChannel(channelString);

    if (!targetChannel) {
      return {
        status: 'error',
        error: `Channel not registered: ${channelString}`,
        errorType: 'channel_not_registered',
        eventType,
        conversationId,
        channelType: channelString,
        shouldProcess: false,
      };
    }

    // Step 7: Success - return channel and routing info
    return {
      status: 'success',
      channel: targetChannel,
      channelType: channelString,
      conversationId,
      eventType,
      shouldProcess: true,
      payload: validatedPayload,
    };
  }

  /**
   * Handle lifecycle events (CONVERSATION_CREATED/UPDATED) that lack channel info
   *
   * Strategy:
   * - Find which channel owns this conversation via isConversationActive()
   * - If found, route to that channel
   * - If not found (e.g., CONVERSATION_CREATED before first message), skip processing
   */
  private routeLifecycleEvent(
    payload: ConversationsWebhookPayload,
    conversationId: string,
    eventType: string
  ): WebhookRoutingResult {
    // Only handle specific lifecycle events
    if (eventType !== 'CONVERSATION_CREATED' && eventType !== 'CONVERSATION_UPDATED') {
      return {
        status: 'skip',
        reason: `Event ${eventType} has no channel information`,
        eventType,
        conversationId,
        shouldProcess: false,
      };
    }

    // Find which channel owns this conversation
    const owningChannel = this.findChannelByConversation(conversationId);

    if (owningChannel) {
      return {
        status: 'success',
        channel: owningChannel,
        channelType: owningChannel.channelType,
        conversationId,
        eventType,
        shouldProcess: true,
        payload,
      };
    }

    // Conversation not yet in any channel - this is normal for CONVERSATION_CREATED
    // before the first COMMUNICATION_CREATED event
    return {
      status: 'skip',
      reason: `Lifecycle event ${eventType} acknowledged (conversation not yet in channel)`,
      eventType,
      conversationId,
      shouldProcess: false,
    };
  }

  /**
   * Find which channel owns a conversation
   */
  private findChannelByConversation(conversationId: string): BaseChannel | undefined {
    const channels = this.tac.getChannels();

    for (const channel of channels) {
      // Cast to ConversationId for branded type compatibility
      if (channel.isConversationActive(conversationId as ConversationId)) {
        return channel;
      }
    }

    return undefined;
  }

  /**
   * Extract conversation ID from webhook data
   */
  private extractConversationId(data: ConversationsWebhookPayload['data']): string {
    // All webhook event types have either conversationId or id field
    return ('conversationId' in data && data.conversationId) || ('id' in data && data.id) || '';
  }

  /**
   * Type guard for valid channel types
   */
  private isValidChannelType(channel: string): channel is ChannelType {
    return channel === 'sms' || channel === 'voice';
  }
}
