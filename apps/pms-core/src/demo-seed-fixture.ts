export const DEMO_ORG_ID = 'org_demo';
export const DEMO_ORG_NAME = 'Harborlight Hospitality';
export const DEMO_PROPERTY_ID = 'prop_demo';
export const DEMO_PROPERTY_NAME = 'The Meridian Seattle';
export const DEMO_TIME_ZONE = 'America/Los_Angeles';
export const DEMO_CURRENCY = 'USD';

export const DEMO_RATE_AMOUNTS = {
  rt_king: 28900,
  rt_twin: 21900,
  rt_suite: 42900,
} as const;

export type DemoRoomType = {
  roomTypeId: 'rt_king' | 'rt_twin' | 'rt_suite';
  code: string;
  name: string;
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
};

export type DemoRoom = {
  roomId: string;
  code: string;
  roomTypeId: DemoRoomType['roomTypeId'];
  floor: string;
};

export type DemoGuest = { guestId: string; displayName: string; email: string };

export type DemoStay = {
  reservationId: string;
  guestId: string;
  roomTypeId: DemoRoomType['roomTypeId'];
  roomId: string | null;
  arrivalOffset: number;
  departureOffset: number;
  checkIn: boolean;
};

export const DEMO_ROOM_TYPES: readonly DemoRoomType[] = [
  {
    roomTypeId: 'rt_king',
    code: 'KDX',
    name: 'King Deluxe',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
  },
  {
    roomTypeId: 'rt_twin',
    code: 'TWN',
    name: 'Twin',
    roomCount: 6,
    maxOccupancy: 2,
    maxAdults: 2,
  },
  {
    roomTypeId: 'rt_suite',
    code: 'STE',
    name: 'Suite',
    roomCount: 4,
    maxOccupancy: 3,
    maxAdults: 2,
  },
];

function roomsFor(
  type: DemoRoomType['roomTypeId'],
  floor: string,
  codes: readonly string[],
): DemoRoom[] {
  return codes.map((code) => ({
    roomId: `rm_${code}`,
    code,
    roomTypeId: type,
    floor,
  }));
}

export const DEMO_ROOMS: readonly DemoRoom[] = [
  ...roomsFor('rt_king', '1', ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110']),
  ...roomsFor('rt_twin', '2', ['201', '202', '203', '204', '205', '206']),
  ...roomsFor('rt_suite', '3', ['301', '302', '303', '304']),
];

export const DEMO_GUESTS: readonly DemoGuest[] = [
  { guestId: 'gst_james_whitaker', displayName: 'James Whitaker', email: 'james.whitaker@example.com' },
  { guestId: 'gst_priya_nair', displayName: 'Priya Nair', email: 'priya.nair@example.com' },
  { guestId: 'gst_elena_rossi', displayName: 'Elena Rossi', email: 'elena.rossi@example.com' },
  { guestId: 'gst_marcus_chen', displayName: 'Marcus Chen', email: 'marcus.chen@example.com' },
  { guestId: 'gst_hannah_brooks', displayName: 'Hannah Brooks', email: 'hannah.brooks@example.com' },
  { guestId: 'gst_robert_hale', displayName: 'Robert Hale', email: 'robert.hale@example.com' },
  { guestId: 'gst_sofia_alvarez', displayName: 'Sofia Alvarez', email: 'sofia.alvarez@example.com' },
  { guestId: 'gst_david_okonkwo', displayName: 'David Okonkwo', email: 'david.okonkwo@example.com' },
  { guestId: 'gst_claire_fontaine', displayName: 'Claire Fontaine', email: 'claire.fontaine@example.com' },
  { guestId: 'gst_tomiko_sato', displayName: 'Tomiko Sato', email: 'tomiko.sato@example.com' },
  { guestId: 'gst_benjamin_walsh', displayName: 'Benjamin Walsh', email: 'benjamin.walsh@example.com' },
  { guestId: 'gst_amira_hassan', displayName: 'Amira Hassan', email: 'amira.hassan@example.com' },
  { guestId: 'gst_lydia_grant', displayName: 'Lydia Grant', email: 'lydia.grant@example.com' },
  { guestId: 'gst_owen_fischer', displayName: 'Owen Fischer', email: 'owen.fischer@example.com' },
];

export const DEMO_STAYS: readonly DemoStay[] = [
  {
    reservationId: 'res_demo_ih_01',
    guestId: 'gst_james_whitaker',
    roomTypeId: 'rt_king',
    roomId: 'rm_101',
    arrivalOffset: -1,
    departureOffset: 3,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_ih_02',
    guestId: 'gst_priya_nair',
    roomTypeId: 'rt_king',
    roomId: 'rm_102',
    arrivalOffset: -1,
    departureOffset: 2,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_ih_03',
    guestId: 'gst_elena_rossi',
    roomTypeId: 'rt_twin',
    roomId: 'rm_201',
    arrivalOffset: -2,
    departureOffset: 4,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_ih_04',
    guestId: 'gst_marcus_chen',
    roomTypeId: 'rt_suite',
    roomId: 'rm_301',
    arrivalOffset: -1,
    departureOffset: 5,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_ih_05',
    guestId: 'gst_hannah_brooks',
    roomTypeId: 'rt_king',
    roomId: 'rm_103',
    arrivalOffset: -1,
    departureOffset: 3,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_dep_01',
    guestId: 'gst_robert_hale',
    roomTypeId: 'rt_king',
    roomId: 'rm_104',
    arrivalOffset: -2,
    departureOffset: 0,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_dep_02',
    guestId: 'gst_sofia_alvarez',
    roomTypeId: 'rt_twin',
    roomId: 'rm_202',
    arrivalOffset: -1,
    departureOffset: 0,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_dep_03',
    guestId: 'gst_david_okonkwo',
    roomTypeId: 'rt_king',
    roomId: 'rm_105',
    arrivalOffset: -2,
    departureOffset: 0,
    checkIn: true,
  },
  {
    reservationId: 'res_demo_arr_01',
    guestId: 'gst_claire_fontaine',
    roomTypeId: 'rt_king',
    roomId: 'rm_106',
    arrivalOffset: 0,
    departureOffset: 2,
    checkIn: false,
  },
  {
    reservationId: 'res_demo_arr_02',
    guestId: 'gst_tomiko_sato',
    roomTypeId: 'rt_twin',
    roomId: 'rm_203',
    arrivalOffset: 0,
    departureOffset: 3,
    checkIn: false,
  },
  {
    reservationId: 'res_demo_arr_03',
    guestId: 'gst_benjamin_walsh',
    roomTypeId: 'rt_suite',
    roomId: 'rm_302',
    arrivalOffset: 0,
    departureOffset: 2,
    checkIn: false,
  },
  {
    reservationId: 'res_demo_arr_04',
    guestId: 'gst_amira_hassan',
    roomTypeId: 'rt_king',
    roomId: null,
    arrivalOffset: 0,
    departureOffset: 2,
    checkIn: false,
  },
  {
    reservationId: 'res_demo_fut_01',
    guestId: 'gst_lydia_grant',
    roomTypeId: 'rt_king',
    roomId: 'rm_107',
    arrivalOffset: 2,
    departureOffset: 4,
    checkIn: false,
  },
  {
    reservationId: 'res_demo_fut_02',
    guestId: 'gst_owen_fischer',
    roomTypeId: 'rt_twin',
    roomId: 'rm_204',
    arrivalOffset: 3,
    departureOffset: 5,
    checkIn: false,
  },
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addIsoDate(iso: string, deltaDays: number): string {
  const m = DATE_RE.exec(iso);
  if (!m) throw new Error(`invalid date: ${iso}`);
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function buildDemoSeedPlan(today: string): {
  today: string;
  rateFrom: string;
  rateTo: string;
  backfillFrom: string;
  backfillToExclusive: string;
  stays: Array<DemoStay & { arrivalDate: string; departureDate: string }>;
} {
  return {
    today,
    rateFrom: addIsoDate(today, -2),
    rateTo: addIsoDate(today, 13),
    backfillFrom: addIsoDate(today, -2),
    backfillToExclusive: today,
    stays: DEMO_STAYS.map((stay) => ({
      ...stay,
      arrivalDate: addIsoDate(today, stay.arrivalOffset),
      departureDate: addIsoDate(today, stay.departureOffset),
    })),
  };
}

export function demoIdempotencyKey(kind: string, id: string): string {
  return `demo-seed:v1:${kind}:${id}`;
}
