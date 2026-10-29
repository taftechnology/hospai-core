import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { TestIdProps } from './types.js';

export type CardProps = TestIdProps &
  React.ComponentPropsWithoutRef<'div'> & {
    children?: ReactNode;
  };

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={clsx('ui-card', className)} {...rest}>
      {children}
    </div>
  );
}

export type CardHeaderProps = {
  children?: ReactNode;
  /** Sentence case. CSS uppercases it. */
  eyebrow?: string;
};

export function CardHeader({ children, eyebrow }: CardHeaderProps) {
  return (
    <div className={clsx('ui-card__header', eyebrow && 'ui-card__header--with-eyebrow')}>
      {eyebrow ? <p className="ui-card__eyebrow">{eyebrow}</p> : null}
      {children}
    </div>
  );
}

export type CardTitleProps = {
  children?: ReactNode;
};

export function CardTitle({ children }: CardTitleProps) {
  return <h2 className="ui-card__title">{children}</h2>;
}

export type CardContentProps = {
  children?: ReactNode;
  flush?: boolean;
};

export function CardContent({ children, flush }: CardContentProps) {
  return (
    <div className={clsx('ui-card__content', flush && 'ui-card__content--flush')}>
      {children}
    </div>
  );
}

export type CardFooterProps = {
  children?: ReactNode;
};

export function CardFooter({ children }: CardFooterProps) {
  return <div className="ui-card__footer">{children}</div>;
}
