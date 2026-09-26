import React, { useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { FilterChips } from '../components/ListControls';
import { Card, colors, Field, styles } from '../components/ui';
import { editMoneyInput, formatMoneyInput, money } from './money';
import { Totals, TransactionType, transactionTypes } from './types';

export function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const caret = useRef({ start: 0, end: 0 });
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  return (
    <Field
      label={label}
      value={formatMoneyInput(value)}
      selection={selection}
      onSelectionChange={(event) => {
        caret.current = event.nativeEvent.selection;
      }}
      onChange={(event) => {
        // Web exposes the caret after paste/replacement directly on the input event.
        const nativeCaret =
          Platform.OS === 'web'
            ? (event.target as unknown as { selectionStart: number }).selectionStart
            : undefined;
        const next = editMoneyInput(
          value,
          event.nativeEvent.text,
          caret.current.start,
          caret.current.end,
          nativeCaret,
        );
        if (next) {
          onChange(next.value);
          setSelection({ start: next.position, end: next.position });
        } else {
          setSelection({ ...caret.current });
        }
      }}
      keyboardType="decimal-pad"
      autoCorrect={false}
      placeholder="0.00"
      style={[styles.input, { fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }]}
    />
  );
}
export function Breakdown({ day }: { day: Totals }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>Opening cash</Text>
        <Text style={styles.heading}>{money(day.opening_cash)}</Text>
      </View>
      {[
        ['+ Cash sales', day.cash_sales],
        ['+ Other cash in', day.other_cash_in],
        ['− Cash expenses', day.cash_expenses ?? day.expenses_total],
        ['− Cash supplier payments', day.cash_supplier_payments ?? day.supplier_payments],
        ['− Bank deposit', day.bank_deposit],
        ['− Take-home / withdrawal', day.withdrawals],
      ].map(([label, value]) => (
        <View style={styles.row} key={label}>
          <Text style={styles.small}>{label}</Text>
          <Text style={styles.heading}>{money(value)}</Text>
        </View>
      ))}
      <Text style={styles.label}>Outside the galla</Text>
      <Text style={styles.small}>
        UPI / card sales {money(day.digital_sales === undefined ? '0' : day.digital_sales)} · Unpaid
        credit sales {money(day.credit_sales === undefined ? '0' : day.credit_sales)}
      </Text>
      <Text style={styles.small}>
        Digital expenses {money(day.digital_expenses ?? '0')} · Digital supplier payments{' '}
        {money(day.digital_supplier_payments ?? '0')}
      </Text>
      <Text style={styles.small}>
        Online payments and credit sales do not add cash to the galla. Other cash in (such as old
        dues or owner funds) is not today’s sales.
      </Text>
      {day.total_sales != null && (
        <Text style={styles.heading}>
          Sales {money(day.total_sales)}
          {day.mode === 'COUNTED' ? ' · includes estimated cash sales' : ''}
        </Text>
      )}
      {day.mode === 'COUNTED' && (
        <Text style={styles.small}>
          Cash sales are estimated from counted cash and recorded movements. A cash difference
          cannot be independently checked.
        </Text>
      )}
      {day.mode === 'BILLING' && day.total_sales != null && day.cash_sales === null && (
        <Text style={styles.small}>
          Payment breakdown not provided. Total sales are recorded; cash sales and the cash
          difference cannot be calculated from the total alone.
        </Text>
      )}
      {!!day.closing_bank_deposit && day.closing_bank_deposit !== '0.00' && (
        <Text style={styles.small}>
          Bank total includes {money(day.closing_bank_deposit)} removed at closing.
        </Text>
      )}
      {!!day.closing_withdrawal && day.closing_withdrawal !== '0.00' && (
        <Text style={styles.small}>
          Withdrawal total includes {money(day.closing_withdrawal)} taken home at closing.
        </Text>
      )}
    </Card>
  );
}
export function Galla({
  expected,
  actual,
  difference,
  current = false,
}: {
  expected: string | null;
  actual?: string | null;
  difference?: string | null;
  current?: boolean;
}) {
  return (
    <View style={{ backgroundColor: colors.green, borderRadius: 24, padding: 22, gap: 12 }}>
      <Text style={{ color: '#D5E5D9', fontSize: 13 }}>
        {current
          ? 'CURRENT GALLA'
          : expected === null
            ? actual != null
              ? 'CASH KEPT IN GALLA'
              : 'CLOSING CHECK'
            : 'EXPECTED GALLA'}
      </Text>
      <Text style={{ color: colors.white, fontSize: 34, fontWeight: '700' }}>
        {current && expected === null
          ? 'Available at closing'
          : expected === null
            ? actual != null
              ? money(actual)
              : 'Count at closing'
            : money(expected)}
      </Text>
      {current && (
        <Text style={{ color: '#EDF5EE', fontSize: 14 }}>
          {expected === null
            ? 'Sales are not recorded yet, so the current cash balance is unknown.'
            : 'Based on recorded cash movements. Verify by counting at closing.'}
        </Text>
      )}
      {!current && actual !== undefined && expected !== null && (
        <Text style={{ color: '#EDF5EE', fontSize: 16 }}>Cash kept in galla · {money(actual)}</Text>
      )}
      {!current && difference !== undefined && expected !== null && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#3E7963', paddingTop: 12, gap: 4 }}>
          <Text style={{ color: '#D5E5D9', fontSize: 13 }}>Difference</Text>
          <Text
            accessibilityLabel={`Difference ${money(difference, true)}`}
            style={{ color: '#F4CD72', fontSize: 26, fontWeight: '700' }}
          >
            {money(difference, true)}
          </Text>
        </View>
      )}
    </View>
  );
}
export function timestamp(value: string, zone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(value));
}

export function TransactionTypeFilter({
  value,
  onChange,
}: {
  value: TransactionType | 'ALL';
  onChange: (value: TransactionType | 'ALL') => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: 2 }}
    >
      <FilterChips
        label="Filter transaction type"
        value={value}
        onChange={onChange}
        options={[
          { value: 'ALL', label: 'All types' },
          ...transactionTypes.map((item) => ({ value: item.type, label: item.label })),
        ]}
      />
    </ScrollView>
  );
}
