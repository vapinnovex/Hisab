import { t, localized } from '../i18n';
import { Permissions } from '../types';
export type TransactionType =
  | 'DIGITAL_SALE'
  | 'CREDIT_SALE'
  | 'DUE_COLLECTION'
  | 'CASH_SALE'
  | 'OTHER_CASH_IN'
  | 'EXPENSE'
  | 'SUPPLIER_PAYMENT'
  | 'BANK_DEPOSIT'
  | 'WITHDRAWAL';
export type Actor = { user_id: string; name: string; role: string };
export type HishobMode = 'ENTRIES' | 'COUNTED' | 'BILLING';
export const modeLabels: Record<HishobMode, string> = localized(() => ({
  ENTRIES: t('Enter sales'),
  COUNTED: t('Count cash'),
  BILLING: t('Use billing totals'),
}));
export type Entry = {
  customer_name?: string;
  due_date?: string;
  note?: string;
  payment_method?: 'CASH' | 'DIGITAL';
  id: string;
  type: TransactionType;
  amount: string;
  category: string;
  description: string;
  created_by: Actor;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  updated_by?: Actor;
  deleted_by?: Actor;
};
export type Totals = {
  billing_input?: 'SPLIT' | 'TOTAL';
  unallocated_sales?: string;
  mode?: HishobMode;
  total_sales?: string | null;
  digital_sales?: string | null;
  credit_sales?: string | null;
  cash_expenses?: string;
  digital_expenses?: string;
  cash_supplier_payments?: string;
  digital_supplier_payments?: string;
  counted_cash?: string | null;
  closing_bank_deposit?: string;
  closing_withdrawal?: string;
  opening_cash: string;
  cash_sales: string | null;
  other_cash_in: string;
  expenses_total: string;
  supplier_payments: string;
  bank_deposit: string;
  withdrawals: string;
  expected_closing_cash: string | null;
  actual_closing_cash: string | null;
  difference: string | null;
};
export type Audit = {
  id: string;
  action: string;
  actor: Actor;
  at: string;
  previous: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  reason: string;
};
export type Day = Totals & {
  credit_tracking?: boolean;
  legacy_credit_sales?: string;
  id: string;
  shop_id: string;
  date: string;
  timezone: string;
  revision: number;
  status: 'OPEN' | 'CLOSED';
  notes: string;
  difference_note: string;
  closed_by: Actor | null;
  closed_at: string | null;
  opening_source: { date: string; actual_closing_cash: string } | null;
  transactions: Entry[];
  audit: Audit[];
  closing_snapshots: (Totals & {
    snapshot_id: string;
    revision: number;
    closed_by: Actor;
    closed_at: string;
    notes: string;
    difference_note: string;
    transactions: Entry[];
  })[];
};
export type DaySummary = Omit<Day, 'transactions' | 'audit' | 'closing_snapshots'>;
export type TodayHishob = {
  date: string;
  timezone: string;
  day: Day | null;
  suggested_opening_cash: string | null;
  previous_closed_date: string | null;
  permissions: Permissions;
};
export const transactionTypes: {
  type: TransactionType;
  label: string;
  field: keyof Totals;
  incoming: boolean;
}[] = localized(() => [
  { type: 'DUE_COLLECTION', label: t('Customer payment'), field: 'other_cash_in', incoming: true },
  { type: 'CASH_SALE', label: t('Cash sales'), field: 'cash_sales', incoming: true },
  { type: 'DIGITAL_SALE', label: t('UPI / card sales'), field: 'digital_sales', incoming: true },
  { type: 'CREDIT_SALE', label: t('Credit sales (unpaid)'), field: 'credit_sales', incoming: true },
  { type: 'OTHER_CASH_IN', label: t('Other cash in'), field: 'other_cash_in', incoming: true },
  { type: 'EXPENSE', label: t('Expense'), field: 'expenses_total', incoming: false },
  {
    type: 'SUPPLIER_PAYMENT',
    label: t('Supplier payment'),
    field: 'supplier_payments',
    incoming: false,
  },
  { type: 'BANK_DEPOSIT', label: t('Bank deposit'), field: 'bank_deposit', incoming: false },
  { type: 'WITHDRAWAL', label: t('Withdrawal'), field: 'withdrawals', incoming: false },
]);

export type MonthlySummary = {
  unallocated_sales: string;
  unallocated_days: number;
  month: string;
  total_sales: string;
  recorded_sales: string;
  estimated_sales: string;
  cash_sales: string;
  digital_sales: string;
  credit_sales: string;
  expenses_total: string;
  supplier_payments: string;
  bank_deposit: string;
  withdrawals: string;
  closed_days: number;
  open_days: number;
  not_started_days: number;
  estimated_days: number;
  difference_days: number;
};
