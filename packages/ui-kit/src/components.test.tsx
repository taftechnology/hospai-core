import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  LinkButton,
  NativeSelect,
  RoomStatus,
  StatField,
  StatusBadge,
} from './index.js';

describe('ui-kit behaviour', () => {
  it('Button forwards data-testid, disabled, aria-*, ref to button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        ref={ref}
        data-testid="save-btn"
        disabled
        aria-label="Save"
        aria-pressed={true}
        intent="primary"
      >
        Save
      </Button>,
    );
    const btn = screen.getByTestId('save-btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-label', 'Save');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(ref.current).toBe(btn);
  });

  it('NativeSelect renders select; selectOptions works', async () => {
    const user = userEvent.setup();
    render(
      <NativeSelect aria-label="Room" defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox');
    expect(select.tagName).toBe('SELECT');
    await user.selectOptions(select, 'b');
    expect(select).toHaveValue('b');
  });

  it('Checkbox renders input checkbox', () => {
    render(<Checkbox aria-label="Agree" />);
    const box = screen.getByRole('checkbox');
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveAttribute('type', 'checkbox');
  });

  it('Field associates label and control', () => {
    render(<Field label="Guest name" control={<Input />} />);
    expect(screen.getByLabelText('Guest name')).toBeInTheDocument();
  });

  it('Field keeps one height across text, date, number, select', () => {
    const { rerender } = render(<Field label="Text" control={<Input type="text" />} />);
    const text = screen.getByLabelText('Text');
    rerender(<Field label="Date" control={<Input type="date" />} />);
    const date = screen.getByLabelText('Date');
    rerender(<Field label="Number" control={<Input type="number" />} />);
    const number = screen.getByLabelText('Number');
    rerender(
      <Field
        label="Select"
        control={
          <NativeSelect>
            <option value="x">X</option>
          </NativeSelect>
        }
      />,
    );
    const select = screen.getByLabelText('Select');
    for (const el of [text, date, number, select]) {
      expect(el.className).toMatch(/ui-(input|select)/);
    }
  });

  it('DataTable renders table with sticky scroll container', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Rows</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              <DataTableRow>
                <DataTableCell>Ada</DataTableCell>
              </DataTableRow>
            </DataTableBody>
          </DataTable>
        </CardContent>
      </Card>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(document.querySelector('.ui-table-scroll')).toBeTruthy();
  });

  it('DataTable dense adds ui-table--dense', () => {
    render(
      <DataTable dense>
        <DataTableBody>
          <DataTableRow>
            <DataTableCell>Ada</DataTableCell>
          </DataTableRow>
        </DataTableBody>
      </DataTable>,
    );
    expect(screen.getByRole('table').className).toMatch(/ui-table--dense/);
  });

  it('CardTitle renders heading level 2', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Section</CardTitle>
        </CardHeader>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('CardContent flush applies ui-card__content--flush', () => {
    render(
      <Card>
        <CardContent flush>
          <p>Flush body</p>
        </CardContent>
      </Card>,
    );
    const content = screen.getByText('Flush body').parentElement;
    expect(content?.className).toMatch(/ui-card__content--flush/);
  });

  it('Badge with rung exception emits status-exception', () => {
    render(<Badge rung="exception">Late</Badge>);
    expect(screen.getByText('Late').className).toMatch(/status-exception/);
  });

  it('Alert keeps role alert', () => {
    render(<Alert>Something failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });

  it('StatusBadge uses the fixed word and tone for each reservation status', () => {
    const cases = [
      ['inquiry', 'Inquiry', 'status-neutral'],
      ['pending', 'Pending', 'stay-pending'],
      ['confirmed', 'Confirmed', 'stay-confirmed'],
      ['checked_in', 'In house', 'stay-inhouse'],
      ['checked_out', 'Checked out', 'status-cancelled'],
      ['cancelled', 'Cancelled', 'status-cancelled'],
      ['no_show', 'No-show', 'status-exception'],
    ] as const;
    const { rerender } = render(<StatusBadge status="inquiry" />);
    for (const [status, word, tone] of cases) {
      rerender(<StatusBadge status={status} />);
      const pill = screen.getByText(word);
      expect(pill.className).toMatch(/ui-badge/);
      expect(pill.className).toMatch(new RegExp(tone));
    }
  });

  it('StatusBadge adds a VIP pill without replacing the status word', () => {
    render(<StatusBadge status="confirmed" vip />);
    expect(screen.getByText('Confirmed').className).toMatch(/stay-confirmed/);
    const vip = screen.getByTestId('badge-vip');
    expect(vip).toHaveTextContent('VIP');
    expect(vip.className).toMatch(/status-vip/);
    expect(vip.className).toMatch(/ui-badge/);
  });

  it('RoomStatus shows a dot and the fixed word, and unknown values stay raw', () => {
    const cases = [
      ['clean', 'Clean'],
      ['dirty', 'Dirty'],
      ['inspected', 'Inspected'],
      ['out_of_order', 'Out of order'],
    ] as const;
    const { rerender } = render(<RoomStatus status="clean" />);
    for (const [status, word] of cases) {
      rerender(<RoomStatus status={status} />);
      expect(screen.getByText(word)).toBeInTheDocument();
      expect(document.querySelector('.ui-room-status__dot')).toBeTruthy();
    }
    rerender(<RoomStatus status="mystery" />);
    const fallback = screen.getByText('mystery');
    expect(fallback.className).toMatch(/status-neutral/);
    expect(fallback.className).toMatch(/ui-badge/);
    expect(document.querySelector('.ui-room-status__dot')).toBeNull();
  });

  it('CardHeader eyebrow sits above the title', () => {
    render(
      <Card>
        <CardHeader eyebrow="Front office / Today">
          <CardTitle>Rooms available tonight</CardTitle>
        </CardHeader>
      </Card>,
    );
    const eyebrow = screen.getByText('Front office / Today');
    expect(eyebrow.className).toMatch(/ui-card__eyebrow/);
    expect(eyebrow.compareDocumentPosition(screen.getByRole('heading', { level: 2 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('StatField stacks a label over a value', () => {
    render(<StatField label="Vacant, not out of order" value="20" />);
    const label = screen.getByText('Vacant, not out of order');
    const value = screen.getByText('20');
    expect(label.className).toMatch(/ui-stat-field__label/);
    expect(value.className).toMatch(/ui-stat-field__value/);
    expect(label.compareDocumentPosition(value)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('LinkButton renders anchor with button classes', () => {
    render(
      <LinkButton href="/shift" intent="ghost">
        Close
      </LinkButton>,
    );
    const link = screen.getByRole('link', { name: 'Close' });
    expect(link.tagName).toBe('A');
    expect(link.className).toMatch(/ui-link-btn/);
  });
});
