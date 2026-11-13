import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type StreamId = string;
export type EventId = string;

/**
 * Stored event structure in Redis
 */
export interface StoredEvent {
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
  timestamp: number;
}

/**
 * Session metadata stored in Redis
 */
export interface SessionMetadata {
  sessionId: string;
  createdAt: number;
  lastAccessedAt: number;
  transportType: "sse";
  /** sha256 of the access token that opened the session */
  tokenHash: string;
}

/**
 * EventStore interface from MCP SDK (re-exported for convenience)
 */
export interface EventStore {
  /**
   * Stores an event for later retrieval
   */
  storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId>;

  /**
   * Get the stream ID associated with a given event ID
   */
  getStreamIdForEventId?(eventId: EventId): Promise<StreamId | undefined>;

  /**
   * Replay events after a given event ID
   */
  replayEventsAfter(
    lastEventId: EventId,
    callbacks: {
      send: (eventId: EventId, message: JSONRPCMessage) => Promise<void>;
    },
  ): Promise<StreamId>;
}
