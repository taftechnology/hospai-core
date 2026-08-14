import type { ReactNode } from 'react';

export type CardProps = {
  children?: ReactNode;
};

export function Card({ children }: CardProps) {
  return <div className="ui-card">{children}</div>;
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
  return <h1 className="ui-card__title">{children}</h1>;
}

export type CardContentProps = {
  children?: ReactNode;
};

export function CardContent({ children }: CardContentProps) {
  return <div className="ui-card__content">{children}</div>;
}

export type CardFooterProps = {
  children?: ReactNode;
};

export function CardFooter({ children }: CardFooterProps) {
  return <div className="ui-card__footer">{children}</div>;
}
