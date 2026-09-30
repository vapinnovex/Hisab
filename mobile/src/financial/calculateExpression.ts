import { t } from './../i18n';
// Decimal rational arithmetic: no eval and no binary floating-point money errors.
type Fraction = [bigint, bigint];
export function calculateExpression(expression: string): string {
  const source = expression
    .replace(/\s/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
  if (!source || source.length > 100)
    throw new Error(t('Enter a calculation (up to 100 characters).'));
  let at = 0;
  function number(): Fraction {
    let sign = BigInt(1);
    if (source[at] === '-' || source[at] === '+') {
      if (source[at] === '-') sign = -sign;
      at++;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(at));
    if (!match) throw new Error(t('Complete the calculation, for example 120 + 30.'));
    at += match[0].length;
    const [whole, decimal = ''] = match[0].split('.');
    let value: Fraction = [
      sign * BigInt((whole || '0') + decimal),
      BigInt(10) ** BigInt(decimal.length),
    ];
    if (source[at] === '%') {
      value = [value[0], value[1] * BigInt(100)];
      at++;
    }
    return value;
  }
  function product(): Fraction {
    let [a, b] = number();
    while (source[at] === '*' || source[at] === '/') {
      const op = source[at++];
      const [c, d] = number();
      if (op === '/') {
        if (!c) throw new Error(t('Cannot divide by zero.'));
        a *= d;
        b *= c;
      } else {
        a *= c;
        b *= d;
      }
    }
    return [a, b];
  }
  let [a, b] = product();
  while (source[at] === '+' || source[at] === '-') {
    const op = source[at++];
    const [c, d] = product();
    a = a * d + (op === '+' ? c : -c) * b;
    b *= d;
  }
  if (at !== source.length) throw new Error(t('Use numbers, +, −, ×, ÷ and %.'));
  const negative = a < BigInt(0) !== b < BigInt(0);
  a = a < BigInt(0) ? -a : a;
  b = b < BigInt(0) ? -b : b;
  const scale = BigInt(100000000);
  const rounded = (a * scale * BigInt(2) + b) / (b * BigInt(2));
  const digits = rounded.toString().padStart(9, '0');
  const result = `${digits.slice(0, -8)}.${digits.slice(-8)}`.replace(/\.?0+$/, '');
  return `${negative && rounded ? '-' : ''}${result || '0'}`;
}
