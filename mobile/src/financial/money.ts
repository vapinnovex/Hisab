// Currency stays decimal strings on the wire and integer paise in arithmetic.
export function parseMoney(value: string): bigint | null {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value.trim())) return null;
  return signedPaise(value.trim());
}
export function signedPaise(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}
export function decimal(value: bigint) {
  const sign = value < BigInt(0) ? '-' : '';
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, '0')}`;
}
export function money(value: string | null, showPlus = false) {
  if (value === null) return '—';
  const amount = signedPaise(value);
  const absolute = amount < BigInt(0) ? -amount : amount;
  const whole = String(absolute / BigInt(100));
  const grouped =
    whole.length > 3
      ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3)
      : whole;
  const fraction = String(absolute % BigInt(100)).padStart(2, '0');
  return `${amount < BigInt(0) ? '-' : showPlus && amount > BigInt(0) ? '+' : ''}₹${grouped}${fraction === '00' ? '' : '.' + fraction}`;
}
