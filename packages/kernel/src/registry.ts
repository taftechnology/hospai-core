import housekeeping from '@hospai/pms-housekeeping';
import maintenance from '@hospai/pms-maintenance';
import products from '@hospai/pms-products';
import { defineModule } from './define-module.js';

export const MODULE_REGISTRY = [
  defineModule(housekeeping),
  defineModule(products),
  defineModule(maintenance),
] as const;
