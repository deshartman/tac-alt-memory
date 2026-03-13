import { z } from 'zod';
import {
  ConversationSession,
  ChannelType,
  ConversationId,
  ProfileId,
  ConversationsWebhookPayload,
  ConversationsWebhookPayloadSchema,
  CommunicationWebhookPayload,
  ConversationWebhookPayload,
  ParticipantWebhookPayload,
  isConversationId,
  isProfileId,
} from '../types/index';
import { TACConfig } from '../lib/config';
import { ConversationClient } from '../clients/conversation';
import { Logger } from '../lib/logger';
import type { TAC } from '../lib/tac';

/**
 * Base channel event callbacks
 */
export interface BaseChannelEvents {
  onConversationStarted?: (data: { session: ConversationSession }) => void;
  onConversationEnded?: (data: { session: ConversationSession }) => Promise<void> | void;
  onError?: (data: { error: Error; context?: Record<string, unknown> }) => void;
}

/**
 * Abstract base class for all channel implementations
 *
 * Provides common functionality for conversation lifecycle management,
 * session tracking, and shared utilities across different channel types.
 */
export abstract class BaseChannel {
  protected readonly tac: TAC;
  protected readonly config: TACConfig;
  protected readonly logger: Logger;
  protected readonly conversationClient: ConversationClient;
  protected readonly activeConversations: Map<ConversationId, ConversationSession>;
  protected readonly callbacks: BaseChannelEvents;

  constructor(tac: TAC) {
    this.tac = tac;
    this.config = tac.getConfig();
    this.logger = tac.logger.child({ component: 'channel' });
    this.conversationClient = new ConversationClient(this.config);
    this.activeConversations = new Map();
    this.callbacks = {};
  }

  /**
   * Get the channel type (implemented by subclasses)
   */
  public abstract get channelType(): ChannelType;

  /**
   * Register event callbacks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public on(event: string, callback: (...args: any[]) => void): void {
    switch (event) {
      case 'conversationStarted':
        this.callbacks.onConversationStarted = callback;
        break;
      case 'conversationEnded':
        this.callbacks.onConversationEnded = callback;
        break;
      case 'error':
        this.callbacks.onError = callback;
        break;
    }
  }

  /**
   * Process incoming webhook data (implemented by subclasses)
   */
  public abstract processWebhook(payload: unknown): Promise<void>;

  /**
   * Process Conversations webhook
   * This is the default implementation that handles standard Conversations events.
   * Channels can override to add channel-specific behavior.
   */
  public async processConversationsWebhook(payload: unknown): Promise<void> {
    this.logger.debug(
      { operation: 'conversations_webhook_processing', payload },
      'Processing Conversations webhook'
    );

    try {
      const validationResult = this.validateConversationsWebhookPayload(payload);

      if (!validationResult.success) {
        this.logger.error(
          {
            validation_errors: validationResult.error.errors,
            payload,
            operation: 'conversations_webhook_validation',
          },
          'Invalid Conversations webhook payload'
        );
        throw new Error('Invalid Conversations webhook payload');
      }

      // TypeScript now knows payload is ConversationsWebhookPayload
      const webhookData = validationResult.data;
      const eventType = webhookData.eventType;
      const conversationId = webhookData.data.conversationId ?? webhookData.data.id;

      this.logger.info(
        {
          event_type: eventType,
          conversation_id: conversationId,
          channel: this.channelType,
        },
        'Processing Conversations webhook event'
      );

      switch (eventType) {
        case 'CONVERSATION_CREATED':
          this.handleConversationCreated(webhookData);
          break;

        case 'PARTICIPANT_ADDED':
          this.handleParticipantAdded(webhookData);
          break;

        case 'PARTICIPANT_UPDATED':
          this.handleParticipantUpdated(webhookData);
          break;

        case 'PARTICIPANT_REMOVED':
          this.handleParticipantRemoved(webhookData);
          break;

        case 'COMMUNICATION_CREATED':
          await this.handleCommunicationCreated(webhookData);
          break;

        case 'COMMUNICATION_UPDATED':
          await this.handleCommunicationUpdated(webhookData);
          break;

        case 'CONVERSATION_UPDATED':
          await this.handleConversationUpdated(webhookData);
          break;

        default: {
          // TypeScript exhaustiveness check ensures all cases are handled
          this.logger.warn(
            {
              event_type: eventType,
              conversation_id: conversationId,
              channel: this.channelType,
            },
            'Unhandled Conversations event type'
          );
          break;
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'conversations_webhook_processing' },
        'Conversations webhook processing error'
      );
      this.handleError(error instanceof Error ? error : new Error(String(error)), { payload });
    }
  }

  /**
   * Validate Conversations webhook payload structure using Zod schema
   * Returns parse result with success flag and either data or error details
   */
  protected validateConversationsWebhookPayload(
    payload: unknown
  ): { success: true; data: ConversationsWebhookPayload } | { success: false; error: z.ZodError } {
    if (!this.validateWebhookPayload(payload)) {
      // Return a Zod error for consistency
      return {
        success: false,
        error: new z.ZodError([
          {
            code: 'invalid_type',
            expected: 'object',
            received: typeof payload,
            path: [],
            message: 'Payload is null or undefined',
          },
        ]),
      };
    }

    return ConversationsWebhookPayloadSchema.safeParse(payload);
  }

  /**
   * Handle CONVERSATION_CREATED event
   */
  protected handleConversationCreated(payload: ConversationWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in CONVERSATION_CREATED event');
    }

    this.startConversation(conversationId, profileId ?? undefined, payload.data.serviceId);
  }

  /**
   * Handle PARTICIPANT_ADDED event
   */
  protected handleParticipantAdded(payload: ParticipantWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in PARTICIPANT_ADDED event');
    }

    // Update or initialize conversation
    if (this.isConversationActive(conversationId)) {
      const session = this.getConversationSession(conversationId);
      if (session && profileId) {
        session.profile_id = profileId;
      }
      if (session && payload.data.serviceId) {
        session.service_id = payload.data.serviceId;
      }
    } else {
      this.startConversation(conversationId, profileId ?? undefined, payload.data.serviceId);
    }
  }

  /**
   * Handle PARTICIPANT_UPDATED event
   */
  protected handleParticipantUpdated(payload: ParticipantWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in PARTICIPANT_UPDATED event');
    }

    this.logger.debug(
      { conversation_id: conversationId, participant_type: payload.data.participantType },
      'Participant updated'
    );
  }

  /**
   * Handle PARTICIPANT_REMOVED event
   */
  protected handleParticipantRemoved(payload: ParticipantWebhookPayload): void {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in PARTICIPANT_REMOVED event');
    }

    this.logger.info(
      { conversation_id: conversationId, participant_type: payload.data.participantType },
      'Participant removed from conversation'
    );
  }

  /**
   * Handle COMMUNICATION_CREATED event
   * Override in channel-specific classes to add message handling logic
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Base implementation is synchronous, but subclasses may need async
  protected async handleCommunicationCreated(payload: CommunicationWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in COMMUNICATION_CREATED event');
    }

    // Initialize conversation if needed
    if (!this.isConversationActive(conversationId)) {
      const profileId = this.extractProfileId(payload);
      this.startConversation(conversationId, profileId ?? undefined, payload.data.serviceId);
    }

    // Channels override this to add message-specific logic
  }

  /**
   * Handle COMMUNICATION_UPDATED event
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Base implementation is synchronous, but subclasses may need async
  protected async handleCommunicationUpdated(payload: CommunicationWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in COMMUNICATION_UPDATED event');
    }

    this.logger.debug(
      { conversation_id: conversationId, communication_id: payload.data.id },
      'Communication updated'
    );
  }

  /**
   * Handle CONVERSATION_UPDATED event
   */
  protected async handleConversationUpdated(payload: ConversationWebhookPayload): Promise<void> {
    const conversationId = this.extractConversationId(payload);

    if (!conversationId) {
      throw new Error('Missing conversation ID in CONVERSATION_UPDATED event');
    }

    // Check if conversation is closed
    if (payload.data.status === 'CLOSED') {
      this.logger.info(
        { conversation_id: conversationId, status: payload.data.status },
        'Conversation closed by Conversations Service'
      );
      await this.endConversation(conversationId);
    }
  }

  /**
   * Send a response back to the user (implemented by subclasses)
   */
  public abstract sendResponse(
    conversationId: ConversationId,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Start a new conversation session
   */
  protected startConversation(
    conversationId: ConversationId,
    profileId?: ProfileId,
    serviceId?: string
  ): ConversationSession {
    if (this.activeConversations.has(conversationId)) {
      this.logger.debug(
        {
          conversation_id: conversationId,
          profile_id: this.activeConversations.get(conversationId)?.profile_id,
          service_id: this.activeConversations.get(conversationId)?.service_id,
        },
        'Conversation already active'
      );
      return this.activeConversations.get(conversationId)!;
    }

    const session: ConversationSession = {
      conversation_id: conversationId,
      profile_id: profileId,
      service_id: serviceId,
      channel: this.channelType,
      started_at: new Date(),
      metadata: {},
    };

    this.activeConversations.set(conversationId, session);

    this.logger.debug(
      {
        conversation_id: conversationId,
        profile_id: profileId,
        service_id: serviceId,
        channel: this.channelType,
      },
      'Conversation started'
    );

    if (this.callbacks.onConversationStarted) {
      this.callbacks.onConversationStarted({ session });
    }

    return session;
  }

  /**
   * End a conversation session.
   *
   * Triggers the onConversationEnded callback BEFORE removing the session,
   * so the callback receives the full ConversationSession data.
   * Errors in the callback do not prevent session cleanup.
   */
  protected async endConversation(conversationId: ConversationId): Promise<void> {
    const session = this.activeConversations.get(conversationId);

    if (session) {
      // Trigger callback BEFORE deleting the session
      if (this.callbacks.onConversationEnded) {
        try {
          await this.callbacks.onConversationEnded({ session });
        } catch (error) {
          this.logger.error(
            { err: error, conversation_id: conversationId },
            'Error in conversation ended callback'
          );
        }
      }

      this.activeConversations.delete(conversationId);
      this.logger.debug(
        {
          conversation_id: conversationId,
          channel: this.channelType,
          service_id: session.service_id,
        },
        'Conversation ended'
      );
    } else {
      this.logger.debug(
        { conversation_id: conversationId, channel: this.channelType },
        'Conversation end requested but no active session found'
      );
    }
  }

  /**
   * Get an active conversation session
   */
  public getConversationSession(conversationId: ConversationId): ConversationSession | undefined {
    return this.activeConversations.get(conversationId);
  }

  /**
   * Check if a conversation is active
   */
  public isConversationActive(conversationId: ConversationId): boolean {
    return this.activeConversations.has(conversationId);
  }

  /**
   * Handle errors with proper context
   */
  protected handleError(error: Error, context?: Record<string, unknown>): void {
    this.logger.error({ err: error, ...context }, 'Channel error');

    if (this.callbacks.onError) {
      if (context) {
        this.callbacks.onError({ error, context });
      } else {
        this.callbacks.onError({ error });
      }
    }
  }

  /**
   * Validate webhook payload (override in subclasses for specific validation)
   */
  protected validateWebhookPayload(payload: unknown): boolean {
    return payload !== null && payload !== undefined;
  }

  /**
   * Extract conversation ID from Conversations webhook payload
   */
  protected extractConversationId(payload: unknown): ConversationId | null {
    const validationResult = this.validateConversationsWebhookPayload(payload);

    if (!validationResult.success) {
      return null;
    }

    const conversationId =
      validationResult.data.data.conversationId || validationResult.data.data.id;

    if (conversationId && typeof conversationId === 'string' && isConversationId(conversationId)) {
      return conversationId;
    }

    return null;
  }

  /**
   * Extract profile ID from Conversations webhook payload
   */
  protected extractProfileId(payload: unknown): ProfileId | null {
    const validationResult = this.validateConversationsWebhookPayload(payload);

    if (!validationResult.success) {
      return null;
    }

    const profileId = validationResult.data.data.profileId;

    if (profileId && typeof profileId === 'string' && isProfileId(profileId)) {
      return profileId;
    }

    return null;
  }

  /**
   * Cleanup resources when shutting down
   */
  public shutdown(): void {
    this.activeConversations.clear();
    delete this.callbacks.onConversationStarted;
    delete this.callbacks.onConversationEnded;
    delete this.callbacks.onError;
  }
}
