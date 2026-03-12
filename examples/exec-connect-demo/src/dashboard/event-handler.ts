/**
 * Dashboard Event Handler
 *
 * Captures and queues events for SSE streaming to dashboard clients.
 * Uses EventEmitter pattern for real-time event broadcasting.
 */

import { EventEmitter } from 'events';

/**
 * Event types matching Python implementation
 */
export type DashboardEventType =
  | 'user_message'
  | 'memory'
  | 'ai_processing'
  | 'ai_response'
  | 'handoff'
  | 'error'
  | 'call_started'
  | 'websocket_connected'
  | 'call_setup'
  | 'agent_context'
  | 'observation_extracted'
  | 'summary_generated'
  | 'observation_created';

/**
 * Agent context metadata for showing AI agent's knowledge state
 */
export interface AgentContextMetadata {
  profile?: {
    profile_id: string;
    identifiers?: Record<string, string>;
    traits?: Record<string, unknown>; // Nested trait groups
  };
  observations: Array<{
    id: string;
    content: string;
    occurred_at?: string;
    created_at: string;
    source?: string;
  }>;
  summaries: Array<{
    id: string;
    content: string;
    created_at: string;
  }>;
  communications: Array<{
    id: string;
    author_name: string;
    author_type?: string;
    content: string;
    created_at: string;
  }>;
  sentiment?: {
    score: string;
    confidence?: number;
  }; // Reserved for future CIntel integration
}

/**
 * Dashboard event structure
 */
export interface DashboardEvent {
  timestamp: string;
  event_type: DashboardEventType;
  conversation_id?: string;
  channel?: string;
  profile_id?: string;
  message: string;
  metadata?: Record<string, unknown> | AgentContextMetadata;
}

const MAX_EVENTS = 100;

/**
 * Dashboard event handler for capturing and streaming events
 */
class DashboardEventHandler extends EventEmitter {
  private eventQueue: DashboardEvent[] = [];

  /**
   * Push a new event to the queue and emit for SSE subscribers
   */
  pushEvent(event: Omit<DashboardEvent, 'timestamp'>): void {
    const fullEvent: DashboardEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.eventQueue.push(fullEvent);

    // Trim queue if over max
    while (this.eventQueue.length > MAX_EVENTS) {
      this.eventQueue.shift();
    }

    // Emit for SSE subscribers
    this.emit('event', fullEvent);
  }

  /**
   * Get all pending events (for initial load)
   */
  getEvents(): DashboardEvent[] {
    return [...this.eventQueue];
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.eventQueue = [];
  }
}

// Singleton instance
export const dashboardHandler = new DashboardEventHandler();
