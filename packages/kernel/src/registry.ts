import housekeeping from '@hospai/pms-housekeeping';
import products from '@hospai/pms-products';
import { defineModule } from './define-module.js';

export const MODULE_REGISTRY = [defineModule(housekeeping), defineModule(products)] as const;
