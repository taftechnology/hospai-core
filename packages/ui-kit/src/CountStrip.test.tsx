import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CountStrip } from './CountStrip.js';

describe('CountStrip', () => {
  it('renders group with label and children', () => {
    render(
      <CountStrip label="Summary">
        <span className="ui-count">
          <b>3</b> arrivals
        </span>
      </CountStrip>,
    );
    expect(screen.getByRole('group', { name: 'Summary' })).toHaveClass('ui-counts');
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
