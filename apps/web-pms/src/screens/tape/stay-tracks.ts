export type StayTrackSpan = {
  colStart: number;
  colEnd: number;
  cutStart: boolean;
  cutEnd: boolean;
};

export function stayTracks(
  arrival: string,
  departure: string,
  dates: string[],
): StayTrackSpan | null {
  if (dates.length === 0) return null;
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;

  if (departure <= first) {
    if (arrival < first && departure === first) {
      return { colStart: 2, colEnd: 3, cutStart: true, cutEnd: false };
    }
    return null;
  }
  if (arrival > last) return null;

  let colStart: number;
  let cutStart: boolean;
  if (arrival < first) {
    colStart = 2;
    cutStart = true;
  } else {
    const idx = dates.indexOf(arrival);
    if (idx < 0) return null;
    colStart = 3 + idx * 2;
    cutStart = false;
  }

  let colEnd: number;
  let cutEnd: boolean;
  if (departure > last) {
    colEnd = 2 + dates.length * 2;
    cutEnd = true;
  } else {
    const depIdx = dates.indexOf(departure);
    if (depIdx < 0) return null;
    colEnd = 3 + depIdx * 2;
    cutEnd = false;
  }

  if (colStart >= colEnd) return null;
  return { colStart, colEnd, cutStart, cutEnd };
}

export type LaneItem = { colStart: number; colEnd: number; arrivalDate: string };

export function assignLanes<T extends LaneItem>(items: T[]): T[][] {
  const sorted = [...items].sort(
    (a, b) => a.arrivalDate.localeCompare(b.arrivalDate) || a.colStart - b.colStart,
  );
  const lanes: T[][] = [];
  for (const item of sorted) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1]!;
      if (last.colEnd <= item.colStart) {
        lane.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([item]);
  }
  return lanes;
}
