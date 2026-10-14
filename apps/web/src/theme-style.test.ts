import { expect, it } from 'vitest';
import { themes } from './themes';
import { contrast, themeStyle } from './theme-style';

it.each(themes)('keeps normal text readable for the $id theme', (theme) => {
  const tokens = themeStyle(theme);
  for (const token of ['--text', '--muted', '--positive', '--danger']) {
    expect(contrast(tokens[token]!, theme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens[token]!, theme.background)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(tokens['--primary']!, tokens['--on-primary']!)).toBeGreaterThanOrEqual(4.5);
});
