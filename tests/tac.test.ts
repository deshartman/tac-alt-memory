import { describe, it, expect } from 'vitest';
import { TAC, TACConfig } from '@twilio/tac-core';

describe('TAC Core', () => {
  const getTestConfig = () => ({
    environment: 'dev' as const,
    twilioAccountSid: 'ACtest123456789',
    twilioAuthToken: 'test_token_123',
    apiKey: 'test_api_key',
    apiToken: 'test_api_token',
    twilioPhoneNumber: '+15551234567',
    conversationServiceId: 'comms_service_01kbjqhn79f0fvwfsxqzd5nqhd'
  });

  describe('initialization', () => {
    it('should initialize TAC with config object', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      expect(tac).toBeInstanceOf(TAC);
    });

    it('should initialize TAC without config (from environment)', () => {
      // This will fail without env vars but should instantiate
      const keys = [
        'ENVIRONMENT',
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'MEMORY_STORE_ID',
        'CONVERSATION_SERVICE_ID',
        'VOICE_PUBLIC_DOMAIN',
      ] as const;
      const snapshot: Record<(typeof keys)[number], string | undefined> = {
        ENVIRONMENT: process.env.ENVIRONMENT,
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
        MEMORY_STORE_ID: process.env.MEMORY_STORE_ID,
        CONVERSATION_SERVICE_ID: process.env.CONVERSATION_SERVICE_ID,
        VOICE_PUBLIC_DOMAIN: process.env.VOICE_PUBLIC_DOMAIN,
      };

      try {
        keys.forEach(key => {
          delete process.env[key];
        });

        expect(() => new TAC()).toThrow();
      } finally {
        keys.forEach(key => {
          const value = snapshot[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        });
      }
    });

    it('should provide access to config', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const retrievedConfig = tac.getConfig();
      expect(retrievedConfig.environment).toBe('dev');
      expect(retrievedConfig.twilioAccountSid).toBe('ACtest123456789');
    });

    it('should provide access to clients', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      // Memory client should be undefined when memoryStoreId not provided
      expect(tac.getMemoryClient()).toBeUndefined();
      expect(tac.getConversationClient()).toBeDefined();
    });

    it('should initialize memory client when memoryStoreId is provided with Memora provider', () => {
      const configWithMemory = {
        ...getTestConfig(),
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
        profileServiceProvider: 'memora' as const,
      };
      const config = new TACConfig(configWithMemory);
      const tac = new TAC({ config });

      expect(tac.getMemoryClient()).toBeDefined();
      expect(tac.getProfileService()).toBeDefined();
      expect(tac.isMemoryEnabled()).toBe(true);
    });

    it('should not initialize memory client without profileServiceProvider', () => {
      const configWithMemory = {
        ...getTestConfig(),
        memoryStoreId: 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg',
      };
      const config = new TACConfig(configWithMemory);
      const tac = new TAC({ config });

      expect(tac.getMemoryClient()).toBeUndefined();
      expect(tac.getProfileService()).toBeUndefined();
      expect(tac.isMemoryEnabled()).toBe(false);
    });

    it('should initialize Segment profile service when configured', () => {
      const configWithSegment = {
        ...getTestConfig(),
        profileServiceProvider: 'segment' as const,
        segmentWriteKey: 'test_write_key_123',
        segmentSpaceId: 'test_space_id',
        segmentAccessToken: 'test_access_token',
      };
      const config = new TACConfig(configWithSegment);
      const tac = new TAC({ config });

      expect(tac.getMemoryClient()).toBeUndefined();
      expect(tac.getProfileService()).toBeDefined();
      expect(tac.isMemoryEnabled()).toBe(false);
    });

    it('should throw error when Segment provider configured without write key', () => {
      const configWithSegment = {
        ...getTestConfig(),
        profileServiceProvider: 'segment' as const,
      };

      expect(() => {
        const config = new TACConfig(configWithSegment);
        new TAC({ config });
      }).toThrow('SEGMENT_WRITE_KEY is required');
    });

    it('should throw error when Memora provider configured without memoryStoreId', () => {
      const configWithMemora = {
        ...getTestConfig(),
        profileServiceProvider: 'memora' as const,
      };

      expect(() => {
        const config = new TACConfig(configWithMemora);
        new TAC({ config });
      }).toThrow('MEMORY_STORE_ID is required');
    });

    it('should start with no channels (until explicitly registered)', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      // Verify no channels are registered by default
      const smsChannel = tac.getChannel('sms');
      const voiceChannel = tac.getChannel('voice');
      expect(smsChannel).toBeUndefined();
      expect(voiceChannel).toBeUndefined();
    });
  });

  describe('callback registration', () => {
    it('should register message ready callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => 'response';

      expect(() => {
        tac.onMessageReady(mockCallback);
      }).not.toThrow();
    });

    it('should register interrupt callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => {};

      expect(() => {
        tac.onInterrupt(mockCallback);
      }).not.toThrow();
    });

    it('should register handoff callback', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      const mockCallback = () => {};

      expect(() => {
        tac.onHandoff(mockCallback);
      }).not.toThrow();
    });
  });

  describe('lifecycle', () => {
    it('should shutdown cleanly', () => {
      const config = new TACConfig(getTestConfig());
      const tac = new TAC({ config });

      expect(() => {
        tac.shutdown();
      }).not.toThrow();
    });
  });
});
