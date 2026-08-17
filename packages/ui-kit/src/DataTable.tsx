import type {
  HTMLAttributes,
  ReactNode,
  Ref,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { statusRungClass } from './variant-map.js';
import type { StatusRung, TestIdProps } from './types.js';

export type DataTableProps = TestIdProps & {
  children?: ReactNode;
};

export function DataTable({ children, 'data-testid': dataTestId }: DataTableProps) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table" data-testid={dataTestId}>
        {children}
      </table>
    </div>
  );
}

export type DataTableSectionProps = {
  children?: ReactNode;
};

export function DataTableHead({ children }: DataTableSectionProps) {
  return <thead>{children}</thead>;
}

export function DataTableBody({ children }: DataTableSectionProps) {
  return <tbody>{children}</tbody>;
}

export type DataTableRowProps = TestIdProps &
  Pick<HTMLAttributes<HTMLTableRowElement>, 'onClick' | 'tabIndex'> & {
    children?: ReactNode;
    rung?: StatusRung;
    ref?: Ref<HTMLTableRowElement>;
    'data-focused'?: 'true' | undefined;
  };

export function DataTableRow({
  children,
  rung,
  onClick,
  tabIndex,
  ref,
  'data-focused': dataFocused,
  'data-testid': dataTestId,
}: DataTableRowProps) {
  return (
    <tr
      className={rung ? statusRungClass(rung) : undefined}
      data-testid={dataTestId}
      data-focused={dataFocused}
      onClick={onClick}
      tabIndex={tabIndex}
      ref={ref}
    >
      {children}
    </tr>
  );
}

type CellAlign = 'left' | 'center' | 'right';

export type DataTableHeaderCellProps = TestIdProps &
  Pick<ThHTMLAttributes<HTMLTableCellElement>, 'scope' | 'colSpan' | 'rowSpan'> & {
    children?: ReactNode;
    align?: CellAlign;
  };

export function DataTableHeaderCell({
  children,
  scope,
  colSpan,
  rowSpan,
  align = 'left',
  'data-testid': dataTestId,
}: DataTableHeaderCellProps) {
  return (
    <th
      scope={scope}
      colSpan={colSpan}
      rowSpan={rowSpan}
      align={align}
      data-testid={dataTestId}
    >
      {children}
    </th>
  );
}

export type DataTableCellProps = TestIdProps &
  Pick<TdHTMLAttributes<HTMLTableCellElement>, 'colSpan' | 'rowSpan' | 'onClick'> & {
    children?: ReactNode;
    align?: CellAlign;
    rung?: StatusRung;
  };

export function DataTableCell({
  children,
  colSpan,
  rowSpan,
  align = 'left',
  rung,
  onClick,
  'data-testid': dataTestId,
}: DataTableCellProps) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      align={align}
      className={rung ? statusRungClass(rung) : undefined}
      data-testid={dataTestId}
      onClick={onClick}
    >
      {children}
    </td>
  );
}
