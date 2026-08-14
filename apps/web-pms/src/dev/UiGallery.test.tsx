import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ALL_NAV } from '../shell/module-ui-registry.js';
import { UiGallery } from './UiGallery.js';

describe('/dev/ui gallery', () => {
  it('renders every exported component without PropertyDO or /me', () => {
    render(
      <MemoryRouter>
        <UiGallery />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'UI kit gallery' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Link button' })).toBeTruthy();
    expect(screen.getByLabelText('Text')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Something needs attention')).toBeTruthy();
    expect(screen.getByTestId('gallery-skeleton')).toBeTruthy();
  });

  it('is absent from ALL_NAV', () => {
    expect(ALL_NAV.map((e) => e.id)).not.toContain('dev/ui');
    expect(ALL_NAV.map((e) => e.path)).not.toContain('/dev/ui');
  });
});
