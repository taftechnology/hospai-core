export type ModuleManifest = {
  id: string;
  version: string;
  entitlement: string;
  requires?: string[];
  schema: { prefix?: string | null; tables: string[] };
  writes: string[];
  publishes?: string[];
  subscribes?: Array<{ event: string; handler: string }>;
  permissions?: string[];
  meters?: string[];
  lifecycle?: {
    onActivate?: string;
    onDeactivate?: string;
    onPurge?: string;
  };
};
