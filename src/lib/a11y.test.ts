import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * Structural accessibility checks over the app's own JSX.
 *
 * These are not a substitute for using the app with a screen reader, but they catch
 * the regressions that are easy to introduce and invisible in review: an icon-only
 * button with no name, or a decorative icon being read aloud as noise.
 *
 * The trap worth guarding is the second-order one. Marking an icon `aria-hidden` is
 * right — until that icon is the only content of a button, at which point the button
 * has no accessible name at all and the change made things worse.
 */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const APP_FILES = tsxFiles('src/app').map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}));

/** A <Button> whose entire body is one self-closing icon element. */
const ICON_ONLY_BUTTON =
  /<Button\b((?:[^>]|\n)*?)>\s*(?:\{[^}]*\?\s*)?<[A-Z]\w+\s[^>]*\/>\s*(?::[^}]*\}\s*)?<\/Button>/gm;

describe('icon-only buttons', () => {
  it('all carry an accessible name', () => {
    const unnamed: string[] = [];

    for (const { file, source } of APP_FILES) {
      for (const match of source.matchAll(ICON_ONLY_BUTTON)) {
        const attrs = match[1];
        if (!/aria-label|aria-labelledby/.test(attrs)) {
          unnamed.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
        }
      }
    }

    expect(unnamed, `buttons with no accessible name:\n${unnamed.join('\n')}`).toEqual([]);
  });
});

describe('decorative icons', () => {
  it('are hidden from the accessibility tree', () => {
    // An unhidden icon inside a labelled control is read out on top of the label.
    const exposed: string[] = [];
    const iconInButton = /<Button\b(?:[^>]|\n)*?aria-label(?:[^>]|\n)*?>\s*<([A-Z]\w+)\s+className="[^"]*"\s*\/>/gm;

    for (const { file, source } of APP_FILES) {
      for (const match of source.matchAll(iconInButton)) {
        exposed.push(`${file}: <${match[1]}>`);
      }
    }

    expect(exposed, `icons not aria-hidden:\n${exposed.join('\n')}`).toEqual([]);
  });
});

describe('live regions', () => {
  it('announces the streaming chat answer', () => {
    // The reply arrives token by token; without a live region a screen-reader user
    // hears nothing and cannot tell when it has finished.
    const chat = readFileSync('src/app/(authenticated)/chat/page.tsx', 'utf8');
    expect(chat).toMatch(/aria-live="polite"/);
    expect(chat).toMatch(/role="log"/);
  });

  it('announces an upload failure', () => {
    const upload = readFileSync('src/app/(authenticated)/documents/upload/page.tsx', 'utf8');
    expect(upload).toMatch(/role="alert"/);
  });
});

describe('images', () => {
  it('describe what they show rather than naming a file', () => {
    for (const { file, source } of APP_FILES) {
      for (const match of source.matchAll(/alt=\{?["`]([^"`]*)["`]/g)) {
        expect(match[1].length, `empty alt in ${file}`).toBeGreaterThan(0);
        expect(match[1], `filename as alt text in ${file}`).not.toMatch(/\.(png|jpe?g|pdf)$/i);
      }
    }
  });
});
