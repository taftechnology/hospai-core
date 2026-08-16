import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  AlertTitle,
  EmptyState,
  Field,
  Input,
  Metric,
  Metrics,
  PageHeader,
  RowActions,
  SectionLabel,
  Tabs,
  Toolbar,
  Total,
  VisuallyHidden,
} from './index.js';

describe('PageHeader', () => {
  it('renders exactly one h1 carrying the title', () => {
    render(<PageHeader title="Front Desk" subtitle="Sunday, 16 August" />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Front Desk');
  });

  it('renders back and actions slots only when supplied', () => {
    const { container, rerender } = render(<PageHeader title="Folio" />);
    expect(container.querySelector('.ui-page-header__actions')).toBeNull();
    expect(container.querySelector('.ui-page-header__back')).toBeNull();

    rerender(
      <PageHeader title="Folio" back={<a href="/board">Board</a>} actions={<button>Print</button>} />,
    );
    expect(container.querySelector('.ui-page-header__actions')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Board' })).toBeTruthy();
  });

  it('forwards data-testid', () => {
    render(<PageHeader title="Rates" data-testid="rates-header" />);
    expect(screen.getByTestId('rates-header')).toBeTruthy();
  });
});

describe('Alert', () => {
  it('defaults to the exception intent so existing call sites are unchanged', () => {
    const { container } = render(<Alert>Check-in refused.</Alert>);
    const el = container.querySelector('.ui-alert');
    expect(el?.classList.contains('ui-alert--exception')).toBe(true);
  });

  it('keeps role=alert on every intent', () => {
    render(<Alert intent="informational">Guest credit</Alert>);
    expect(screen.getByRole('alert').textContent).toBe('Guest credit');
  });

  it('applies the requested intent class', () => {
    const { container } = render(
      <Alert intent="attention">
        <AlertTitle>Room not ready</AlertTitle>
      </Alert>,
    );
    expect(container.querySelector('.ui-alert--attention')).not.toBeNull();
    expect(container.querySelector('.ui-alert__title')?.textContent).toBe('Room not ready');
  });
});

describe('Field size', () => {
  it('defaults to md with no modifier class', () => {
    const { container } = render(<Field label="Guest" control={<Input />} />);
    const field = container.querySelector('.ui-field');
    expect(field?.className).toBe('ui-field');
  });

  it('applies a width-cap modifier and keeps label association', () => {
    const { container } = render(<Field label="Nights" size="xs" control={<Input />} />);
    expect(container.querySelector('.ui-field--xs')).not.toBeNull();
    expect(screen.getByLabelText('Nights')).toBeTruthy();
  });

  it('full removes the cap', () => {
    const { container } = render(<Field label="Config" size="full" control={<Input />} />);
    expect(container.querySelector('.ui-field--full')).not.toBeNull();
  });
});

describe('layout primitives', () => {
  it('EmptyState renders title, description and an optional action', () => {
    render(
      <EmptyState
        title="No exceptions match these filters"
        description="Try widening the date range."
        action={<button>Clear</button>}
      />,
    );
    expect(screen.getByText('No exceptions match these filters')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('Metric separates label from value', () => {
    const { container } = render(
      <Metrics>
        <Metric label="Arrivals" value={4} />
      </Metrics>,
    );
    expect(container.querySelector('.ui-metric__value')?.textContent).toBe('4');
  });

  it('Total tones map to modifier classes', () => {
    const { container } = render(<Total label="Balance due" value="-$36.50" tone="credit" />);
    expect(container.querySelector('.ui-total__value--credit')).not.toBeNull();
  });

  it('Tabs exposes an accessible name', () => {
    render(
      <Tabs label="Rates views">
        <a className="ui-tab" aria-current="page" href="#m">
          Matrix
        </a>
      </Tabs>,
    );
    expect(screen.getByRole('navigation', { name: 'Rates views' })).toBeTruthy();
  });

  it('Toolbar and RowActions render their children', () => {
    const { container } = render(
      <Toolbar>
        <RowActions>
          <button>Check in</button>
        </RowActions>
      </Toolbar>,
    );
    expect(container.querySelector('.ui-toolbar .ui-row-actions')).not.toBeNull();
  });

  it('VisuallyHidden keeps text in the accessibility tree', () => {
    render(<VisuallyHidden>Rate for KDX on 2026-08-16</VisuallyHidden>);
    expect(screen.getByText('Rate for KDX on 2026-08-16')).toBeTruthy();
  });

  it('SectionLabel is not a heading, so it cannot outrank the page title', () => {
    render(<SectionLabel>Availability</SectionLabel>);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Availability')).toBeTruthy();
  });
});
