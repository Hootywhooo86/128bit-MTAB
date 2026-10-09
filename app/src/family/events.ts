/**
 * 128bit shared event schema (v0.1)
 *
 * Every 128bit app emits these events. 128bitlife subscribes to the feed
 * to generate quests, XP, and suggestions ("log your dinner").
 *
 * When the backend lands, emitEvent POSTs to the 128bit event feed; until
 * then it logs locally.
 */
import type { Bit128App } from './apps';

export type EventName =
  | 'workout.logged'
  | 'meal.logged'
  | 'booking.made'
  | 'budget.updated'
  | 'expense.logged'
  | 'under_budget.week'
  | 'savings_goal.hit'
  | 'quest.completed'
  | 'trip.created'
  | 'trip.packing.done'
  | 'trip.checkin'
  | 'esim.purchased'
  | 'matchup.won';

export interface Bit128Event {
  name: EventName;
  app: Bit128App;
  /** 128bit account id — stubbed until auth lands. */
  userId: string;
  /** ISO-8601 timestamp, filled by emitEvent. */
  occurredAt: string;
  /** XP awarded for this event. */
  xp: number;
  data?: Record<string, unknown>;
}

/** XP table — single source of truth for the 128bit economy. */
export const XP: Record<EventName, number> = {
  'workout.logged': 50,
  'meal.logged': 20,
  'booking.made': 100,
  'budget.updated': 20,
  'expense.logged': 10,
  'under_budget.week': 150,
  'savings_goal.hit': 300,
  'quest.completed': 50,
  'trip.created': 100,
  'trip.packing.done': 80,
  'trip.checkin': 120,
  'esim.purchased': 40,
  'matchup.won': 100,
};

export function emitEvent(
  e: Omit<Bit128Event, 'occurredAt' | 'xp'> & { xp?: number }
): Bit128Event {
  const full: Bit128Event = {
    ...e,
    xp: e.xp ?? XP[e.name] ?? 10,
    occurredAt: new Date().toISOString(),
  };
  // TODO(128bitlife): POST to the 128bit event feed.
  // Local log keeps the contract testable until then.
  console.log('[128bit:event]', JSON.stringify(full));
  return full;
}
