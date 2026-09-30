import { localeTag, original, t, useLocale } from './../i18n';
import React, { useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { FilterChips } from '../components/ListControls';
import { Card, colors, Field, styles } from '../components/ui';
import { editMoneyInput, formatMoneyInput, money, parseMoney } from './money';
import { FinancialHelp, financialHelp } from './help';
import { Totals, TransactionType, transactionTypes } from './types';

export function MoneyField({
  label,
  value,
  onChange,
  required = true,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
}) {
  useLocale();
  const caret = useRef({ start: 0, end: 0 });
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  return (
    <View>
      <Field
        label={label}
        required={required}
        error={
          error ||
          ((required || value) &&
          (parseMoney(value) === null ||
            (original(label) === 'Amount (₹)' && parseMoney(value) === BigInt(0)))
            ? t('Enter a valid {0}{1}.', [
                label.toLowerCase(),
                original(label) === 'Amount (₹)' ? t(' greater than zero') : '',
              ])
            : '')
        }
        selectTextOnFocus={/^0(?:\.0*)?$/.test(value)}
        help={financialHelp[original(label)]}
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
    </View>
  );
}
export function Breakdown({ day }: { day: Totals }) {
  useLocale();
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>{t('Opening cash')}</Text>
        <Text style={styles.heading}>{money(day.opening_cash)}</Text>
      </View>
      {[
        [t('+ Cash sales'), day.cash_sales],
        [t('+ Other cash in'), day.other_cash_in],
        [t('− Cash expenses'), day.cash_expenses ?? day.expenses_total],
        [t('− Cash supplier payments'), day.cash_supplier_payments ?? day.supplier_payments],
        [t('− Bank deposit'), day.bank_deposit],
        [t('− Take-home / withdrawal'), day.withdrawals],
      ].map(([label, value]) => (
        <View style={styles.row} key={label}>
          <Text style={styles.small}>{label}</Text>
          <Text style={styles.heading}>{money(value)}</Text>
        </View>
      ))}
      <Text style={styles.label}>{t('Outside the galla')}</Text>
      <Text style={styles.small}>
        {' '}
        {t('UPI / card sales')} {money(day.digital_sales === undefined ? '0' : day.digital_sales)}{' '}
        {t('· Unpaid credit sales')}{' '}
        {money(day.credit_sales === undefined ? '0' : day.credit_sales)}
      </Text>
      <Text style={styles.small}>
        {' '}
        {t('Digital expenses')} {money(day.digital_expenses ?? '0')}{' '}
        {t('· Digital supplier payments')} {money(day.digital_supplier_payments ?? '0')}
      </Text>
      <Text style={styles.small}>
        {' '}
        {t(
          'Online payments and credit sales do not add cash to the galla. Other cash in (such as old dues or owner funds) is not today’s sales.',
        )}{' '}
      </Text>
      {day.total_sales != null && (
        <Text style={styles.heading}>
          {' '}
          {t('Sales')} {money(day.total_sales)}
          {day.mode === 'COUNTED' ? t(' · includes estimated cash sales') : ''}
        </Text>
      )}
      {day.mode === 'COUNTED' && (
        <Text style={styles.small}>
          {' '}
          {t(
            'Cash sales are estimated from counted cash and recorded movements. A cash difference cannot be independently checked.',
          )}{' '}
        </Text>
      )}
      {day.mode === 'BILLING' && day.total_sales != null && day.cash_sales === null && (
        <Text style={styles.small}>
          {' '}
          {t(
            'Payment breakdown not provided. Total sales are recorded; cash sales and the cash difference cannot be calculated from the total alone.',
          )}{' '}
        </Text>
      )}
      {!!day.closing_bank_deposit && day.closing_bank_deposit !== '0.00' && (
        <Text style={styles.small}>
          {' '}
          {t('Bank total includes')} {money(day.closing_bank_deposit)}{' '}
          {t('removed at closing.')}{' '}
        </Text>
      )}
      {!!day.closing_withdrawal && day.closing_withdrawal !== '0.00' && (
        <Text style={styles.small}>
          {' '}
          {t('Withdrawal total includes')} {money(day.closing_withdrawal)}{' '}
          {t('taken home at closing.')}{' '}
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
  useLocale();
  return (
    <View>
      {!current && difference !== undefined && expected !== null && (
        <FinancialHelp topic={t('Difference')} />
      )}
      <View style={{ backgroundColor: colors.green, borderRadius: 24, padding: 22, gap: 12 }}>
        <Text style={{ color: '#D5E5D9', fontSize: 13 }}>
          {current
            ? t('CURRENT GALLA')
            : expected === null
              ? actual != null
                ? t('CASH KEPT IN GALLA')
                : t('CLOSING CHECK')
              : t('EXPECTED GALLA')}
        </Text>
        <Text style={{ color: colors.white, fontSize: 34, fontWeight: '700' }}>
          {current && expected === null
            ? t('Available at closing')
            : expected === null
              ? actual != null
                ? money(actual)
                : t('Count at closing')
              : money(expected)}
        </Text>
        {current && (
          <Text style={{ color: '#EDF5EE', fontSize: 14 }}>
            {expected === null
              ? t('Sales are not recorded yet, so the current cash balance is unknown.')
              : t('Based on recorded cash movements. Verify by counting at closing.')}
          </Text>
        )}
        {!current && actual !== undefined && expected !== null && (
          <Text style={{ color: '#EDF5EE', fontSize: 16 }}>
            {' '}
            {t('Cash kept in galla ·')} {money(actual)}
          </Text>
        )}
        {!current && difference !== undefined && expected !== null && (
          <View style={{ borderTopWidth: 1, borderTopColor: '#3E7963', paddingTop: 12, gap: 4 }}>
            <Text style={{ color: '#D5E5D9', fontSize: 13 }}>{t('Difference')}</Text>
            <Text
              accessibilityLabel={t('Difference {0}', [money(difference, true)])}
              style={{ color: '#F4CD72', fontSize: 26, fontWeight: '700' }}
            >
              {money(difference, true)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
export function timestamp(value: string, zone: string) {
  return new Intl.DateTimeFormat(localeTag(), {
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
  useLocale();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: 2 }}
    >
      <FilterChips
        label={t('Filter transaction type')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'ALL', label: t('All types') },
          ...transactionTypes.map((item) => ({ value: item.type, label: item.label })),
        ]}
      />
    </ScrollView>
  );
}
