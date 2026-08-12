import housekeeping from '@hospai/pms-housekeeping';
import { defineModule } from './define-module.js';

export const MODULE_REGISTRY = [defineModule(housekeeping)] as const;
