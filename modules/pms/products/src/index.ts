export { default } from './module.manifest.js';
export {
  createProductCategory,
  updateProductCategory,
  type CreateCategoryInput,
  type ProductCategory,
  type UpdateCategoryInput,
} from './application/categories.js';
export {
  createProductItem,
  updateProductItem,
  type CreateItemInput,
  type ProductItemRecord,
  type ProductWriteOptions,
  type UpdateItemInput,
} from './application/items.js';
export { readProducts, type ProductItem, type ProductsRead } from './application/read-products.js';
export {
  ChargeCodeNotPostableError,
  ProductCategoryExistsError,
  ProductCategoryNotFoundError,
  ProductExistsError,
  ProductInvalidAmountError,
  ProductLimitExceededError,
  ProductNotFoundError,
  ProductSkuTakenError,
  ProductValidationError,
} from './domain/errors.js';
export {
  MAX_PRODUCT_AMOUNT_MINOR,
  MAX_PRODUCT_CATEGORIES,
  MAX_PRODUCT_ITEMS,
  PRODUCT_ID_RE,
} from './domain/validation.js';
