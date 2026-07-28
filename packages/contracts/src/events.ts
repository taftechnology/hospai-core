/** Domain events — outbox row → Queue message envelope (Phase 0 event bus). */

export type EventSource = {
  do: 'property' | 'org';
  id: string;
};

/** One Queue message body — JSON-serialized for sendBatch. */
export type DomainEventMessage = {
  eventId: string;
  eventType: string;
  payload: unknown;
  seq: number;
  source: EventSource;
  createdAt: number;
};
