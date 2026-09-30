import { t, localized } from '../i18n';
import { transactionTypes } from './types';

const actions: Record<string, string> = localized(() => ({
  START_DAY: t('Day created'),
  OPEN_DAY: t('Day created'),
  ADD_TRANSACTION: t('Transaction added'),
  EDIT_TRANSACTION: t('Transaction edited'),
  DELETE_TRANSACTION: t('Transaction deleted'),
  CHANGE_OPENING: t('Opening updated'),
  REOPEN_DAY: t('Day reopened'),
  CLOSE_DAY: t('Day closed'),
  COLLECT_DUE: t('Payment collected'),
}));
export const auditAction = (action: string) => actions[action] || action;
const fields: Record<string, string> = localized(() => ({
  type: t('Type'),
  amount: t('Amount'),
  description: t('Description'),
  category: t('Category'),
  deleted: t('Deleted'),
  opening_cash: t('Opening cash'),
  actual_closing_cash: t('Actual closing cash'),
  expected_closing_cash: t('Expected closing cash'),
  difference: t('Difference'),
  counted_cash: t('Counted cash'),
  closing_bank_deposit: t('Bank deposit'),
  closing_withdrawal: t('Withdrawal'),
  payment_method: t('Payment method'),
  reported_sales: t('Reported sales'),
  billing_input: t('Billing input'),
  status: t('Status'),
  cash: t('Cash'),
  digital: t('UPI / card'),
  credit: t('Credit sales (unpaid)'),
  total: t('Total'),
  split: t('Split totals'),
  total_sales: t('Total sales'),
  cash_sales: t('Cash sales'),
  digital_sales: t('UPI / card sales'),
  credit_sales: t('Credit sales (unpaid)'),
}));
function displayValue(key: string, value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? t('True') : t('False');
  if (typeof value === 'object') return auditValues(value as Record<string, unknown>);
  if (key === 'type')
    return transactionTypes.find((item) => item.type === value)?.label || String(value);
  if (key === 'status')
    return value === 'OPEN' ? t('Open') : value === 'CLOSED' ? t('Closed') : String(value);
  if (key === 'payment_method')
    return value === 'CASH' ? t('Cash') : value === 'DIGITAL' ? t('UPI / card') : String(value);
  if (key === 'billing_input')
    return value === 'SPLIT' ? t('Split totals') : value === 'TOTAL' ? t('Total') : String(value);
  return String(value); // Descriptions, categories and other user data are never translated.
}
export function auditValues(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([key]) => key in fields)
    .map(([key, entry]) => `${fields[key]}: ${displayValue(key, entry)}`)
    .join(' · ');
}
