import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * vitest runs without `globals`, so Testing Library's automatic cleanup
 * hook never registers and rendered trees accumulate across tests in a
 * file — which makes `screen` queries find matches from earlier cases.
 */
afterEach(cleanup);
