import Twilio from 'twilio';
import {
  ChannelType,
  ConversationId,
  ProfileId,
  CommunicationWebhookPayload,
} from '../types/index';
import { BaseChannel, BaseChannelEvents } from './base';
import type { TAC } from '../lib/tac';

/**
 * SMS channel event callbacks extending base callbacks
 */
export interface SMSChannelEvents extends BaseChannelEvents {
  onMessageReceived?: (data: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Memory structure is dynamic and defined by user
    userMemory: any;
  }) => void;
}

/**
 * SMS Channel implementation for Twilio Conversations Service
 *
 * Handles SMS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 */
export class SMSChannel extends BaseChannel {
  private readonly twilioClient: ReturnType<typeof Twilio>;
  private readonly smsCallbacks: SMSChannelEvents;

  constructor(tac: TAC) {
    super(tac);
    this.twilioClient = Twilio(this.config.twilioAccountSid, this.config.twilioAuthToken);
    this.smsCallbacks = {};
  }

  public get channelType(): ChannelType {
    return 'sms';
  }

  /**
   * Register event callbacks (override for SMS-specific events)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic event callback needs to accept any args
  public override on(event: string, callback: (...args: any[]) => void): void {
    if (event === 'messageReceived') {
      this.smsCallbacks.onMessageReceived = callback;
    } else {
      // Delegate to parent for base events
      super.on(event, callback);
    }
  }

  /**
   * Process SMS webhook - delegates to Conversations webhook handler
   */
  public async processWebhook(payload: unknown): Promise<void> {
    // Delegate to base class Conversations webhook handler
    await this.processConversationsWebhook(payload);
  }

  /**
   * Handle COMMUNICATION_CREATED with SMS-specific logic
   * Override from base class to add message processing
   */
  protected override async handleCommunicationCreated(
    payload: CommunicationWebhookPayload
  ): Promise<void> {
    // Call parent to handle base logic (conversation initialization)
    await super.handleCommunicationCreated(payload);
    const conversationId = this.extractConversationId(payload);
    const profileId = this.extractProfileId(payload);
    const message = payload.data.content.text.trim();
    const author = payload.data.author.address || 'unknown';

    if (!conversationId || !message) {
      return;
    }

    // Filter out messages from AI agent
    if (author === this.config.twilioPhoneNumber) {
      this.logger.info({ conversation_id: conversationId }, 'Ignoring message from AI agent');
      return;
    }

    // Get session and update author info
    const session = this.getConversationSession(conversationId);
    if (session) {
      session.author_info = {
        address: author,
        participant_id: payload.data.author.participantId,
      };
    }

    // Retrieve user memory
    let userMemory;
    if (session && this.tac.isMemoryEnabled()) {
      try {
        userMemory = await this.tac.retrieveMemory(session, message);
      } catch (error) {
        this.logger.warn(
          { err: error, conversation_id: conversationId },
          'Failed to retrieve memory'
        );
      }
    }

    // Invoke message received callback
    if (this.smsCallbacks.onMessageReceived) {
      this.smsCallbacks.onMessageReceived({
        conversationId,
        profileId: profileId ?? undefined,
        message,
        author,
        userMemory,
      });
    }
  }

  /**
   * Send SMS response using Twilio Messages API
   * Note: This is a workaround until Conversations Service supports sending messages
   */
  public async sendResponse(
    conversationId: ConversationId,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.logger.debug(
      {
        conversation_id: conversationId,
        message_length: message.length,
        operation: 'send_response',
      },
      'Sending SMS response'
    );

    try {
      const session = this.getConversationSession(conversationId);

      if (!session) {
        throw new Error(`No active session found for conversation ${conversationId}`);
      }

      // TODO: Temporary workaround until Conversations Service supports direct message sending.
      // Replace with proper Conversations Service API when available.
      // Defensively go from conversation_id -> participant -> address -> phone number
      try {
        this.logger.debug(
          { conversation_id: conversationId },
          'Listing participants for conversation'
        );
        const participants = await this.conversationClient.listParticipants(conversationId);

        this.logger.debug(
          {
            conversation_id: conversationId,
            participant_count: participants.length,
            service_id: session.service_id ?? this.config.conversationServiceId,
          },
          'Found participants'
        );

        let messagesSent = 0;
        for (const participant of participants) {
          if (participant.type !== 'CUSTOMER') {
            this.logger.debug(
              { participant_type: participant.type },
              'Skipping non-customer participant'
            );
            continue;
          }

          // Check addresses array (Conversations Service API format)
          const addresses = participant.addresses || [];
          this.logger.debug(
            { addresses_count: addresses.length },
            'Checking participant addresses'
          );

          for (const addr of addresses) {
            if (addr.channel !== 'SMS') {
              this.logger.debug({ channel: addr.channel }, 'Skipping non-SMS address');
              continue;
            }

            this.logger.debug(
              { to_address: addr.address, from_number: this.config.twilioPhoneNumber },
              'Sending SMS'
            );

            await this.twilioClient.messages.create({
              to: addr.address,
              from: this.config.twilioPhoneNumber,
              body: message,
            });

            this.logger.info(
              { conversation_id: conversationId, to_address: addr.address },
              'SMS sent successfully'
            );
            messagesSent++;
          }
        }

        if (messagesSent === 0) {
          this.logger.warn(
            { conversation_id: conversationId },
            'No SMS addresses found for any CUSTOMER participants'
          );
        }
      } catch (error) {
        this.logger.error(
          { err: error, conversation_id: conversationId },
          'Failed to list participants'
        );
        throw error;
      }
    } catch (error) {
      this.logger.error({ err: error, conversation_id: conversationId }, 'Send response error');
      this.handleError(error instanceof Error ? error : new Error(String(error)), {
        conversationId,
        message,
        metadata,
      });
      throw error;
    }
  }
}
