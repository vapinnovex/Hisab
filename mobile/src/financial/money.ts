// Currency stays decimal strings on the wire and integer paise in arithmetic.
export function groupRupees(whole: string) {
  return whole.length > 3
    ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3)
    : whole;
}

// Format only the display. Preserve the decimal point and trailing zeroes while typing.
export function formatMoneyInput(value: string) {
  const [whole, fraction] = value.split('.');
  return groupRupees(whole) + (fraction === undefined ? '' : '.' + fraction);
}

export function cleanMoneyInput(value: string): string | null {
  const raw = value.replace(/,/g, '').trim();
  if (!/^\d*(\.\d{0,2})?$/.test(raw)) return null;
  const normalized = raw.replace(/^0+(?=\d)/, '').replace(/^\./, '0.');
  if (normalized.split('.')[0].length > 9) return null;
  return normalized;
}

// Keep the caret next to the edited digit when grouping changes in the middle.
export function editMoneyInput(
  previous: string,
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
  nativeCaret?: number,
) {
  const displayed = formatMoneyInput(previous);
  let prefix = 0;
  while (prefix < displayed.length && prefix < text.length && displayed[prefix] === text[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < displayed.length - prefix &&
    suffix < text.length - prefix &&
    displayed[displayed.length - suffix - 1] === text[text.length - suffix - 1]
  )
    suffix++;
  // A paste/replacement may share its last digits with the previous amount.
  // Use the actual selection when possible instead of treating those digits as unchanged.
  const inserted = text.length - (displayed.length - (selectionEnd - selectionStart));
  if (
    inserted >= 0 &&
    text.slice(0, selectionStart) === displayed.slice(0, selectionStart) &&
    text.slice(selectionStart + inserted) === displayed.slice(selectionEnd)
  ) {
    prefix = selectionStart;
    suffix = displayed.length - selectionEnd;
  }
  let caret = nativeCaret ?? text.length - suffix;
  // Deleting a separator also deletes the adjacent digit, just like an unformatted field.
  if (
    displayed.length === text.length + 1 &&
    displayed[prefix] === ',' &&
    text.replace(/,/g, '') === previous
  ) {
    const forward = selectionStart === prefix;
    const index = forward ? prefix : prefix - 1;
    text = displayed.slice(0, index) + displayed.slice(index + (forward ? 2 : 1));
    caret = index;
  }
  const value = cleanMoneyInput(text);
  if (value === null) return null;
  const raw = text.replace(/,/g, '').trim();
  const removed = Math.max(0, raw.length - value.length);
  let digits = Math.max(0, text.slice(0, caret).replace(/,/g, '').trim().length - removed);
  if (raw.startsWith('.')) digits++;
  const formatted = formatMoneyInput(value);
  let position = 0;
  while (position < formatted.length && digits > 0) {
    if (formatted[position] !== ',') digits--;
    position++;
  }
  return { value, position };
}

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
  const grouped = groupRupees(whole);
  const fraction = String(absolute % BigInt(100)).padStart(2, '0');
  return `${amount < BigInt(0) ? '-' : showPlus && amount > BigInt(0) ? '+' : ''}₹${grouped}${fraction === '00' ? '' : '.' + fraction}`;
}
