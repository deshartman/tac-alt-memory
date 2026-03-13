import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SMSChannel, TAC, ConversationSession } from '@twilio/tac-core';

vi.mock('twilio', () => {
  const createClient = vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ sid: 'SM00000000000000000000000000000000' }),
    },
  }));

  return {
    default: createClient,
  };
});

describe('SMS Channel', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    apiKey: 'SKtest_api_key',
    apiToken: 'test_api_token',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
  });

  let channel: SMSChannel;
  let tac: TAC;

  beforeEach(() => {
    tac = new TAC({ config: getTestConfig() });
    channel = new SMSChannel(tac);
  });

  describe('initialization', () => {
    it('should create SMS channel with config', () => {
      expect(channel).toBeInstanceOf(SMSChannel);
      expect(channel.channelType).toBe('sms');
    });

    it('should start with no active conversations', () => {
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });
  });

  describe('webhook processing', () => {
    it('should process conversation.created event', async () => {
      const webhookPayload = {
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
          profileId: 'test_profile_123',
        },
      };

      await expect(channel.processWebhook(webhookPayload)).resolves.not.toThrow();

      // Should have started a conversation
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
    });

    it('should process communication.created event', async () => {
      let capturedMessage: any = null;

      // Set up message received callback
      channel.on('messageReceived', data => {
        capturedMessage = data;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          id: 'CMtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          content: {
            type: 'TEXT',
            text: 'Hello world',
          },
          author: {
            address: '+15559876543', // Different from twilioPhoneNumber
            channel: 'SMS',
          },
          recipients: [],
        },
      };

      await channel.processWebhook(webhookPayload);

      // Wait a tick for callback to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should have triggered message callback
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.conversationId).toBe('CHtest123456789');
      expect(capturedMessage.message).toBe('Hello world');
      expect(capturedMessage.author).toBe('+15559876543');
    });

    it('should skip events with unexpected eventType format', async () => {
      const callback = vi.fn();
      channel.on('messageReceived', callback);

      await channel.processWebhook({
        eventType: 'communication.created', // already normalized format — not a valid Conversations event
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should process conversation.updated event (close)', async () => {
      // First add a conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      // Then close it
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
          status: 'CLOSED',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should ignore empty messages', async () => {
      let messageReceived = false;

      channel.on('messageReceived', () => {
        messageReceived = true;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          id: 'CMtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          content: {
            type: 'TEXT',
            text: '', // Empty message
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
          recipients: [],
        },
      };

      await channel.processWebhook(webhookPayload);

      // Should not have triggered callback for empty message
      expect(messageReceived).toBe(false);
    });

    it('should auto-initialize conversation on first message', async () => {
      let capturedMessage: any = null;

      channel.on('messageReceived', data => {
        capturedMessage = data;
      });

      const webhookPayload = {
        eventType: 'COMMUNICATION_CREATED',
        data: {
          id: 'CMtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          content: {
            type: 'TEXT',
            text: 'First message',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
          recipients: [],
        },
      };

      // Conversation not active initially
      expect(channel.isConversationActive('CHtest123456789')).toBe(false);

      await channel.processWebhook(webhookPayload);

      // Should auto-initialize and process message
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.message).toBe('First message');
    });
  });

  describe('participant address', () => {
    it('should create SMS participant address', () => {
      const address = { channel: 'SMS' as const, address: '+15551234567' };

      expect(address.channel).toBe('SMS');
      expect(address.address).toBe('+15551234567');
    });
  });

  describe('conversation management', () => {
    it('should track multiple active conversations', async () => {
      // Add multiple conversations
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest987654321',
          conversationId: 'CHtest987654321',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      expect(channel.isConversationActive('CHtest987654321')).toBe(true);
    });
  });

  describe('conversation ended callback', () => {
    it('should fire onConversationEnded callback with full session on close', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      // Start conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789', profileId: 'test_profile_123' },
      });

      // Close conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversation_id).toBe('CHtest123456789');
      expect(captured[0].channel).toBe('sms');
    });

    it('should still clean up session if callback throws', async () => {
      tac.onConversationEnded(() => {
        throw new Error('boom');
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789' },
      });
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);

      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789', status: 'CLOSED' },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });

    it('should support async callback', async () => {
      const captured: ConversationSession[] = [];

      tac.onConversationEnded(async ({ session }) => {
        captured.push(session);
      });
      tac.registerChannel(channel);

      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789' },
      });
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789', status: 'CLOSED' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].conversation_id).toBe('CHtest123456789');
    });

    it('should clean up silently when no callback is registered', async () => {
      // No callback registered — should not throw
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789' },
      });
      await channel.processWebhook({
        eventType: 'CONVERSATION_UPDATED',
        data: { id: 'CHtest123456789', conversationId: 'CHtest123456789', accountId: 'ACtest123456789', configurationId: 'CFtest123456789', status: 'CLOSED' },
      });

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);
    });
  });

  describe('participant events', () => {
    it('should process PARTICIPANT_ADDED event and initialize conversation', async () => {
      const webhookPayload = {
        eventType: 'PARTICIPANT_ADDED',
        data: {
          id: 'PAtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          name: 'Test Customer',
          profileId: 'profile_456',
          serviceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd',
          type: 'CUSTOMER',
          addresses: [
            {
              channel: 'SMS',
              address: '+15559876543',
            },
          ],
        },
      };

      expect(channel.isConversationActive('CHtest123456789')).toBe(false);

      await channel.processWebhook(webhookPayload);

      // Should initialize conversation with profile ID
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
      const session = channel.getConversationSession('CHtest123456789');
      expect(session?.profile_id).toBe('profile_456');
      expect(session?.service_id).toBe('comms_service_01kbjqhn79f0fvwfsxqzd5nqhd');
    });

    it('should process PARTICIPANT_ADDED event and update existing conversation', async () => {
      // First create conversation without profile
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      expect(channel.getConversationSession('CHtest123456789')?.profile_id).toBeUndefined();

      // Add participant with profile
      await channel.processWebhook({
        eventType: 'PARTICIPANT_ADDED',
        data: {
          id: 'PAtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          name: 'Test Customer',
          profileId: 'profile_789',
          type: 'CUSTOMER',
          addresses: [
            {
              channel: 'SMS',
              address: '+15559876543',
            },
          ],
        },
      });

      // Should update profile_id
      expect(channel.getConversationSession('CHtest123456789')?.profile_id).toBe('profile_789');
    });

    it('should process PARTICIPANT_UPDATED event', async () => {
      // First create conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      // Update participant
      await expect(
        channel.processWebhook({
          eventType: 'PARTICIPANT_UPDATED',
          data: {
            id: 'PAtest123456789',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            name: 'Updated Name',
            participantType: 'CUSTOMER',
            addresses: [
              {
                channel: 'SMS',
                address: '+15559876543',
              },
            ],
          },
        })
      ).resolves.not.toThrow();
    });

    it('should process PARTICIPANT_REMOVED event', async () => {
      // First create conversation
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      // Remove participant (should log but not end conversation)
      await expect(
        channel.processWebhook({
          eventType: 'PARTICIPANT_REMOVED',
          data: {
            id: 'PAtest123456789',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            name: 'Test Customer',
            participantType: 'CUSTOMER',
            addresses: [
              {
                channel: 'SMS',
                address: '+15559876543',
              },
            ],
          },
        })
      ).resolves.not.toThrow();

      // Conversation should still be active
      expect(channel.isConversationActive('CHtest123456789')).toBe(true);
    });
  });

  describe('communication updated events', () => {
    it('should process COMMUNICATION_UPDATED event', async () => {
      // First create conversation and communication
      await channel.processWebhook({
        eventType: 'CONVERSATION_CREATED',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          configurationId: 'CFtest123456789',
        },
      });

      await channel.processWebhook({
        eventType: 'COMMUNICATION_CREATED',
        data: {
          id: 'CMtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
          content: {
            type: 'TEXT',
            text: 'Original message',
          },
          author: {
            address: '+15559876543',
            channel: 'SMS',
          },
          recipients: [],
        },
      });

      // Update communication (e.g., delivery status change)
      await expect(
        channel.processWebhook({
          eventType: 'COMMUNICATION_UPDATED',
          data: {
            id: 'CMtest123456789',
            conversationId: 'CHtest123456789',
            accountId: 'ACtest123456789',
            content: {
              type: 'TEXT',
              text: 'Original message',
            },
            author: {
              address: '+15559876543',
              channel: 'SMS',
            },
            recipients: [
              {
                address: '+15551234567',
                channel: 'SMS',
                deliveryStatus: 'DELIVERED',
              },
            ],
          },
        })
      ).resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle invalid webhook payload gracefully', async () => {
      await expect(channel.processWebhook(null)).resolves.not.toThrow();
      await expect(channel.processWebhook({})).resolves.not.toThrow();
    });

    it('should handle unknown event types', async () => {
      const webhookPayload = {
        eventType: 'UNKNOWN_EVENT',
        data: {
          id: 'CHtest123456789',
          conversationId: 'CHtest123456789',
          accountId: 'ACtest123456789',
        },
      };

      await expect(channel.processWebhook(webhookPayload)).resolves.not.toThrow();
    });

    it('should log validation errors with detailed information', async () => {
      const logSpy = vi.spyOn(channel['logger'], 'error');

      await channel.processWebhook({ eventType: 'INVALID', data: {} });

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          validation_errors: expect.any(Array),
          operation: 'conversations_webhook_validation',
        }),
        'Invalid Conversations webhook payload'
      );
    });
  });
});
