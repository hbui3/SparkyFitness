import { EventEmitter } from 'node:events';

export type CoachEventDomain =
  | 'chat'
  | 'nutrition'
  | 'water'
  | 'exercise'
  | 'checkin'
  | 'coach';

export interface CoachDataEvent {
  id: string;
  type: 'coach_data_changed';
  domain: CoachEventDomain;
  occurredAt: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(1_000);

function publish(userId: string, domain: CoachEventDomain): CoachDataEvent {
  const event: CoachDataEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type: 'coach_data_changed',
    domain,
    occurredAt: new Date().toISOString(),
  };
  emitter.emit(userId, event);
  return event;
}

function subscribe(
  userId: string,
  listener: (event: CoachDataEvent) => void
): () => void {
  emitter.on(userId, listener);
  return () => emitter.off(userId, listener);
}

export default { publish, subscribe };
