import type { PropertyScopedPermission } from './permissions.js';

export type ModuleUiNavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
};

export type ModuleUiManifest = {
  moduleId: string;
  nav: ModuleUiNavEntry[];
};
