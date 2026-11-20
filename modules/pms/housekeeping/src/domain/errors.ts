import {
  INSUFFICIENT_STOCK,
  INSPECTION_REQUIRED,
  AUDIT_SESSION_OPEN,
  INVALID_REQUEST,
  INVALID_TASK_TRANSITION,
  NOT_FOUND,
  REASON_REQUIRED,
  INVENTORY_ITEM_ARCHIVED,
  INVENTORY_ITEM_EXISTS,
  INVENTORY_ITEM_NOT_FOUND,
  LIMIT_EXCEEDED,
  VALIDATION_ERROR,
  isStaffRef,
} from '@hospai/contracts';

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

export class HousekeepingInventoryItemNotFoundError extends Error {
  constructor() {
    super(INVENTORY_ITEM_NOT_FOUND);
    this.name = 'HousekeepingInventoryItemNotFoundError';
  }
}

export class HousekeepingInventoryItemExistsError extends Error {
  constructor() {
    super(INVENTORY_ITEM_EXISTS);
    this.name = 'HousekeepingInventoryItemExistsError';
  }
}

export class HousekeepingInventoryItemArchivedError extends Error {
  constructor() {
    super(INVENTORY_ITEM_ARCHIVED);
    this.name = 'HousekeepingInventoryItemArchivedError';
  }
}

export class HousekeepingInsufficientStockError extends Error {
  constructor() {
    super(INSUFFICIENT_STOCK);
    this.name = 'HousekeepingInsufficientStockError';
  }
}

export class HousekeepingInventoryLimitExceededError extends Error {
  constructor() {
    super(LIMIT_EXCEEDED);
    this.name = 'HousekeepingInventoryLimitExceededError';
  }
}

export class HousekeepingInventoryValidationError extends Error {
  constructor() {
    super(VALIDATION_ERROR);
    this.name = 'HousekeepingInventoryValidationError';
  }
}

export class HousekeepingReasonRequiredError extends Error {
  constructor() {
    super(REASON_REQUIRED);
    this.name = 'HousekeepingReasonRequiredError';
  }
}

export class HousekeepingInvalidRequestError extends Error {
  constructor() {
    super(INVALID_REQUEST);
    this.name = 'HousekeepingInvalidRequestError';
  }
}

export class HousekeepingLimitError extends Error {
  constructor() {
    super(LIMIT_EXCEEDED);
    this.name = 'HousekeepingLimitError';
  }
}

export class HousekeepingTaskNotFoundError extends Error {
  constructor() {
    super(NOT_FOUND);
    this.name = 'HousekeepingTaskNotFoundError';
  }
}

export class HousekeepingInvalidTaskTransitionError extends Error {
  constructor() {
    super(INVALID_TASK_TRANSITION);
    this.name = 'HousekeepingInvalidTaskTransitionError';
  }
}

/** A request, lost item or case id that is not in this property (R4.11). */
export class HousekeepingRecordNotFoundError extends Error {
  constructor() {
    super(NOT_FOUND);
    this.name = 'HousekeepingRecordNotFoundError';
  }
}

/** Release of a room while inspection is required and the task has no passed inspection (R4.11 B). */
export class HousekeepingInspectionRequiredError extends Error {
  constructor() {
    super(INSPECTION_REQUIRED);
    this.name = 'HousekeepingInspectionRequiredError';
  }
}

/** A guest-count audit session is already open for the business date (R4.11 B). */
export class HousekeepingAuditSessionOpenError extends Error {
  constructor() {
    super(AUDIT_SESSION_OPEN);
    this.name = 'HousekeepingAuditSessionOpenError';
  }
}
