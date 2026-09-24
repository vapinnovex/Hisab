import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, colors, styles } from '../components/ui';
import { DaySummary } from './types';
import { signedPaise } from './money';

export function monthRange(month: string) {
  const [year, number] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`,
  };
}
export function dateInZone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function hasDifference(day: DaySummary) {
  return day.difference !== null && signedPaise(day.difference) !== BigInt(0);
}
export function HishobCalendar({
  month,
  today,
  days,
  selected,
  onSelect,
  status,
}: {
  month: string;
  today: string;
  days: DaySummary[];
  selected: string | null;
  onSelect: (date: string) => void;
  status: 'ALL' | 'OPEN' | 'CLOSED';
}) {
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const records = new Map(days.map((day) => [day.date, day]));
  return (
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {[
          { label: 'Open', color: '#A46C0B' },
          { label: 'Closed', color: colors.green },
          { label: 'Cash difference', color: colors.red },
        ].map(({ label, color }) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
            <Text style={styles.small}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => (
          <Text
            key={index}
            style={[styles.small, { width: '14.2857%', textAlign: 'center', fontWeight: '700' }]}
          >
            {label}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
          const number = index - offset + 1;
          const date = `${month}-${String(number).padStart(2, '0')}`;
          const record = records.get(date);
          const future = date > today;
          const matches = !record || status === 'ALL' || status === record.status;
          const color = record?.status === 'OPEN' ? '#A46C0B' : colors.green;
          return (
            <View key={index} style={{ width: '14.2857%', padding: 2 }}>
              {number > 0 && number <= count && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Hishob ${date}, ${record ? (record.status === 'OPEN' ? 'Open' : 'Closed') : future ? 'Future date' : 'Not started'}${record && hasDifference(record) ? ', Cash difference' : ''}${date === today ? ', Today' : ''}`}
                  accessibilityState={{ selected: selected === date, disabled: future }}
                  disabled={future}
                  onPress={() => onSelect(date)}
                  style={{
                    minHeight: 54,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderRadius: 12,
                    backgroundColor: record
                      ? record.status === 'OPEN'
                        ? colors.paleGold
                        : colors.mint
                      : '#F5F6F2',
                    borderWidth: 2,
                    borderColor:
                      date === today
                        ? colors.gold
                        : selected === date
                          ? colors.green
                          : 'transparent',
                    opacity: future || !matches ? 0.4 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: record ? color : colors.muted,
                    }}
                  >
                    {number}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                    {record && (
                      <View
                        style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }}
                      />
                    )}
                    {record && hasDifference(record) && (
                      <View
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: colors.red,
                        }}
                      />
                    )}
                  </View>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <Text style={styles.small}>
        Tap a date to see its cash summary. A gold outline marks today.
      </Text>
    </Card>
  );
}
