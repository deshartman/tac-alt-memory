import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SegmentProfileService, type SegmentProfileServiceConfig } from '@twilio/tac-core';
import pino from 'pino';

// Mock the Segment Analytics SDK
vi.mock('@segment/analytics-node', () => {
  return {
    Analytics: vi.fn().mockImplementation(() => ({
      identify: vi.fn((event, callback) => callback?.(null)),
      track: vi.fn((event, callback) => callback?.(null)),
      closeAndFlush: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('Segment Profile Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const getTestConfig = (): SegmentProfileServiceConfig => ({
    writeKey: 'test_write_key_123',
    spaceId: 'test_space_id',
    accessToken: 'test_access_token',
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      expect(service).toBeInstanceOf(SegmentProfileService);
    });

    it('should initialize with write key only (no Profile API)', () => {
      const config: SegmentProfileServiceConfig = {
        writeKey: 'test_write_key_123',
      };
      const service = new SegmentProfileService(config, logger);

      expect(service).toBeInstanceOf(SegmentProfileService);
    });

    it('should initialize with unifyToken instead of accessToken', () => {
      const config: SegmentProfileServiceConfig = {
        writeKey: 'test_write_key_123',
        spaceId: 'test_space_id',
        unifyToken: 'test_unify_token',
      };
      const service = new SegmentProfileService(config, logger);

      expect(service).toBeInstanceOf(SegmentProfileService);
    });
  });

  describe('identify()', () => {
    it('should call analytics.identify with correct userId format', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      // Access the mocked analytics instance
      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.identify('+61412345678');

      expect(mockAnalytics.identify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'phone_+61412345678',
          traits: { phone: '+61412345678' },
        }),
        expect.any(Function)
      );
    });

    it('should be non-blocking (fire-and-forget)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      // Should resolve immediately without waiting for callback
      const startTime = Date.now();
      await service.identify('+61412345678');
      const duration = Date.now() - startTime;

      // Should be instant (< 10ms) as it's fire-and-forget
      expect(duration).toBeLessThan(10);
    });

    it('should handle identify errors gracefully (non-blocking)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      // Simulate identify error
      mockAnalytics.identify.mockImplementation((event, callback) => {
        callback?.(new Error('Segment API error'));
      });

      // Should not throw - fire-and-forget
      await expect(service.identify('+61412345678')).resolves.toBeUndefined();
    });
  });

  describe('track()', () => {
    it('should call analytics.track with correct userId and event', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.track('+61412345678', 'message_received', { text: 'Hello' });

      expect(mockAnalytics.track).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'phone_+61412345678',
          event: 'message_received',
          properties: { text: 'Hello' },
        }),
        expect.any(Function)
      );
    });

    it('should track event without properties', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.track('+61412345678', 'conversation_started');

      expect(mockAnalytics.track).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'phone_+61412345678',
          event: 'conversation_started',
          properties: undefined,
        }),
        expect.any(Function)
      );
    });

    it('should be non-blocking (fire-and-forget)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const startTime = Date.now();
      await service.track('+61412345678', 'test_event');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should handle track errors gracefully (non-blocking)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      mockAnalytics.track.mockImplementation((event, callback) => {
        callback?.(new Error('Segment API error'));
      });

      await expect(service.track('+61412345678', 'test_event')).resolves.toBeUndefined();
    });
  });

  describe('getProfile()', () => {
    it('should fetch profile from Profile API with correct URL format', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const mockProfileData = {
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
          plan: 'premium',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProfileData,
      });

      const result = await service.getProfile('+61412345678');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://profiles.segment.com/v1/spaces/test_space_id/collections/users/profiles/user_id:phone_+61412345678/traits',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );

      expect(result).toEqual(mockProfileData.traits);
    });

    it('should use unifyToken over accessToken for authentication', async () => {
      const config: SegmentProfileServiceConfig = {
        writeKey: 'test_write_key',
        spaceId: 'test_space_id',
        accessToken: 'access_token',
        unifyToken: 'unify_token',
      };
      const service = new SegmentProfileService(config, logger);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ traits: {} }),
      });

      await service.getProfile('+61412345678');

      // Verify Basic Auth uses unifyToken
      const authHeader = mockFetch.mock.calls[0][1].headers.Authorization;
      const decodedAuth = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
      expect(decodedAuth).toBe('unify_token:');
    });

    it('should return empty object when Profile API not configured', async () => {
      const config: SegmentProfileServiceConfig = {
        writeKey: 'test_write_key',
      };
      const service = new SegmentProfileService(config, logger);

      const result = await service.getProfile('+61412345678');

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty object when spaceId is missing', async () => {
      const config: SegmentProfileServiceConfig = {
        writeKey: 'test_write_key',
        accessToken: 'test_token',
      };
      const service = new SegmentProfileService(config, logger);

      const result = await service.getProfile('+61412345678');

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty object for 404 (profile not found)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await service.getProfile('+61412345678');

      expect(result).toEqual({});
    });

    it('should return empty object on API error', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await service.getProfile('+61412345678');

      expect(result).toEqual({});
    });

    it('should handle network errors gracefully', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.getProfile('+61412345678');

      expect(result).toEqual({});
    });

    it('should filter profile fields when requested', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const mockProfileData = {
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
          plan: 'premium',
          age: 30,
          city: 'Sydney',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProfileData,
      });

      const result = await service.getProfile('+61412345678', ['name', 'plan']);

      expect(result).toEqual({
        name: 'John Doe',
        plan: 'premium',
      });
    });

    it('should handle missing fields in filter gracefully', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const mockProfileData = {
        traits: {
          name: 'John Doe',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProfileData,
      });

      const result = await service.getProfile('+61412345678', ['name', 'email', 'plan']);

      // Only returns fields that exist
      expect(result).toEqual({
        name: 'John Doe',
      });
    });

    it('should return empty object when all requested fields are missing', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const mockProfileData = {
        traits: {
          name: 'John Doe',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProfileData,
      });

      const result = await service.getProfile('+61412345678', ['email', 'plan']);

      expect(result).toEqual({});
    });
  });

  describe('updateProfile()', () => {
    it('should call analytics.identify to update traits', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.updateProfile('+61412345678', { name: 'Jane Doe', plan: 'premium' });

      expect(mockAnalytics.identify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'phone_+61412345678',
          traits: {
            name: 'Jane Doe',
            plan: 'premium',
            phone: '+61412345678', // Phone included automatically
          },
        }),
        expect.any(Function)
      );
    });

    it('should wait for callback completion (blocking operation)', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      let callbackExecuted = false;
      mockAnalytics.identify.mockImplementation((event, callback) => {
        setTimeout(() => {
          callbackExecuted = true;
          callback?.(null);
        }, 50);
      });

      await service.updateProfile('+61412345678', { name: 'Test' });

      // Callback should have executed
      expect(callbackExecuted).toBe(true);
    });

    it('should reject on identify error', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      mockAnalytics.identify.mockImplementation((event, callback) => {
        callback?.(new Error('Segment API error'));
      });

      await expect(service.updateProfile('+61412345678', { name: 'Test' })).rejects.toThrow(
        'Segment API error'
      );
    });
  });

  describe('close()', () => {
    it('should flush and close analytics', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.close();

      expect(mockAnalytics.closeAndFlush).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      mockAnalytics.closeAndFlush.mockRejectedValue(new Error('Close error'));

      // Should not throw
      await expect(service.close()).resolves.toBeUndefined();
    });
  });

  describe('user ID format', () => {
    it('should generate consistent userId for same phone number', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.identify('+61412345678');
      await service.identify('+61412345678');

      expect(mockAnalytics.identify).toHaveBeenCalledTimes(2);
      expect(mockAnalytics.identify.mock.calls[0][0].userId).toBe('phone_+61412345678');
      expect(mockAnalytics.identify.mock.calls[1][0].userId).toBe('phone_+61412345678');
    });

    it('should handle different phone number formats', async () => {
      const config = getTestConfig();
      const service = new SegmentProfileService(config, logger);

      const Analytics = await import('@segment/analytics-node');
      const mockAnalytics = Analytics.Analytics.mock.results[0]?.value;

      await service.identify('+1234567890');
      await service.identify('+61412345678');
      await service.identify('+447700900123');

      expect(mockAnalytics.identify.mock.calls[0][0].userId).toBe('phone_+1234567890');
      expect(mockAnalytics.identify.mock.calls[1][0].userId).toBe('phone_+61412345678');
      expect(mockAnalytics.identify.mock.calls[2][0].userId).toBe('phone_+447700900123');
    });
  });
});
