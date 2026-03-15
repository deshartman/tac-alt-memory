import { Analytics } from '@segment/analytics-node';
import type { Logger } from 'pino';
import type { ProfileService } from './profile-service.js';

/**
 * Configuration for SegmentProfileService
 */
export interface SegmentProfileServiceConfig {
  /** Segment source write key (required for event tracking) */
  writeKey: string;
  /** Segment space ID (optional, for Profile API) */
  spaceId?: string;
  /** Segment public API token (optional, for Profile API) */
  accessToken?: string;
  /** Segment Unify token (optional, for Profile API with Basic Auth) */
  unifyToken?: string;
}

/**
 * Segment implementation of ProfileService
 *
 * - Uses @segment/analytics-node SDK for event tracking (identify, track)
 * - Uses Segment Profile API v1 for trait management (getProfile, updateProfile)
 * - All operations are non-blocking (fire-and-forget for identify/track)
 * - User ID format: phone_+61412345678 (prefixed phone number)
 */
export class SegmentProfileService implements ProfileService {
  private readonly analytics: Analytics;
  private readonly spaceId: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly unifyToken: string | undefined;
  private readonly logger: Logger;

  constructor(config: SegmentProfileServiceConfig, logger: Logger) {
    this.analytics = new Analytics({ writeKey: config.writeKey });
    this.spaceId = config.spaceId;
    this.accessToken = config.accessToken;
    this.unifyToken = config.unifyToken;
    this.logger = logger.child({ component: 'segment-profile-service' });

    this.logger.info('Segment Profile Service initialized');
  }

  /**
   * Background identity tracking (fire-and-forget)
   * Creates/updates user identity in Segment for analytics
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Fire-and-forget pattern
  async identify(phone: string): Promise<void> {
    const userId = `phone_${phone}`;

    // Fire-and-forget with optional error callback
    this.analytics.identify(
      {
        userId,
        traits: { phone },
      },
      err => {
        if (err) {
          this.logger.warn({ err, phone }, 'Segment identify failed (non-blocking)');
        }
      }
    );
  }

  /**
   * Background event tracking (fire-and-forget)
   * Tracks conversation events for analytics
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Fire-and-forget pattern
  async track(phone: string, event: string, properties?: Record<string, unknown>): Promise<void> {
    const userId = `phone_${phone}`;

    // Fire-and-forget with optional error callback
    this.analytics.track(
      {
        userId,
        event,
        properties,
      },
      err => {
        if (err) {
          this.logger.warn({ err, event, phone }, 'Segment track failed (non-blocking)');
        }
      }
    );
  }

  /**
   * Retrieve customer profile traits from Segment Profile API
   * Used by LLM tools to fetch customer context on-demand
   */
  async getProfile(phone: string, fields?: string[]): Promise<Record<string, unknown>> {
    // Prefer unifyToken for Profile API (uses Basic Auth)
    const token = this.unifyToken || this.accessToken;

    if (!this.spaceId || !token) {
      this.logger.warn('Segment Profile API not configured (missing spaceId or token)');
      return {};
    }

    const userId = `phone_${phone}`;
    const url = `https://profiles.segment.com/v1/spaces/${this.spaceId}/collections/users/profiles/user_id:${userId}/traits`;

    try {
      // Use Basic Auth for Profile API (username = token, password = empty)
      const auth = Buffer.from(`${token}:`).toString('base64');
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (response.status === 404) {
        // Profile doesn't exist yet - return empty traits
        this.logger.debug({ phone }, 'Profile not found (will be created on first write)');
        return {};
      }

      if (!response.ok) {
        throw new Error(`Profile API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { traits: Record<string, unknown> };

      // Filter to specific fields if requested
      if (fields && fields.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const field of fields) {
          if (field in data.traits) {
            filtered[field] = data.traits[field];
          }
        }
        return filtered;
      }

      return data.traits || {};
    } catch (error) {
      this.logger.error({ err: error, phone }, 'Failed to retrieve profile from Segment');
      return {};
    }
  }

  /**
   * Update customer profile traits in Segment
   * Uses Events API (identify) - Profile API is read-only and only supports GET
   */
  async updateProfile(phone: string, traits: Record<string, unknown>): Promise<void> {
    const userId = `phone_${phone}`;

    // Use identify() to write traits - Profile API is read-only
    // Wrap in Promise to make this properly async
    return new Promise((resolve, reject) => {
      this.analytics.identify(
        {
          userId,
          traits: { ...traits, phone }, // Include phone in traits
        },
        err => {
          if (err) {
            this.logger.error({ err, phone, traits }, 'Failed to update profile in Segment');
            reject(err);
          } else {
            this.logger.debug({ phone, traits }, 'Profile traits sent to Segment');
            resolve();
          }
        }
      );
    });
  }

  /**
   * Graceful shutdown - flush queued events to Segment
   */
  async close(): Promise<void> {
    try {
      await this.analytics.closeAndFlush();
      this.logger.info('Segment analytics flushed and closed');
    } catch (error) {
      this.logger.error({ err: error }, 'Error closing Segment analytics');
    }
  }
}
