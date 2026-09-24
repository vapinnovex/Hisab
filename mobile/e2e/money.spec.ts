import { expect, test } from '@playwright/test';
import {
  cleanMoneyInput,
  editMoneyInput,
  formatMoneyInput,
  parseMoney,
} from '../src/financial/money';

test('currency entry keeps exact paise and Indian grouping, including the amount limit', () => {
  for (const [input, shown, paise] of [
    ['0', '0', 0n],
    ['0.10', '0.10', 10n],
    ['1234.50', '1,234.50', 123450n],
    ['125000', '1,25,000', 12500000n],
    ['999999999.99', '99,99,99,999.99', 99999999999n],
  ] as const) {
    expect(formatMoneyInput(input)).toBe(shown);
    expect(parseMoney(cleanMoneyInput(shown)!)).toBe(paise);
  }
  expect(cleanMoneyInput('00012.50')).toBe('12.50');
  expect(cleanMoneyInput('.5')).toBe('0.5');
  expect(formatMoneyInput('1234.')).toBe('1,234.');
  for (const invalid of ['1000000000', '1.234', '-1', '1e3', '12..5', 'abc']) {
    expect(cleanMoneyInput(invalid)).toBeNull();
  }
});

test('editing around comma separators keeps the caret beside the edited digit', () => {
  expect(editMoneyInput('123456', '1,23,9456', 5)).toEqual({ value: '1239456', position: 5 });
  expect(editMoneyInput('1239456', '12,398,456', 5)).toEqual({ value: '12398456', position: 7 });
  expect(editMoneyInput('1234', '1234', 2)).toEqual({ value: '234', position: 0 });
  expect(editMoneyInput('1234', '1234', 1)).toEqual({ value: '134', position: 1 });
  expect(editMoneyInput('12345.6', '123456', 0, 8)).toEqual({ value: '123456', position: 8 });
  expect(editMoneyInput('111', '1111', 1)).toEqual({ value: '1111', position: 3 });
  expect(editMoneyInput('', '.', 0)).toEqual({ value: '0.', position: 2 });
  expect(editMoneyInput('1234', '', 0)).toEqual({ value: '', position: 0 });
});
