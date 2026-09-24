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
      {transactionTypes.map((item) => (
        <View style={styles.row} key={item.type}>
          <Text style={styles.small}>
            {item.incoming ? '+' : '−'} {item.label}
          </Text>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>
            {money(day[item.field])}
          </Text>
        </View>
      ))}
    </Card>
  );
}
export function Galla({
  expected,
  actual,
  difference,
}: {
  expected: string;
  actual?: string | null;
  difference?: string | null;
}) {
  return (
    <View style={{ backgroundColor: colors.green, borderRadius: 24, padding: 22, gap: 12 }}>
      <Text style={{ color: '#D5E5D9', fontSize: 13 }}>EXPECTED GALLA</Text>
      <Text style={{ color: colors.white, fontSize: 34, fontWeight: '700' }}>
        {money(expected)}
      </Text>
      {actual !== undefined && (
        <Text style={{ color: '#EDF5EE', fontSize: 16 }}>Actual cash · {money(actual)}</Text>
      )}
      {difference !== undefined && (
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
