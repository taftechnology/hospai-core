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
        intent="primary"
      >
        Save
      </Button>,
    );
    const btn = screen.getByTestId('save-btn');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-label', 'Save');
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
