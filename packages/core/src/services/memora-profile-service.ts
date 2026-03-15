import type { Logger } from 'pino';
import type { ProfileService } from './profile-service.js';
import { MemoryClient } from '../clients/memory.js';

/**
 * Memora implementation of ProfileService
 *
 * - Wraps existing MemoryClient for backward compatibility
 * - Identity resolution is BLOCKING (retrieves profile_id via lookupProfile)
 * - No event tracking (Memora doesn't support this)
 * - Profile traits stored in cache after lookup
 */
export class MemoraProfileService implements ProfileService {
  private readonly memoryClient: MemoryClient;
  private readonly storeId: string;
  private readonly logger: Logger;

  /**
   * Cache mapping phone numbers to profile IDs
   * Populated during identify() call
   */
  private readonly profileCache = new Map<string, string>();

  constructor(memoryClient: MemoryClient, storeId: string, logger: Logger) {
    this.memoryClient = memoryClient;
    this.storeId = storeId;
    this.logger = logger.child({ component: 'memora-profile-service' });

    this.logger.info('Memora Profile Service initialized');
  }

  /**
   * BLOCKING identity resolution
   * Looks up profile by phone number and caches profile_id for later use
   */
  async identify(phone: string): Promise<void> {
    try {
      const lookupResponse = await this.memoryClient.lookupProfile(this.storeId, 'phone', phone);

      if (lookupResponse.profiles && lookupResponse.profiles.length > 0) {
        const profileId = lookupResponse.profiles[0]!;
        this.profileCache.set(phone, profileId);
        this.logger.debug({ phone, profile_id: profileId }, 'Profile identified and cached');
      } else {
        this.logger.warn({ phone }, 'No profile found for phone number');
      }
    } catch (error) {
      this.logger.error({ err: error, phone }, 'Failed to identify profile');
      throw error;
    }
  }

  /**
   * No-op for Memora (no event tracking capability)
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- No-op method
  async track(phone: string, event: string, _properties?: Record<string, unknown>): Promise<void> {
    // Memora doesn't support event tracking - no-op
    this.logger.debug({ phone, event }, 'Event tracking not supported in Memora (no-op)');
  }

  /**
   * Retrieve customer profile traits from Memora
   * Used by LLM tools to fetch customer context on-demand
   */
  async getProfile(phone: string, fields?: string[]): Promise<Record<string, unknown>> {
    const profileId = this.profileCache.get(phone);

    if (!profileId) {
      this.logger.warn({ phone }, 'Profile not identified - call identify() first');
      throw new Error('Profile not identified - call identify() first');
    }

    try {
      const profileResponse = await this.memoryClient.getProfile(this.storeId, profileId);

      // Filter to specific fields if requested
      if (fields && fields.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const field of fields) {
          if (field in profileResponse.traits) {
            filtered[field] = profileResponse.traits[field];
          }
        }
        return filtered;
      }

      return profileResponse.traits;
    } catch (error) {
      this.logger.error({ err: error, phone, profile_id: profileId }, 'Failed to retrieve profile');
      throw error;
    }
  }

  /**
   * Update customer profile traits
   * Note: MemoryClient doesn't have updateProfile method - this would need to be added to MemoryClient
   * For now, throw an error indicating this is not yet implemented
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Throws error, no async operation
  async updateProfile(phone: string, traits: Record<string, unknown>): Promise<void> {
    const profileId = this.profileCache.get(phone);

    if (!profileId) {
      this.logger.warn({ phone }, 'Profile not identified - call identify() first');
      throw new Error('Profile not identified - call identify() first');
    }

    // TODO: Implement updateProfile in MemoryClient
    // For now, log a warning and throw
    this.logger.warn(
      { phone, profile_id: profileId, traits },
      'updateProfile not yet implemented for Memora'
    );
    throw new Error(
      'updateProfile not yet implemented for Memora - MemoryClient needs updateProfile method'
    );
  }

  /**
   * No cleanup needed for Memora
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- No async cleanup needed
  async close(): Promise<void> {
    this.logger.debug('Memora profile service closed (no cleanup needed)');
  }
}
