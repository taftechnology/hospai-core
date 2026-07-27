/** A single stay-date inventory row. */
export type InventoryRow = {
  stayDate: string;
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
};
