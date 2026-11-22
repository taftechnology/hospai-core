import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CopilotAnswer } from './copilot-answer.js';

afterEach(() => cleanup());

function html(text: string): string {
  const { container } = render(<CopilotAnswer text={text} />);
  return container.querySelector('.copilot-answer')!.innerHTML;
}

describe('CopilotAnswer', () => {
  it('bolds **text**', () => {
    expect(html('Rooms **ready:** 4')).toBe('<p>Rooms <strong>ready:</strong> 4</p>');
  });

  it('renders a bullet list from "- " and "* " lines', () => {
    expect(html('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(html('* one\n* **two**')).toBe('<ul><li>one</li><li><strong>two</strong></li></ul>');
  });

  it('renders a numbered list', () => {
    expect(html('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('splits paragraphs on blank lines and turns single newlines into breaks', () => {
    expect(html('line one\nline two\n\nsecond paragraph')).toBe('<p>line one<br>line two</p><p>second paragraph</p>');
  });

  it('leaves an unmatched ** literal', () => {
    expect(html('cost is **high')).toBe('<p>cost is **high</p>');
    expect(html('a ** b')).toBe('<p>a ** b</p>');
  });

  it('keeps markup, links, code and headings-in-text as plain escaped text', () => {
    const out = html('<script>alert(1)</script> [x](y) `code`');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; [x](y) `code`');
    const { container } = render(<CopilotAnswer text="<b>no</b>" />);
    expect(container.querySelector('b')).toBeNull();
  });

  it('turns a leading # marker into a bold paragraph', () => {
    expect(html('## Summary')).toBe('<p><strong>Summary</strong></p>');
  });

  it('handles a mixed block', () => {
    expect(html('**Arrivals:**\n\n- A Patel\n- B Rao\n\nNothing else.')).toBe(
      '<p><strong>Arrivals:</strong></p><ul><li>A Patel</li><li>B Rao</li></ul><p>Nothing else.</p>',
    );
  });

  it('lists a label line directly above its bullets, and a stray line after them', () => {
    expect(html('**Dirty:**\n- a\n- b')).toBe('<p><strong>Dirty:</strong></p><ul><li>a</li><li>b</li></ul>');
    expect(html('- a\nplain')).toBe('<ul><li>a</li></ul><p>plain</p>');
  });
});
