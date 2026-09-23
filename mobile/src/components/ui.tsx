import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Attendance, Status } from '../types';

export const colors = {
  ink: '#163B32',
  muted: '#6B7E77',
  green: '#176C50',
  mint: '#E0F0E7',
  background: '#F5F7F2',
  line: '#DCE4DB',
  red: '#A53535',
  white: '#FFFFFF',
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 22,
    gap: 18,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingBottom: 42,
  },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink, letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 23, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.white,
    padding: 15,
    color: colors.ink,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  heading: { fontSize: 18, fontWeight: '600', color: colors.ink },
  small: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  eyebrow: { color: colors.green, fontWeight: '700', fontSize: 12, letterSpacing: 2 },
});
export function Page({
  children,
  refresh,
}: {
  children: React.ReactNode;
  refresh?: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = React.useState(false);
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.page}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            refresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void refresh().finally(() => setRefreshing(false));
                }}
                tintColor={colors.green}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary,
  disabled,
  busy,
  danger,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: secondary ? colors.mint : danger ? colors.red : colors.green,
        borderRadius: 12,
        paddingVertical: 15,
        paddingHorizontal: 18,
        alignItems: 'center',
        opacity: disabled || busy ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.green : colors.white} />
      ) : (
        <Text
          style={{
            color: secondary ? colors.green : colors.white,
            fontSize: 15,
            fontWeight: '600',
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8D9A94"
        style={styles.input}
        {...props}
      />
    </View>
  );
}
export function ErrorText({ message }: { message: string }) {
  return message ? (
    <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>
      {message}
    </Text>
  ) : null;
}
export function Loading() {
  return <ActivityIndicator style={{ margin: 24 }} size="large" color={colors.green} />;
}
export const statusLabel = (status: Status) =>
  ({
    PRESENT: 'Present',
    ABSENT: 'Absent',
    HALF_DAY: 'Half day',
    LEAVE: 'Leave',
    NOT_MARKED: 'Not marked',
  })[status];
export function Badge({ status }: { status: Status }) {
  const palette =
    status === 'ABSENT'
      ? ['#FAE4DE', '#A53535']
      : status === 'PRESENT'
        ? ['#E0F0E7', '#176C50']
        : ['#F2EDD9', '#7B692C'];
  return (
    <View
      style={{
        borderRadius: 8,
        backgroundColor: palette[0],
        paddingVertical: 5,
        paddingHorizontal: 10,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: palette[1], fontWeight: '600', fontSize: 12 }}>
        {statusLabel(status)}
      </Text>
    </View>
  );
}
export function timeLabel(value: string | null, timezone: string) {
  return value
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';
}
export function AttendanceCard({
  item,
  timezone,
  action,
}: {
  item: Attendance;
  timezone: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>{item.date}</Text>
        <Badge status={item.status} />
      </View>
      <Text style={styles.small}>
        In {timeLabel(item.check_in, timezone)}
        {item.attendance_mode === 'CHECK_IN_OUT' || item.check_out || item.is_open
          ? ` · Out ${timeLabel(item.check_out, timezone)}`
          : ''}
      </Text>
      {item.note ? <Text style={styles.small}>{item.note}</Text> : null}
      {(item.source === 'OWNER' || item.source === 'MANAGER') && (
        <Text style={styles.small}>
          Recorded by your shop {item.source === 'OWNER' ? 'owner' : 'manager'}
        </Text>
      )}
      {action}
    </Card>
  );
}
export function monthInZone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}
export function MonthPicker({
  month,
  setMonth,
  timezone,
}: {
  month: string;
  setMonth: (value: string) => void;
  timezone: string;
}) {
  const move = (offset: number) => {
    const [year, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(year, m - 1 + offset, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <View style={styles.row}>
      <Button secondary title="←" accessibilityLabel="Previous month" onPress={() => move(-1)} />
      <Text style={styles.heading}>
        {new Intl.DateTimeFormat('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${month}-01T12:00:00Z`))}
      </Text>
      <Button
        secondary
        title="→"
        accessibilityLabel="Next month"
        disabled={month >= monthInZone(timezone)}
        onPress={() => move(1)}
      />
    </View>
  );
}
