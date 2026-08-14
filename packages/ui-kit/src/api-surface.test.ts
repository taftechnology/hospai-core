import { describe, expectTypeOf, it } from 'vitest';
import type { ButtonProps, InputProps, LinkButtonProps } from './index.js';

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

  it('Button intent and size are closed unions', () => {
    expectTypeOf<ButtonProps['intent']>().toEqualTypeOf<
      'default' | 'primary' | 'destructive' | 'ghost' | undefined
    >();
    expectTypeOf<ButtonProps['size']>().toEqualTypeOf<'sm' | 'md' | undefined>();
    // @ts-expect-error invalid intent
    const badIntent: ButtonProps = { intent: 'large' };
    void badIntent;
  });
});
