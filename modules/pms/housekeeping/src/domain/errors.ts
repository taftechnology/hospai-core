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
