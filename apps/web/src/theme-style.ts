import type { AppTheme } from './themes';

function channels(hex: string): number[] { return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)); }
function luminance(hex: string): number {
  const rgb = channels(hex).map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
export function contrast(first: string, second: string): number {
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function readable(color: string, theme: AppTheme): string {
  const initial = channels(color); const target = channels(theme.text);
  for (let step = 0; step <= 20; step++) {
    const candidate = `#${initial.map((channel, index) => Math.round(channel + (target[index]! - channel) * step / 20).toString(16).padStart(2, '0')).join('')}`;
    if (contrast(candidate, theme.surface) >= 4.5 && contrast(candidate, theme.background) >= 4.5) return candidate;
  }
  return theme.text;
}
export function themeStyle(theme: AppTheme): Record<string, string> {
  return {
    '--background': theme.background, '--surface': theme.surface, '--text': theme.text,
    '--muted': readable(theme.muted, theme), '--primary': theme.primary,
    '--on-primary': contrast(theme.primary, theme.onPrimary) >= 4.5 ? theme.onPrimary : (contrast(theme.primary, '#000000') > contrast(theme.primary, '#FFFFFF') ? '#000000' : '#FFFFFF'),
    '--border': theme.border, '--positive': readable(theme.positive, theme), '--danger': readable(theme.danger, theme),
  };
}
