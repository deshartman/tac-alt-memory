import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookRouter } from '../packages/core/src/util/webhook-router';
import type { TAC } from '../packages/core/src/lib/tac';
import type { BaseChannel } from '../packages/core/src/channels/base';
import type { ConversationId } from '../packages/core/src/types/conversation';

describe('WebhookRouter', () => {
  let mockTAC: TAC;
  let mockSMSChannel: BaseChannel;
  let mockVoiceChannel: BaseChannel;

  beforeEach(() => {
    // Mock SMS channel
    mockSMSChannel = {
      channelType: 'sms',
      isConversationActive: vi.fn(),
      processWebhook: vi.fn(),
    } as unknown as BaseChannel;

    // Mock Voice channel
    mockVoiceChannel = {
      channelType: 'voice',
      isConversationActive: vi.fn(),
      processWebhook: vi.fn(),
    } as unknown as BaseChannel;

    // Mock TAC instance
    mockTAC = {
      getChannel: vi.fn((type: string) => {
        if (type === 'sms') return mockSMSChannel;
        if (type === 'voice') return mockVoiceChannel;
        return undefined;
      }),
      getChannels: vi.fn(() => [mockSMSChannel, mockVoiceChannel]),
    } as unknown as TAC;
  });

  describe('Valid Channel Extraction', () => {
    it('should route COMMUNICATION_CREATED with author.channel to SMS channel', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'comm_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          author: {
            address: '+15551234567',
            channel: 'sms',
            participantId: 'part_789',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [],
          channelId: 'ch_123',
          profileId: 'prof_456',
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.channel).toBe(mockSMSChannel);
        expect(result.channelType).toBe('sms');
        expect(result.conversationId).toBe('conv_456');
        expect(result.eventType).toBe('COMMUNICATION_CREATED');
        expect(result.shouldProcess).toBe(true);
        expect(result.payload).toBeDefined();
      }
    });

    it('should route PARTICIPANT_ADDED with addresses[0].channel to voice channel', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'PARTICIPANT_ADDED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'part_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          name: 'Customer',
          type: 'CUSTOMER',
          profileId: 'prof_789',
          addresses: [
            {
              channel: 'voice',
              address: '+15551234567',
              channelId: 'ch_123',
            },
          ],
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.channel).toBe(mockVoiceChannel);
        expect(result.channelType).toBe('voice');
        expect(result.conversationId).toBe('conv_456');
        expect(result.eventType).toBe('PARTICIPANT_ADDED');
        expect(result.shouldProcess).toBe(true);
      }
    });
  });

  describe('Lifecycle Event Routing', () => {
    it('should skip CONVERSATION_CREATED when conversation not in any channel', () => {
      const router = new WebhookRouter(mockTAC);

      // Mock channels returning false (conversation not found)
      vi.mocked(mockSMSChannel.isConversationActive).mockReturnValue(false);
      vi.mocked(mockVoiceChannel.isConversationActive).mockReturnValue(false);

      const payload = {
        eventType: 'CONVERSATION_CREATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'conv_123',
          conversationId: 'conv_123',
          accountId: 'AC123',
          configurationId: 'config_456',
          status: 'ACTIVE',
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('skip');
      if (result.status === 'skip') {
        expect(result.reason).toContain('conversation not yet in channel');
        expect(result.eventType).toBe('CONVERSATION_CREATED');
        expect(result.conversationId).toBe('conv_123');
        expect(result.shouldProcess).toBe(false);
      }
    });

    it('should route CONVERSATION_UPDATED when conversation exists in SMS channel', () => {
      const router = new WebhookRouter(mockTAC);

      // Mock SMS channel returning true (conversation found)
      vi.mocked(mockSMSChannel.isConversationActive).mockReturnValue(true);
      vi.mocked(mockVoiceChannel.isConversationActive).mockReturnValue(false);

      const payload = {
        eventType: 'CONVERSATION_UPDATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'conv_123',
          conversationId: 'conv_123',
          accountId: 'AC123',
          configurationId: 'config_456',
          status: 'CLOSED',
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.channel).toBe(mockSMSChannel);
        expect(result.channelType).toBe('sms');
        expect(result.conversationId).toBe('conv_123');
        expect(result.eventType).toBe('CONVERSATION_UPDATED');
        expect(result.shouldProcess).toBe(true);
      }

      // Verify it checked the channels
      expect(mockSMSChannel.isConversationActive).toHaveBeenCalledWith('conv_123');
    });

    it('should skip PARTICIPANT_UPDATED event without channel info', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'PARTICIPANT_UPDATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'part_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          name: 'Customer',
          profileId: 'prof_789',
          // No addresses array - no channel info
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('skip');
      if (result.status === 'skip') {
        expect(result.reason).toContain('no channel information');
        expect(result.eventType).toBe('PARTICIPANT_UPDATED');
        expect(result.shouldProcess).toBe(false);
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should return validation error for invalid payload structure', () => {
      const router = new WebhookRouter(mockTAC);

      const invalidPayload = {
        // Missing required fields
        someInvalidField: 'invalid',
      };

      const result = router.route(invalidPayload);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Invalid webhook payload');
        expect(result.errorType).toBe('validation');
        expect(result.shouldProcess).toBe(false);
      }
    });

    it('should return unknown_channel error for unsupported channel type', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'comm_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          author: {
            address: '+15551234567',
            channel: 'whatsapp', // Unsupported channel
            participantId: 'part_789',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [],
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Unknown channel type');
        expect(result.errorType).toBe('unknown_channel');
        expect(result.channelType).toBe('whatsapp');
        expect(result.shouldProcess).toBe(false);
      }
    });

    it('should return channel_not_registered error when channel not registered', () => {
      const router = new WebhookRouter(mockTAC);

      // Mock TAC to return undefined for voice channel
      vi.mocked(mockTAC.getChannel).mockImplementation((type: string) => {
        if (type === 'sms') return mockSMSChannel;
        return undefined; // Voice channel not registered
      });

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'comm_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          author: {
            address: '+15551234567',
            channel: 'voice',
            participantId: 'part_789',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [],
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Channel not registered');
        expect(result.errorType).toBe('channel_not_registered');
        expect(result.channelType).toBe('voice');
        expect(result.shouldProcess).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values in optional fields', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'COMMUNICATION_CREATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'comm_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          author: {
            address: '+15551234567',
            channel: 'sms',
          },
          content: {
            type: 'TEXT',
            text: 'Hello',
          },
          recipients: [],
          channelId: null, // null value
          profileId: null, // null value
          createdAt: null, // null value
          updatedAt: null, // null value
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.channel).toBe(mockSMSChannel);
        expect(result.channelType).toBe('sms');
      }
    });

    it('should extract conversationId from id field when conversationId missing', () => {
      const router = new WebhookRouter(mockTAC);

      // Mock SMS channel to find conversation
      vi.mocked(mockSMSChannel.isConversationActive).mockReturnValue(true);

      const payload = {
        eventType: 'CONVERSATION_UPDATED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'conv_789',
          // conversationId will default to id
          accountId: 'AC123',
          configurationId: 'config_456',
          status: 'ACTIVE',
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.conversationId).toBe('conv_789');
      }
    });

    it('should handle empty addresses array gracefully', () => {
      const router = new WebhookRouter(mockTAC);

      const payload = {
        eventType: 'PARTICIPANT_ADDED',
        timestamp: '2026-03-18T12:00:00Z',
        data: {
          id: 'part_123',
          conversationId: 'conv_456',
          accountId: 'AC123',
          name: 'Customer',
          addresses: [], // Empty array - no channel info
          createdAt: '2026-03-18T12:00:00Z',
          updatedAt: '2026-03-18T12:00:00Z',
        },
      };

      const result = router.route(payload);

      expect(result.status).toBe('skip');
      if (result.status === 'skip') {
        expect(result.reason).toContain('no channel information');
        expect(result.shouldProcess).toBe(false);
      }
    });
  });
});
