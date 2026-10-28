import {
  CHARGE_CODE_NOT_POSTABLE,
  LIMIT_EXCEEDED,
  PRODUCT_CATEGORY_EXISTS,
  PRODUCT_CATEGORY_NOT_FOUND,
  PRODUCT_EXISTS,
  PRODUCT_INVALID_AMOUNT,
  PRODUCT_NOT_FOUND,
  PRODUCT_SKU_TAKEN,
  VALIDATION_ERROR,
} from '@hospai/contracts';

/** Messages are wire codes; PropertyDO maps them through `mapPropertyCommandError`. */
export class ProductCategoryExistsError extends Error {
  constructor() {
    super(PRODUCT_CATEGORY_EXISTS);
  }
}
export class ProductExistsError extends Error {
  constructor() {
    super(PRODUCT_EXISTS);
  }
}
export class ProductSkuTakenError extends Error {
  constructor() {
    super(PRODUCT_SKU_TAKEN);
  }
}
export class ProductInvalidAmountError extends Error {
  constructor() {
    super(PRODUCT_INVALID_AMOUNT);
  }
}
export class ProductCategoryNotFoundError extends Error {
  constructor() {
    super(PRODUCT_CATEGORY_NOT_FOUND);
  }
}
export class ProductNotFoundError extends Error {
  constructor() {
    super(PRODUCT_NOT_FOUND);
  }
}
export class ChargeCodeNotPostableError extends Error {
  constructor() {
    super(CHARGE_CODE_NOT_POSTABLE);
  }
}
export class ProductLimitExceededError extends Error {
  constructor() {
    super(LIMIT_EXCEEDED);
  }
}
export class ProductValidationError extends Error {
  constructor() {
    super(VALIDATION_ERROR);
  }
}
