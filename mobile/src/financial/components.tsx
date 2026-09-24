import React from 'react';
import { Text, View } from 'react-native';
import { Card, colors, Field, styles } from '../components/ui';
import { money } from './money';
import { Totals, transactionTypes } from './types';

export function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType="decimal-pad"
      placeholder="0.00"
      maxLength={12}
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
