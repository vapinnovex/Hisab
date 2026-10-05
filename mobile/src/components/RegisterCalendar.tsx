import { weekdays, t, useLocale } from './../i18n';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, colors, styles, ErrorText, Button, statusLabel } from './ui';
import { useAuth } from '../auth';
import { useResource } from '../hooks';
import { Status } from '../types';

const shades = {
  PRESENT: { background: '#DCF0E2', ink: '#185D39', symbol: '✓' },
  ABSENT: { background: '#FCE2DE', ink: '#9A2929', symbol: '×' },
  NOT_MARKED: { background: '#FFF0C8', ink: '#77520C', symbol: '?' },
  HALF_DAY: { background: '#FFF0C8', ink: '#77520C', symbol: '½' },
  LEAVE: { background: '#E6E7FF', ink: '#4C4595', symbol: '○' },
};

export function RegisterCalendar({
  month,
  today,
  selected,
  onSelect,
}: {
  month: string;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  useLocale();
  const { selected: membership } = useAuth();
  const summary = useResource<{
    days: { date: string; counts: Record<Status, number>; total: number }[];
  }>(`/shops/${membership!.shop_id}/attendance/calendar?month=${month}`, true);
  const days = new Map(
    (summary.error ? [] : summary.data?.days || []).map((day) => [day.date, day]),
  );
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return (
    <Card>
      <Text style={styles.small}>
        {' '}
        {t('Choose a date to see the whole team’s register. The gold outline marks today.')}{' '}
      </Text>
      <Text style={styles.small}>
        {t(
          'Green means everyone is present. Other numbers show how many people need attention. Tap a date for details.',
        )}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(shades) as Status[]).map((status) => (
          <Text
            key={status}
            style={{
              color: shades[status].ink,
              backgroundColor: shades[status].background,
              padding: 5,
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {shades[status].symbol} {status === 'PRESENT' ? t('All present') : statusLabel(status)}
          </Text>
        ))}
      </View>
      {summary.loading && <Text style={styles.small}>{t('Loading attendance summary…')}</Text>}
      <ErrorText message={summary.error} />
      {!!summary.error && (
        <Button title={t('Retry attendance')} secondary onPress={() => void summary.refresh()} />
      )}
      <View style={{ flexDirection: 'row' }}>
        {weekdays().map((label, index) => (
          <Text key={index} style={[styles.small, { width: '14.2857%', textAlign: 'center' }]}>
            {label}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
          const number = index - offset + 1;
          const date = `${month}-${String(number).padStart(2, '0')}`;
          const future = date > today;
          const day = days.get(date);
          const status = day?.total
            ? (['ABSENT', 'NOT_MARKED', 'HALF_DAY', 'LEAVE', 'PRESENT'] as Status[]).find(
                (key) => day.counts[key] > 0,
              )
            : undefined;
          const shade = status ? shades[status] : undefined;
          const description = day?.total
            ? (Object.keys(shades) as Status[])
                .map((key) => `${statusLabel(key)}: ${day.counts[key]}`)
                .join(', ')
            : day
              ? t('No employees')
              : t('Unavailable');
          return (
            <View key={index} style={{ width: '14.2857%', padding: 2 }}>
              {number > 0 && number <= count && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Team attendance {0}{1}', [
                    date,
                    `${date === today ? t(', Today') : ''}, ${description}`,
                  ])}
                  accessibilityState={{ selected: selected === date, disabled: future }}
                  disabled={future}
                  onPress={() => onSelect(date)}
                  style={{
                    minHeight: 64,
                    justifyContent: 'center',
                    alignItems: 'center',
                    borderRadius: 10,
                    backgroundColor: shade?.background || '#F3F4F1',
                    borderWidth: 2,
                    borderColor:
                      date === today ? colors.gold : selected === date ? colors.ink : 'transparent',
                    opacity: future ? 0.35 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '600',
                      color: shade?.ink || colors.muted,
                    }}
                  >
                    {number}
                  </Text>
                  <Text
                    style={{ fontSize: 12, fontWeight: '700', color: shade?.ink || colors.muted }}
                  >
                    {future
                      ? ''
                      : status === 'PRESENT'
                        ? '✓'
                        : status && day
                          ? `${shade!.symbol} ${day.counts[status]}`
                          : '–'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}
