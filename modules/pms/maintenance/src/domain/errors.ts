import {
  LIMIT_EXCEEDED,
  ROOM_NOT_FOUND,
  TASK_TYPE_NOT_FOUND,
  TICKET_CLOSED,
  TICKET_NOT_FOUND,
  INVALID_TICKET_TRANSITION,
  VALIDATION_ERROR,
} from '@hospai/contracts';

/** Messages are wire codes; PropertyDO maps them through `mapPropertyCommandError`. */
export class TicketNotFoundError extends Error {
  constructor() {
    super(TICKET_NOT_FOUND);
  }
}
export class TicketClosedError extends Error {
  constructor() {
    super(TICKET_CLOSED);
  }
}
export class InvalidTicketTransitionError extends Error {
  constructor() {
    super(INVALID_TICKET_TRANSITION);
  }
}
export class TaskTypeNotFoundError extends Error {
  constructor() {
    super(TASK_TYPE_NOT_FOUND);
  }
}
export class RoomNotFoundError extends Error {
  constructor() {
    super(ROOM_NOT_FOUND);
  }
}
export class MaintenanceLimitExceededError extends Error {
  constructor() {
    super(LIMIT_EXCEEDED);
  }
}
export class MaintenanceValidationError extends Error {
  constructor() {
    super(VALIDATION_ERROR);
  }
}
