import { isStaffRef } from '@hospai/contracts';

export { isStaffRef };

export class HousekeepingRoomNotFoundError extends Error {
  constructor() {
    super('room_not_found');
    this.name = 'HousekeepingRoomNotFoundError';
  }
}

export class InvalidAssigneeRefError extends Error {
  constructor() {
    super('invalid_assignee_ref');
    this.name = 'InvalidAssigneeRefError';
  }
}

export class HousekeepingRoomOutOfOrderError extends Error {
  constructor() {
    super('room_out_of_order');
    this.name = 'HousekeepingRoomOutOfOrderError';
  }
}

export class HousekeepingOooViaRangeError extends Error {
  constructor() {
    super('ooo_via_range');
    this.name = 'HousekeepingOooViaRangeError';
  }
}
