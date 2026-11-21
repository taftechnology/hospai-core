/**
 * The one rounding rule for statistics shown on operational reports (R4.14 Part C): occupancy %,
 * ADR, RevPAR and an average score all come from `roundedRatio`. A statistic is displayed, never
 * posted; a division by zero is `null`, which the SPA shows as a dash.
 */

/**
 * `numerator / denominator` as an integer, rounded half up (half away from zero for a negative
 * numerator). `null` when the denominator is not positive.
 */
export function roundedRatio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  if (numerator < 0) {
    const positive = roundedRatio(-numerator, denominator);
    return positive === null || positive === 0 ? positive : -positive;
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Whole percent, half up; `null` when `whole` is not positive. */
export function wholePercent(part: number, whole: number): number | null {
  return roundedRatio(part * 100, whole);
}

/** Average daily rate in minor units: room revenue per room sold. */
export function averageDailyRateMinor(roomRevenueMinor: number, roomsSold: number): number | null {
  return roundedRatio(roomRevenueMinor, roomsSold);
}

/** Revenue per available room in minor units. */
export function revParMinor(roomRevenueMinor: number, roomsAvailable: number): number | null {
  return roundedRatio(roomRevenueMinor, roomsAvailable);
}
