/**
 * ProfileService - Abstract interface for customer identity and profile management
 *
 * Provides a unified interface for different profile storage backends (Segment, Memora).
 * Implementations handle identity resolution, profile trait management, and event tracking.
 */

/**
 * Generic profile service interface supporting both blocking (Memora) and non-blocking (Segment) implementations
 */
export interface ProfileService {
  /**
   * Resolve phone number to user identity
   * - Segment: Non-blocking, fire-and-forget identity tracking
   * - Memora: Blocking, retrieves profile_id for later use
   *
   * @param phone - Phone number in E.164 format (e.g., "+61412345678")
   */
  identify(phone: string): Promise<void>;

  /**
   * Track conversation events for analytics
   * - Segment: Fire-and-forget event tracking
   * - Memora: No-op (no event tracking capability)
   *
   * @param phone - Phone number in E.164 format
   * @param event - Event name (e.g., "message_received", "handoff_requested")
   * @param properties - Optional event properties
   */
  track(phone: string, event: string, properties?: Record<string, unknown>): Promise<void>;

  /**
   * Retrieve customer profile traits
   * Used by LLM tools to fetch customer context on-demand
   *
   * @param phone - Phone number in E.164 format
   * @param fields - Optional array of specific trait fields to retrieve
   * @returns Profile traits as key-value pairs
   */
  getProfile(phone: string, fields?: string[]): Promise<Record<string, unknown>>;

  /**
   * Update customer profile traits
   * Used by LLM tools to persist customer information
   *
   * @param phone - Phone number in E.164 format
   * @param traits - Traits to update (e.g., {name: "John", plan: "premium"})
   */
  updateProfile(phone: string, traits: Record<string, unknown>): Promise<void>;

  /**
   * Graceful shutdown - flush any pending operations
   * - Segment: Flush queued events to Segment API
   * - Memora: No cleanup needed
   */
  close(): Promise<void>;
}
