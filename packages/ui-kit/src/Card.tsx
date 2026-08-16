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
};

export function CardHeader({ children }: CardHeaderProps) {
  return <div className="ui-card__header">{children}</div>;
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
