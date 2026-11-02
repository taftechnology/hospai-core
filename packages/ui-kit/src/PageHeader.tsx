import type { ReactNode } from 'react';
import type { TestIdProps } from './types.js';

export type PageHeaderProps = TestIdProps & {
  /** The page's single <h1>. */
  title: ReactNode;
  /** Inline counts or meta beside the title (same line). */
  lead?: ReactNode;
  /** Meta line under the title — status, room, dates. */
  subtitle?: ReactNode;
  /** Back affordance, e.g. a router <Link>. */
  back?: ReactNode;
  /** Right-aligned page actions. */
  actions?: ReactNode;
};

/**
 * Every screen's anatomy: back link, title, subtitle, actions.
 * Gives one <h1> per page and keeps in-page headings quieter than it.
 */
export function PageHeader({
  title,
  lead,
  subtitle,
  back,
  actions,
  'data-testid': dataTestId,
}: PageHeaderProps) {
  return (
    <div className="ui-page-header" data-testid={dataTestId}>
      <div className="ui-page-header__text">
        {back ? <span className="ui-page-header__back">{back}</span> : null}
        <div className="ui-page-header__title-row">
          <h1 className="ui-page-header__title">{title}</h1>
          {lead ? <div className="ui-page-header__lead">{lead}</div> : null}
        </div>
        {subtitle ? <div className="ui-page-header__subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </div>
  );
}

export type SectionLabelProps = {
  children?: ReactNode;
};

/** A heading that must not outweigh the page title. */
export function SectionLabel({ children }: SectionLabelProps) {
  return <p className="ui-section-label">{children}</p>;
}
