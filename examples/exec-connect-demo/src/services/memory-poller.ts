import { TAC } from 'twilio-agent-connect';
import { dashboardHandler } from '../dashboard/event-handler';

/**
 * Memory Polling Service - TypeScript equivalent of Python's memory_poller.py
 * Polls Memora API for new observations/summaries and broadcasts dashboard events
 */
export class MemoryPoller {
  private seenObservationIds: Set<string> = new Set();
  private seenSummaryIds: Set<string> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isInitialized: boolean = false;
  private consecutiveErrors: number = 0;
  private readonly MAX_ERRORS = 10;

  constructor(
    private readonly tac: TAC,
    private readonly profileId: string,
    private readonly pollIntervalMs: number = 1500,
    private readonly eventEmitter: typeof dashboardHandler
  ) {}

  /**
   * Start polling for memory updates
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[MemoryPoller] Already running for profile ${this.profileId}`);
      return;
    }

    this.isRunning = true;
    console.log(
      `[MemoryPoller] Starting for profile ${this.profileId} (interval: ${this.pollIntervalMs}ms)`
    );

    // Initial poll to seed seen IDs
    await this.pollOnce();
    this.isInitialized = true;

    // Start interval
    this.pollingInterval = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(`[MemoryPoller] Stopping for profile ${this.profileId}`);
    this.isRunning = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Single poll cycle
   */
  private async pollOnce(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const memoryClient = this.tac.getMemoryClient();
      const storeId = this.tac.getConfig().memoryStoreId;

      if (!memoryClient || !storeId) {
        console.warn('[MemoryPoller] Memory client or store ID not available');
        return;
      }

      // Retrieve current memory state directly from memory client
      const memory = await memoryClient.retrieveMemories(storeId, this.profileId, {});

      if (memory) {
        await this.processObservations(memory.observations || []);
        await this.processSummaries(memory.summaries || []);

        // Reset error counter on success
        this.consecutiveErrors = 0;
      }
    } catch (error) {
      this.consecutiveErrors++;
      console.error(
        `[MemoryPoller] Poll error (${this.consecutiveErrors}/${this.MAX_ERRORS}):`,
        error
      );

      if (this.consecutiveErrors >= this.MAX_ERRORS) {
        console.error(
          `[MemoryPoller] Too many errors, stopping poller for profile ${this.profileId}`
        );
        await this.stop();
      }
    }
  }

  /**
   * Process observations and emit events for new ones
   */
  private async processObservations(observations: any[]): Promise<void> {
    for (const obs of observations) {
      if (!this.seenObservationIds.has(obs.id)) {
        this.seenObservationIds.add(obs.id);

        // Only emit event if initialized (skip initial seed)
        if (this.isInitialized) {
          this.eventEmitter.pushEvent({
            event_type: 'observation_extracted',
            profile_id: this.profileId,
            message: `New observation: ${obs.content.substring(0, 50)}${obs.content.length > 50 ? '...' : ''}`,
            metadata: {
              observation: {
                id: obs.id,
                content: obs.content,
                source: obs.source,
                created_at: obs.createdAt,
                occurred_at: obs.occurredAt,
              },
            },
          });
        }
      }
    }
  }

  /**
   * Process summaries and emit events for new ones
   */
  private async processSummaries(summaries: any[]): Promise<void> {
    for (const sum of summaries) {
      if (!this.seenSummaryIds.has(sum.id)) {
        this.seenSummaryIds.add(sum.id);

        if (this.isInitialized) {
          this.eventEmitter.pushEvent({
            event_type: 'summary_generated',
            profile_id: this.profileId,
            message: `New summary: ${sum.content.substring(0, 50)}${sum.content.length > 50 ? '...' : ''}`,
            metadata: {
              summary: {
                id: sum.id,
                content: sum.content,
                created_at: sum.createdAt,
              },
            },
          });
        }
      }
    }
  }
}
