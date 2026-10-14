import { expect, it } from 'vitest';
import { displayAmount } from './format';

it('formats aggregate amounts above the safe Number limit without losing a minor unit', () => {
  expect(displayAmount(9223372036854775001n, 'USD', 'en-US')).toBe('92,233,720,368,547,750.01 USD');
  expect(displayAmount(-1n, 'KWD', 'en-US')).toBe('−0.001 KWD');
  expect(displayAmount(1234n, 'JPY', 'en-US')).toBe('1,234 JPY');
});
