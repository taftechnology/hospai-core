import { describe, expect, it } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FOLIO_MUTATION_ROUTES,
  type FolioMutationRouteKey,
} from './folio-mutation-routes.js';
import {
  messageForFolioMutationError,
  routeIdForFolioAction,
} from './use-folio-action-mutation.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('useFolioActionMutation wiring', () => {
  it('routeIdForFolioAction always follows FOLIO_MUTATION_ROUTES', () => {
    for (const key of Object.keys(FOLIO_MUTATION_ROUTES) as FolioMutationRouteKey[]) {
      expect(routeIdForFolioAction(key)).toBe(FOLIO_MUTATION_ROUTES[key]);
    }
  });

  it('forbidden message uses the action key’s route, not a sibling', () => {
    const err = new ClassifiedError({
      class: 'forbidden',
      status: 403,
      body: { error: 'forbidden' },
      retryAfterMs: null,
    });
    expect(messageForFolioMutationError(err, 'Cash failed', 'cash')).toMatch(/folio:post/);
    expect(messageForFolioMutationError(err, 'Cash failed', 'cash')).not.toMatch(/folio:adjust/);
    expect(messageForFolioMutationError(err, 'Split failed', 'split')).toMatch(/folio:adjust/);
  });

  it('FolioScreen binds every route key exactly once via useFolioActionMutation', () => {
    const src = readFileSync(join(here, 'FolioScreen.tsx'), 'utf8');
    for (const key of Object.keys(FOLIO_MUTATION_ROUTES) as FolioMutationRouteKey[]) {
      const re = new RegExp(`useFolioActionMutation\\(\\s*'${key}'`, 'g');
      const matches = src.match(re);
      expect(matches, `expected exactly one useFolioActionMutation('${key}', …)`).toHaveLength(
        1,
      );
    }
    // No leftover direct FOLIO_MUTATION_ROUTES lookups in onError paths
    expect(src).not.toMatch(/onClassifiedError/);
    expect(src).not.toMatch(/FOLIO_MUTATION_ROUTES\./);
  });
});
