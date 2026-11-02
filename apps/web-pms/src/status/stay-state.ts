export type StayState = 'inhouse' | 'due' | 'overstay' | 'confirmed' | 'pending';

export const STAY_STATE_WORD: Record<StayState, string> = {
  inhouse: 'In house',
  due: 'Due out today',
  overstay: 'Overstay',
  confirmed: 'Confirmed',
  pending: 'Pending',
};

export function stayState(
  status: string,
  departureDate: string,
  today: string | null,
): StayState | null {
  if (status === 'checked_in') {
    if (today == null) return 'inhouse';
    if (departureDate < today) return 'overstay';
    if (departureDate === today) return 'due';
    return 'inhouse';
  }
  if (status === 'confirmed') return 'confirmed';
  if (status === 'pending') return 'pending';
  return null;
}
