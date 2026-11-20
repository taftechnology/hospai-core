import { useState } from 'react';

/**
 * The date a housekeeping view shows: the user's own choice once made, otherwise the property
 * business date as it arrives (it may load after the first render). Empty until it is known.
 */
export function useBusinessDate(propertyDate: string): [string, (date: string) => void] {
  const [chosen, setChosen] = useState<string | null>(null);
  return [chosen ?? propertyDate, setChosen];
}
