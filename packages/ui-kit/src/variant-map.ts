import clsx from 'clsx';
import type { ButtonIntent, ControlSize } from './types.js';

const BUTTON_INTENT: Record<ButtonIntent, string> = {
  default: '',
  primary: 'ui-btn--primary btn-primary',
  destructive: 'ui-btn--destructive btn-destructive',
  ghost: 'ui-btn--ghost',
};

const BUTTON_SIZE: Record<ControlSize, string> = {
  sm: 'ui-btn--sm',
  md: '',
};

const LINK_INTENT: Record<ButtonIntent, string> = {
  default: '',
  primary: 'ui-link-btn--primary',
  destructive: 'ui-link-btn--destructive',
  ghost: 'ui-link-btn--ghost',
};

const LINK_SIZE: Record<ControlSize, string> = {
  sm: 'ui-link-btn--sm',
  md: '',
};

export function buttonClasses(intent: ButtonIntent = 'default', size: ControlSize = 'md'): string {
  return clsx('ui-btn', BUTTON_INTENT[intent], BUTTON_SIZE[size]);
}

export function linkButtonClasses(
  intent: ButtonIntent = 'default',
  size: ControlSize = 'md',
): string {
  return clsx('ui-link-btn', LINK_INTENT[intent], LINK_SIZE[size]);
}

export function statusRungClass(rung: import('./types.js').StatusRung): string {
  return `status-${rung}`;
}
