import type { BoardMode } from './board-mode.js';

const TITLES: Record<BoardMode, string> = {
  arrivals: 'Arrivals',
  departures: 'Departures',
  'in-house': 'In house',
};

export function boardPageTitle(mode: BoardMode): string {
  return TITLES[mode];
}
