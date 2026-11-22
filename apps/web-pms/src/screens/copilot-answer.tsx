import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe renderer for the copilot's answers (R4.16). It understands a fixed subset and
 * returns React elements only, so everything else is escaped text: paragraphs, `- ` / `* ` bullet
 * lists, `1. ` numbered lists, `**bold**`, and a leading `#` heading marker shown as a bold line.
 * No HTML is parsed and no link or code syntax is interpreted.
 */

const BULLET = /^[-*] +(.*)$/;
const NUMBERED = /^\d+\. +(.*)$/;
const HEADING = /^#{1,6} +(.*)$/;

/** `**x**` → `<strong>`. An unmatched `**` stays literal. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const open = rest.indexOf('**');
    const close = open === -1 ? -1 : rest.indexOf('**', open + 2);
    if (open === -1 || close === -1 || close === open + 2) {
      out.push(rest);
      return out;
    }
    if (open > 0) out.push(rest.slice(0, open));
    out.push(<strong key={key++}>{rest.slice(open + 2, close)}</strong>);
    rest = rest.slice(close + 2);
  }
}

/** One fragment per line, so keys from `inline` never collide across lines. */
function withBreaks(lines: string[]): ReactNode[] {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {inline(line)}
    </Fragment>
  ));
}

type Kind = 'ul' | 'ol' | 'p';

function kindOf(line: string): Kind {
  if (BULLET.test(line)) return 'ul';
  if (NUMBERED.test(line)) return 'ol';
  return 'p';
}

function run(kind: Kind, lines: string[], key: string): ReactNode {
  if (kind === 'ul' || kind === 'ol') {
    const marker = kind === 'ul' ? BULLET : NUMBERED;
    const items = lines.map((l, i) => <li key={i}>{inline(marker.exec(l)![1]!)}</li>);
    return kind === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
  }
  const heading = HEADING.exec(lines[0]!);
  if (heading) {
    return (
      <p key={key}>
        <strong>{heading[1]}</strong>
        {lines.length > 1 ? <br /> : null}
        {withBreaks(lines.slice(1))}
      </p>
    );
  }
  return <p key={key}>{withBreaks(lines)}</p>;
}

/** A block is split into runs of the same kind, so a label line directly above a list still lists. */
function block(lines: string[], key: number): ReactNode[] {
  const out: ReactNode[] = [];
  let kind = kindOf(lines[0]!);
  let current: string[] = [];
  for (const line of lines) {
    const k = kindOf(line);
    if (k !== kind) {
      out.push(run(kind, current, `${key}.${out.length}`));
      current = [];
      kind = k;
    }
    current.push(line);
  }
  out.push(run(kind, current, `${key}.${out.length}`));
  return out;
}

export function CopilotAnswer({ text }: { text: string }) {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return <div className="copilot-answer">{blocks.flatMap((lines, i) => block(lines, i))}</div>;
}
