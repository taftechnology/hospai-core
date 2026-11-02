import { describe, expectTypeOf, it } from 'vitest';
import type {
  AlertProps,
  ButtonProps,
  CardHeaderProps,
  DialogProps,
  EmptyStateProps,
  FieldGroupProps,
  FieldProps,
  InputProps,
  LinkButtonProps,
  PageHeaderProps,
  RoomStatusProps,
  StatFieldProps,
  StatusBadgeProps,
  TotalProps,
} from './index.js';

describe('ui-kit API surface', () => {
  it('ButtonProps rejects className and style at compile time', () => {
    expectTypeOf<ButtonProps>().not.toHaveProperty('className');
    expectTypeOf<ButtonProps>().not.toHaveProperty('style');
    // @ts-expect-error className is forbidden on ui-kit components
    const badClass: ButtonProps = { className: 'x' };
    void badClass;
    // @ts-expect-error style is forbidden on ui-kit components
    const badStyle: ButtonProps = { style: { margin: 0 } };
    void badStyle;
  });

  it('InputProps rejects className and style at compile time', () => {
    expectTypeOf<InputProps>().not.toHaveProperty('className');
    // @ts-expect-error className is forbidden on ui-kit components
    const badClass: InputProps = { className: 'x' };
    void badClass;
  });

  it('LinkButtonProps rejects className at compile time', () => {
    // @ts-expect-error className is forbidden on ui-kit components
    const bad: LinkButtonProps = { href: '/', className: 'x' };
    void bad;
  });

  it('new layout components reject className and style at compile time', () => {
    expectTypeOf<PageHeaderProps>().not.toHaveProperty('className');
    expectTypeOf<PageHeaderProps>().not.toHaveProperty('style');
    expectTypeOf<EmptyStateProps>().not.toHaveProperty('className');
    expectTypeOf<DialogProps>().not.toHaveProperty('className');
    expectTypeOf<DialogProps>().not.toHaveProperty('style');
    expectTypeOf<FieldGroupProps>().not.toHaveProperty('className');
    expectTypeOf<TotalProps>().not.toHaveProperty('className');
    // @ts-expect-error className is forbidden on ui-kit components
    const badHeader: PageHeaderProps = { title: 'x', className: 'y' };
    void badHeader;
    // @ts-expect-error style is forbidden on ui-kit components
    const badEmpty: EmptyStateProps = { title: 'x', style: { margin: 0 } };
    void badEmpty;
  });

  it('Field size is a closed union', () => {
    expectTypeOf<FieldProps['size']>().toEqualTypeOf<
      'xs' | 'sm' | 'md' | 'lg' | 'full' | undefined
    >();
    // @ts-expect-error invalid field size
    const bad: Pick<FieldProps, 'size'> = { size: 'huge' };
    void bad;
  });

  it('Alert intent is a closed union of rungs that carry a surface', () => {
    expectTypeOf<AlertProps['intent']>().toEqualTypeOf<
      'exception' | 'attention' | 'settled' | 'informational' | undefined
    >();
    // @ts-expect-error neutral has no alert surface
    const bad: AlertProps = { intent: 'neutral' };
    void bad;
  });

  it('Total tone is a closed union', () => {
    expectTypeOf<TotalProps['tone']>().toEqualTypeOf<'neutral' | 'credit' | 'due' | undefined>();
  });

  it('StatusBadge, RoomStatus, StatField, and CardHeader reject className and style', () => {
    expectTypeOf<StatusBadgeProps>().not.toHaveProperty('className');
    expectTypeOf<StatusBadgeProps>().not.toHaveProperty('style');
    expectTypeOf<RoomStatusProps>().not.toHaveProperty('className');
    expectTypeOf<RoomStatusProps>().not.toHaveProperty('style');
    expectTypeOf<StatFieldProps>().not.toHaveProperty('className');
    expectTypeOf<StatFieldProps>().not.toHaveProperty('style');
    expectTypeOf<CardHeaderProps>().not.toHaveProperty('className');
    expectTypeOf<CardHeaderProps>().not.toHaveProperty('style');
    expectTypeOf<CardHeaderProps['eyebrow']>().toEqualTypeOf<string | undefined>();
    // @ts-expect-error className is forbidden on ui-kit components
    const badStatus: StatusBadgeProps = { status: 'confirmed', className: 'x' };
    void badStatus;
    // @ts-expect-error style is forbidden on ui-kit components
    const badRoom: RoomStatusProps = { status: 'clean', style: { margin: 0 } };
    void badRoom;
    // @ts-expect-error className is forbidden on ui-kit components
    const badStat: StatFieldProps = { label: 'Rooms', value: '2', className: 'x' };
    void badStat;
  });

  it('Button intent and size are closed unions', () => {
    expectTypeOf<ButtonProps['intent']>().toEqualTypeOf<
      'default' | 'primary' | 'destructive' | 'ghost' | undefined
    >();
    expectTypeOf<ButtonProps['size']>().toEqualTypeOf<'sm' | 'md' | undefined>();
    expectTypeOf<ButtonProps['aria-pressed']>().toEqualTypeOf<
      boolean | 'true' | 'false' | 'mixed' | undefined
    >();
    // @ts-expect-error invalid intent
    const badIntent: ButtonProps = { intent: 'large' };
    void badIntent;
  });
});
