import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import type { TestIdProps } from './types.js';

export type DataTableProps = {
  children?: ReactNode;
};

export function DataTable({ children }: DataTableProps) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">{children}</table>
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

export type DataTableRowProps = TestIdProps & {
  children?: ReactNode;
};

export function DataTableRow({ children, 'data-testid': dataTestId }: DataTableRowProps) {
  return <tr data-testid={dataTestId}>{children}</tr>;
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
  Pick<TdHTMLAttributes<HTMLTableCellElement>, 'colSpan' | 'rowSpan'> & {
    children?: ReactNode;
    align?: CellAlign;
  };

export function DataTableCell({
  children,
  colSpan,
  rowSpan,
  align = 'left',
  'data-testid': dataTestId,
}: DataTableCellProps) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} align={align} data-testid={dataTestId}>
      {children}
    </td>
  );
}
