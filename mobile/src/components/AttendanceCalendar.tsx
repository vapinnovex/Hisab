import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Attendance, History, Status } from '../types';
import { Card, colors, statusLabel, styles } from './ui';

const palette: Record<Status, { background: string; ink: string; symbol: string }> = {
  PRESENT: { background: '#DCF0E2', ink: '#185D39', symbol: 'P' },
  HALF_DAY: { background: '#FFF0C8', ink: '#77520C', symbol: '½' },
  ABSENT: { background: '#FCE2DE', ink: '#9A2929', symbol: 'A' },
  LEAVE: { background: '#E6E7FF', ink: '#4C4595', symbol: 'L' },
  NOT_MARKED: { background: '#EDF0ED', ink: '#68756C', symbol: '–' },
};
export function AttendanceCalendar({
  history,
  selected,
  onSelect,
}: {
  history: History;
  selected: string | null;
  onSelect: (day: Attendance) => void;
}) {
  const [year, month] = history.month.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const offset = (start.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const records = new Map(history.days.map((day) => [day.date, day]));
  const cells = Array.from(
    { length: Math.ceil((offset + count) / 7) * 7 },
    (_, index) => index - offset + 1,
  );
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(palette) as Status[]).map((status) => (
          <View
            key={status}
            style={{
              padding: 10,
              borderRadius: 12,
              backgroundColor: palette[status].background,
              minWidth: 94,
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700', color: palette[status].ink }}>
              {history.summary[status]}
            </Text>
            <Text style={[styles.small, { color: palette[status].ink }]}>
              {statusLabel(status)}
            </Text>
          </View>
        ))}
      </View>
      <Card>
        <Text style={styles.small}>
          Tap a day for its details. Greyed-out dates are outside your attendance period.
        </Text>
        <View style={{ flexDirection: 'row' }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
            <Text
              key={i}
              style={[styles.small, { width: '14.2857%', textAlign: 'center', fontWeight: '700' }]}
            >
              {day}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, index) => {
            const date = `${history.month}-${String(day).padStart(2, '0')}`;
            const record = records.get(date);
            const shade = record ? palette[record.status] : null;
            return (
              <View key={index} style={{ width: '14.2857%', padding: 2 }}>
                {day > 0 && day <= count && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${date}, ${record ? statusLabel(record.status) : 'Unavailable'}`}
                    accessibilityState={{ selected: selected === date, disabled: !record }}
                    disabled={!record}
                    onPress={() => record && onSelect(record)}
                    style={{
                      minHeight: 52,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: shade?.background || '#F8F9F6',
                      borderWidth: 2,
                      borderColor: selected === date ? colors.green : 'transparent',
                    }}
                  >
                    <Text
                      style={{ fontSize: 14, fontWeight: '600', color: shade?.ink || '#BCC4BD' }}
                    >
                      {day}
                    </Text>
                    <Text style={{ fontSize: 11, color: shade?.ink || '#BCC4BD' }}>
                      {shade?.symbol || '·'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      </Card>
    </>
  );
}
