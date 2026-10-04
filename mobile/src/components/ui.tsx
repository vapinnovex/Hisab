import { localeTag, t, useLocale, original } from './../i18n';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InfoHelp } from './InfoHelp';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Attendance, Status } from '../types';

type InvalidField = { message: string; focus: () => void };
const FormContext = React.createContext<{
  fields: Map<string, InvalidField>;
  refresh: () => void;
  reveal: (field: View | null) => void;
} | null>(null);
export function useFieldValidation(message: string, focus: () => void) {
  const form = React.useContext(FormContext);
  const id = React.useId();
  const focusRef = React.useRef(focus);
  React.useEffect(() => {
    focusRef.current = focus;
  });
  const fields = form?.fields;
  const refresh = form?.refresh;
  React.useEffect(() => {
    if (!fields) return;
    if (message)
      fields.set(id, { message, focus: () => requestAnimationFrame(() => focusRef.current()) });
    else fields.delete(id);
    refresh?.();
    return () => {
      fields.delete(id);
      refresh?.();
    };
  }, [fields, refresh, id, message]);
}

export const colors = {
  ink: '#123C31',
  muted: '#738079',
  green: '#145C45',
  gold: '#E9A015',
  paleGold: '#FFF1D6',
  mint: '#E8F0E8',
  background: '#FAF8F2',
  line: '#EAECE3',
  red: '#A53535',
  white: '#FFFFFF',
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 20,
    gap: 18,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingBottom: 28,
  },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink, letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 23, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.white,
    padding: 15,
    color: colors.ink,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 12,
    boxShadow: '0px 4px 18px rgba(24, 57, 43, 0.035)',
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
  topInset = false,
}: {
  children: React.ReactNode;
  refresh?: () => Promise<void>;
  topInset?: boolean;
}) {
  useLocale();
  const [refreshing, setRefreshing] = React.useState(false);
  const insets = useSafeAreaInsets();
  const [fields] = React.useState(() => new Map<string, InvalidField>());
  const [revision, render] = React.useReducer((n: number) => n + 1, 0);
  const scroll = React.useRef<ScrollView>(null);
  const content = React.useRef<View>(null);
  const reveal = React.useCallback((field: View | null) => {
    if (Platform.OS !== 'web' && field && content.current) {
      field.measureLayout(
        content.current,
        (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }),
        () => {},
      );
    }
  }, []);
  const form = React.useMemo(
    () => ({ fields, refresh: render, reveal, revision }),
    [fields, reveal, revision],
  );
  return (
    <FormContext.Provider value={form}>
      <SafeAreaView
        edges={topInset ? ['top', 'left', 'right'] : ['left', 'right']}
        style={styles.page}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scroll}
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(28, insets.bottom + 16) },
            ]}
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
            <View ref={content} style={{ gap: 18 }}>
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </FormContext.Provider>
  );
}
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  useLocale();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  useLocale();
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
  validationMessage,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
  validationMessage?: string;
}) {
  useLocale();
  const form = React.useContext(FormContext);
  const [attempted, setAttempted] = React.useState(false);
  const submit =
    /^(save|confirm|continue|start|close today|create|register|sign in|set password|update|send|verify)/i.test(
      original(title),
    );
  const first = form?.fields.values().next().value;
  const explanation =
    validationMessage ||
    (submit && disabled
      ? first?.message || t('Complete the required fields above to continue.')
      : '');
  const icon: React.ComponentProps<typeof Ionicons>['name'] | undefined = secondary
    ? original(title).startsWith('Edit ')
      ? 'create-outline'
      : original(title).startsWith('Delete ·')
        ? 'trash-outline'
        : original(title) === 'Search'
          ? 'search-outline'
          : title === '←'
            ? 'chevron-back'
            : title === '→'
              ? 'chevron-forward'
              : undefined
    : undefined;
  if (icon)
    return (
      <IconButton
        name={icon}
        label={accessibilityLabel || title}
        onPress={onPress}
        disabled={disabled || busy}
        danger={original(title).startsWith('Delete ·')}
      />
    );
  return (
    <View style={{ gap: 8 }}>
      {attempted && explanation ? <ErrorText message={explanation} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        disabled={busy || (disabled && !explanation)}
        onPressOut={() => {
          if (explanation && !busy) {
            setAttempted(true);
            first?.focus();
          }
        }}
        onPress={() => {
          if (explanation) {
            setAttempted(true);
            first?.focus();
            return;
          }
          onPress();
        }}
        style={({ pressed }) => ({
          backgroundColor: secondary ? colors.mint : danger ? colors.red : colors.green,
          borderRadius: 14,
          paddingVertical: 15,
          paddingHorizontal: 18,
          alignItems: 'center',
          opacity: busy || (disabled && !explanation) ? 0.45 : pressed ? 0.8 : 1,
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
    </View>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  disabled,
  danger = false,
  compact = false,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
}) {
  useLocale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: compact ? 44 : 48,
        minHeight: compact ? 44 : 48,
        padding: compact ? 8 : 12,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        backgroundColor: compact ? 'transparent' : colors.mint,
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
      })}
    >
      <Ionicons name={name} size={compact ? 20 : 23} color={danger ? colors.red : colors.green} />
    </Pressable>
  );
}
export function Field({
  label,
  help,
  required = false,
  error = '',
  minLength = 1,
  ...props
}: TextInputProps & {
  label: string;
  help?: string;
  required?: boolean;
  error?: string;
  minLength?: number;
}) {
  useLocale();
  const input = React.useRef<TextInput>(null);
  const wrapper = React.useRef<View>(null);
  const form = React.useContext(FormContext);
  const [touched, setTouched] = React.useState(false);
  const edited = React.useRef(false);
  const message =
    error ||
    (required && (props.value || '').trim().length < minLength
      ? t('Enter {0}{1}.', [
          label.toLowerCase(),
          minLength > 1 ? t(' (at least {0} characters)', [minLength]) : '',
        ])
      : '');
  const focus = () => {
    setTouched(true);
    input.current?.focus();
    form?.reveal(wrapper.current);
    if (Platform.OS === 'web')
      (input.current as unknown as HTMLElement)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
  };
  useFieldValidation(message, focus);
  return (
    <View ref={wrapper}>
      {help ? <InfoHelp title={label}>{help}</InfoHelp> : <Text style={styles.label}>{label}</Text>}
      <Text style={[styles.small, { marginBottom: 6 }]}>
        {required ? t('Required') : t('Optional')}
      </Text>
      <TextInput
        {...props}
        ref={input}
        accessibilityLabel={label}
        placeholderTextColor="#8D9A94"
        onChangeText={(value) => {
          edited.current = true;
          props.onChangeText?.(value);
        }}
        onBlur={(event) => {
          if (edited.current) setTouched(true);
          props.onBlur?.(event);
        }}
        onFocus={(event) => {
          if (Platform.OS === 'web')
            (input.current as unknown as HTMLElement)?.scrollIntoView?.({
              behavior: 'smooth',
              block: 'center',
            });
          form?.reveal(wrapper.current);
          props.onFocus?.(event);
        }}
        style={[
          styles.input,
          props.style,
          touched && message ? { borderColor: colors.red } : undefined,
        ]}
      />
      {touched && <ErrorText message={message} />}
    </View>
  );
}
export function ErrorText({ message }: { message: string }) {
  useLocale();
  return message ? (
    <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>
      {message}
    </Text>
  ) : null;
}
export function Loading() {
  useLocale();
  return <ActivityIndicator style={{ margin: 24 }} size="large" color={colors.green} />;
}
export const statusLabel = (status: Status) =>
  ({
    PRESENT: t('Present'),
    ABSENT: t('Absent'),
    HALF_DAY: t('Half day'),
    LEAVE: t('Leave'),
    NOT_MARKED: t('Not marked'),
  })[status];
export function Badge({ status }: { status: Status }) {
  useLocale();
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
    ? new Intl.DateTimeFormat(localeTag(), {
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
  useLocale();
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>{item.date}</Text>
        <Badge status={item.status} />
      </View>
      <Text style={styles.small}>
        {' '}
        {t('In')} {timeLabel(item.check_in, timezone)}
        {item.attendance_mode === 'CHECK_IN_OUT' || item.check_out || item.is_open
          ? t(' · Out {0}', [timeLabel(item.check_out, timezone)])
          : ''}
      </Text>
      {item.note ? <Text style={styles.small}>{item.note}</Text> : null}
      {item.source === 'FACE' && (
        <Text style={styles.small}>{t('Recorded by face attendance')}</Text>
      )}
      {(item.source === 'OWNER' || item.source === 'MANAGER') && (
        <Text style={styles.small}>
          {' '}
          {item.source === 'OWNER'
            ? t('Recorded by your shop owner')
            : t('Recorded by your shop manager')}
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
  useLocale();
  const move = (offset: number) => {
    const [year, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(year, m - 1 + offset, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <View style={styles.row}>
      <Button
        secondary
        title="←"
        accessibilityLabel={t('Previous month')}
        onPress={() => move(-1)}
      />
      <Text style={styles.heading}>
        {new Intl.DateTimeFormat(localeTag(), {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${month}-01T12:00:00Z`))}
      </Text>
      <Button
        secondary
        title="→"
        accessibilityLabel={t('Next month')}
        disabled={month >= monthInZone(timezone)}
        onPress={() => move(1)}
      />
    </View>
  );
}

export function Avatar({ name, manager = false }: { name: string; manager?: boolean }) {
  useLocale();
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 16,
        backgroundColor: manager ? colors.paleGold : colors.mint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: manager ? '#8B5A08' : colors.green, fontWeight: '800', fontSize: 17 }}>
        {name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toUpperCase()}
      </Text>
    </View>
  );
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  useLocale();
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 22 }}>
        <Text style={styles.heading}>{title}</Text>
        <Text style={[styles.subtitle, { textAlign: 'center' }]}>{description}</Text>
      </View>
    </Card>
  );
}
