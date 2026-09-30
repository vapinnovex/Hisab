import { localeTag, t, useLocale, localized } from './../i18n';
import { phoneError } from '../phone';
import { RegisterCalendar } from '../components/RegisterCalendar';
import { dateInZone } from '../financial/calendar';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useUnsavedChanges } from '../pwa';
import { useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  colors,
  ErrorText,
  Field,
  Heading,
  IconButton,
  Loading,
  MonthPicker,
  Page,
  styles,
  timeLabel,
  Avatar,
  EmptyState,
  statusLabel,
} from '../components/ui';
import { useAction, useResource } from '../hooks';
import { AttendanceEntry, OwnerToday, Routes, Shop, Status, Worker } from '../types';
import { matchesPerson, SearchField } from '../components/ListControls';
import { PhoneField } from '../components/PhoneField';
import { LanguagePicker } from '../components/LanguagePicker';

export function ShopSetup() {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { api, reload, selected, signOut, session } = useAuth();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState(session!.user.name || '');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [language, setLanguage] = useState<'en' | 'hi' | 'mr'>('en');
  const [editTimezone, setEditTimezone] = useState(false);
  useUnsavedChanges(
    !!name ||
      ownerName !== (session!.user.name || '') ||
      timezone !== 'Asia/Kolkata' ||
      language !== 'en',
  );
  const action = useAction();
  const needsName = !session!.user.name;
  return (
    <Page>
      <Button
        title={t('Personal language')}
        secondary
        onPress={() => navigation.navigate('LanguageSettings')}
      />
      <View style={{ backgroundColor: colors.green, borderRadius: 26, padding: 24, gap: 14 }}>
        <View
          style={{
            backgroundColor: '#2A7158',
            padding: 12,
            borderRadius: 16,
            alignSelf: 'flex-start',
          }}
        >
          <Ionicons name="storefront-outline" size={30} color="#F4CD72" />
        </View>
        <Text style={{ color: '#D5E5D9', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 }}>
          {' '}
          {t('YOUR NEXT CHAPTER')}{' '}
        </Text>
        <Text style={{ fontSize: 29, fontWeight: '700', color: colors.white }}>
          {selected ? t('Room for another shop.') : t('Make your shop feel at home.')}
        </Text>
        <Text style={{ color: '#D5E5D9', fontSize: 14, lineHeight: 22 }}>
          {' '}
          {t('Start with the basics. Your people and their workdays come next.')}{' '}
        </Text>
      </View>
      {needsName && (
        <Card>
          <Text style={styles.eyebrow}>{t('FIRST, A LITTLE ABOUT YOU')}</Text>
          <Field
            required
            minLength={2}
            label={t('Your name')}
            value={ownerName}
            onChangeText={setOwnerName}
            maxLength={100}
            autoComplete="name"
            textContentType="name"
            placeholder={t('e.g. Prajwal Patil')}
          />
        </Card>
      )}
      <Card>
        <Text style={styles.eyebrow}>{t('YOUR SHOP DETAILS')}</Text>
        <Field
          required
          minLength={2}
          label={t('Shop name')}
          value={name}
          onChangeText={setName}
          maxLength={100}
          placeholder={t('e.g. Sharma General Store')}
        />
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Ionicons name="time-outline" size={22} color={colors.green} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.label}>{t('Shop timezone')}</Text>
            <Text style={styles.small}>
              {timezone === 'Asia/Kolkata' ? t('India · Kolkata (IST)') : timezone}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Change timezone')}
            onPress={() => setEditTimezone(!editTimezone)}
            style={{ padding: 10 }}
          >
            <Text style={{ color: colors.green, fontWeight: '700' }}>
              {editTimezone ? t('Hide') : t('Change')}
            </Text>
          </Pressable>
        </View>
        {editTimezone && (
          <Field
            required
            label={t('Shop timezone')}
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Asia/Kolkata"
          />
        )}
        <Text style={styles.small}>{t('Attendance dates follow your shop’s local time.')}</Text>
        <LanguagePicker
          label={t('Shop default language')}
          value={language}
          onChange={(value) => value && setLanguage(value)}
        />
      </Card>
      <ErrorText message={action.error} />
      <Button
        title={t('Create shop')}
        busy={action.busy}
        disabled={name.trim().length < 2 || (needsName && ownerName.trim().length < 2)}
        onPress={() =>
          void action.run(async () => {
            if (needsName) await api('/auth/profile', { name: ownerName }, 'PATCH');
            const shop = await api<Shop>('/shops', { name, timezone, language }, 'POST');
            await reload(shop.id);
          })
        }
      />
      <View
        style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="people-outline" size={17} color={colors.green} />
        <Text style={styles.small}>{t('Next up: add your workers and managers.')}</Text>
      </View>
      {!selected && (
        <Button secondary title={t('Sign out')} onPress={() => void action.run(signOut)} />
      )}
    </Page>
  );
}

export function OwnerDashboard() {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { selected, session } = useAuth();
  const shop = selected!.shop;
  const resource = useResource<OwnerToday>(`/shops/${shop.id}/attendance/today`, true);
  const rows = resource.data?.rows.filter((row) => row.worker.active) || [];
  const present = rows.filter((row) => row.attendance.status === 'PRESENT').length;
  const pending = rows.filter((row) => row.attendance.status === 'NOT_MARKED').length;
  const recorded = rows.length - pending;
  const name = (session!.role === 'OWNER' ? session!.user.name : selected!.worker_name)
    ?.trim()
    .split(/\s+/)[0];
  const date = resource.data?.date || dateInZone(shop.timezone);
  const openAttendance = (status: 'ALL' | Status = 'ALL', openCalendar = false) =>
    navigation.navigate('TodayAttendance', {
      screen: 'TodayAttendanceRoot',
      params: { status, openCalendar, requestId: Date.now().toString() },
    });
  const attendanceMessage = resource.error
    ? resource.data
      ? t('Couldn’t refresh. Counts show the last loaded attendance.')
      : t('Attendance is unavailable right now.')
    : !resource.data
      ? resource.loading
        ? t('Loading today’s attendance…')
        : t('Attendance is unavailable right now.')
      : !rows.length
        ? t('Add your team to start recording attendance.')
        : pending
          ? t('{0} {1} attendance recorded.', [
              pending,
              pending === 1 ? t('person still needs') : t('people still need'),
            ])
          : t('Everyone’s attendance is recorded for today.');
  const shortcuts: {
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = [
    {
      title: t('Manage workers'),
      icon: 'people-outline',
      onPress: () => navigation.navigate('Workers'),
    },
    ...(selected!.permissions.add_workers
      ? [
          {
            title: t('Add worker'),
            icon: 'person-add-outline' as const,
            onPress: () => navigation.navigate('WorkerForm'),
          },
        ]
      : []),
    ...(session!.role === 'OWNER'
      ? [
          {
            title: t('Manage managers'),
            icon: 'briefcase-outline' as const,
            onPress: () => navigation.navigate('Managers'),
          },
          {
            title: t('Shop settings'),
            icon: 'options-outline' as const,
            onPress: () => navigation.navigate('ShopSettings'),
          },
        ]
      : [
          {
            title: t('My attendance'),
            icon: 'checkmark-circle-outline' as const,
            onPress: () => navigation.navigate('MyAttendance'),
          },
        ]),
  ];
  return (
    <Page refresh={resource.refresh}>
      <View style={{ gap: 6 }}>
        <Text style={styles.small}>
          {new Intl.DateTimeFormat(localeTag(), {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }).format(new Date(date + 'T12:00:00Z'))}
        </Text>
        <Text style={styles.title}>{name ? t('Hello, {0}', [name]) : t('Your shop today')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="storefront-outline" size={15} color={colors.muted} />
          <Text style={[styles.small, { flex: 1 }]}>{shop.name}</Text>
        </View>
      </View>
      <View style={homeStyles.attendanceCard}>
        <View style={styles.row}>
          <Text style={styles.heading}>{t('Today’s attendance')}</Text>
          <IconButton
            compact
            name="calendar-outline"
            label={t('Open attendance calendar')}
            onPress={() => openAttendance('ALL', true)}
          />
        </View>
        <View style={homeStyles.stats}>
          {[
            { label: t('Team members'), value: rows.length, filter: 'ALL' as const },
            { label: t('Present'), value: present, filter: 'PRESENT' as const },
            { label: t('Not marked'), value: pending, filter: 'NOT_MARKED' as const },
          ].map(({ label, value, filter }, index) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={t('View attendance: {0}', [label])}
              onPress={() => openAttendance(filter)}
              style={({ pressed }) => [
                homeStyles.stat,
                index > 0 && homeStyles.statDivider,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text
                style={[
                  homeStyles.statValue,
                  label === t('Not marked') && pending > 0 && { color: '#8B5A08' },
                ]}
              >
                {resource.data ? value : '—'}
              </Text>
              <Text style={homeStyles.statLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ gap: 9 }}>
          {resource.data && rows.length > 0 && (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={t('Attendance recorded')}
              aria-valuemin={0}
              aria-valuemax={rows.length}
              aria-valuenow={recorded}
              aria-valuetext={t('{0} of {1} recorded', [recorded, rows.length])}
              style={homeStyles.progressTrack}
            >
              <View
                style={[homeStyles.progressFill, { width: `${(recorded / rows.length) * 100}%` }]}
              />
            </View>
          )}
          <Text style={styles.small}>{attendanceMessage}</Text>
        </View>
        <ErrorText message={resource.error} />
        {!!resource.error && (
          <Button title={t('Retry attendance')} secondary onPress={() => void resource.refresh()} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Open attendance')}
          onPress={() => openAttendance()}
          style={({ pressed }) => [homeStyles.primaryAction, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={{ color: colors.white, fontSize: 15, fontWeight: '700' }}>
            {selected!.permissions.manage_attendance && pending > 0
              ? t('Mark attendance')
              : t('View attendance')}
          </Text>
          <Ionicons name="arrow-forward" size={19} color={colors.white} />
        </Pressable>
      </View>
      {selected!.permissions.view_hishob && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Open Hishob')}
          onPress={() => navigation.navigate('Hishob', { screen: 'HishobToday' })}
          style={({ pressed }) => [homeStyles.cashbookCard, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={homeStyles.cashbookIcon}>
            <Ionicons name="wallet-outline" size={24} color="#8B5A08" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{t('Hishob')}</Text>
            <Text style={styles.small}>{t('Sales, expenses & daily closing')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.green} />
        </Pressable>
      )}
      <View style={{ gap: 12 }}>
        <Text style={styles.heading}>{t('Quick actions')}</Text>
        <View style={homeStyles.shortcutGrid}>
          {shortcuts.map((item) => (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={item.onPress}
              style={({ pressed }) => [homeStyles.shortcut, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name={item.icon} color={colors.green} size={21} />
              <Text style={homeStyles.shortcutLabel}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Page>
  );
}

const homeStyles = StyleSheet.create({
  attendanceCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: 18,
    gap: 12,
  },
  stats: { flexDirection: 'row', paddingVertical: 4 },
  stat: { flex: 1, gap: 5, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  statValue: { fontSize: 32, fontWeight: '700', color: colors.ink, letterSpacing: -0.8 },
  statLabel: { fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: 'center' },
  progressTrack: { height: 5, backgroundColor: colors.mint, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 3 },
  primaryAction: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 12,
  },
  cashbookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
  },
  cashbookIcon: {
    backgroundColor: colors.paleGold,
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  shortcut: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 12,
  },
  shortcutLabel: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});

function TeamList({ managersOnly = false }: { managersOnly?: boolean }) {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { selected } = useAuth();
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [role, setRole] = useState<'ALL' | 'WORKER' | 'MANAGER'>('ALL');
  const resource = useResource<Worker[]>(
    `/shops/${selected!.shop_id}/${managersOnly ? 'managers' : 'team'}`,
    true,
  );
  const people = [...(resource.data || [])].sort((a, b) => a.name.localeCompare(b.name));
  const matching = people.filter(
    (person) => matchesPerson(person, query) && (role === 'ALL' || person.role === role),
  );
  const visible = matching.filter(
    (person) => activity === 'ALL' || person.active === (activity === 'ACTIVE'),
  );
  const reset = () => {
    setQuery('');
    setActivity('ACTIVE');
    setRole('ALL');
  };
  return (
    <Page refresh={resource.refresh}>
      <View style={teamStyles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title}>{managersOnly ? t('Your managers') : t('Your team')}</Text>
          <Text style={styles.small}>
            {resource.data
              ? t('{0} active · {1} total', [
                  people.filter((person) => person.active).length,
                  people.length,
                ])
              : t('People in your shop')}
          </Text>
        </View>
        {(managersOnly
          ? selected!.permissions.manage_managers
          : selected!.permissions.add_workers) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={managersOnly ? t('Add manager') : t('Add worker')}
            onPress={() =>
              navigation.navigate('WorkerForm', { kind: managersOnly ? 'MANAGER' : 'WORKER' })
            }
            style={({ pressed }) => [teamStyles.addButton, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Ionicons name="add" size={19} color={colors.white} />
            <Text style={teamStyles.addLabel}>
              {managersOnly ? t('Add manager') : t('Add worker')}
            </Text>
          </Pressable>
        )}
      </View>
      <View style={{ gap: 12 }}>
        <SearchField label={t('Search team')} value={query} onChange={setQuery} />
        {!managersOnly && (
          <View style={teamStyles.roleTabs}>
            {(['ALL', 'WORKER', 'MANAGER'] as const).map((value, index) => {
              const label = [t('Everyone'), t('Workers'), t('Managers')][index];
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={t('Team role: {0}', [label])}
                  accessibilityState={{ selected: role === value }}
                  onPress={() => setRole(value)}
                  style={({ pressed }) => [
                    teamStyles.roleTab,
                    role === value && teamStyles.selectedTab,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    style={{
                      color: role === value ? colors.green : colors.muted,
                      fontSize: 13,
                      fontWeight: '600',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={teamStyles.statusFilters}>
          {(['ACTIVE', 'INACTIVE', 'ALL'] as const).map((value) => {
            const label =
              value === 'ALL' ? t('All') : value === 'ACTIVE' ? t('Active') : t('Inactive');
            const count = matching.filter(
              (person) => value === 'ALL' || person.active === (value === 'ACTIVE'),
            ).length;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={t('Team status: {0}, {1}', [label, count])}
                accessibilityState={{ selected: activity === value }}
                onPress={() => setActivity(value)}
                style={({ pressed }) => [
                  teamStyles.statusFilter,
                  activity === value && { backgroundColor: colors.mint },
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={{
                    color: activity === value ? colors.green : colors.muted,
                    fontSize: 13,
                    fontWeight: activity === value ? '700' : '400',
                  }}
                >
                  {label} {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      <View style={teamStyles.listHeading}>
        <Text style={styles.small}>
          {resource.data
            ? `${visible.length} ${visible.length === 1 ? 'member' : 'members'}`
            : t('Team members')}
        </Text>
        {!managersOnly && selected!.permissions.manage_managers && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Manage managers')}
            onPress={() => navigation.navigate('Managers')}
            style={({ pressed }) => [teamStyles.textAction, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={teamStyles.actionLabel}>{t('Manage managers')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.green} />
          </Pressable>
        )}
      </View>
      {resource.data && visible.length === 0 && (
        <EmptyState
          title={people.length ? t('No matching team members') : t('Your team starts here')}
          description={
            people.length
              ? t('Try another name, mobile number or filter.')
              : t('Add your people to start keeping their attendance together.')
          }
        />
      )}
      {resource.data && people.length > 0 && visible.length === 0 && (
        <Button title={t('Reset team filters')} secondary onPress={reset} />
      )}
      <View style={{ gap: 12 }}>
        {visible.map((person) => {
          const manager = person.role === 'MANAGER';
          const canEdit = manager
            ? selected!.permissions.manage_managers
            : selected!.permissions.edit_workers;
          return (
            <View key={person.id} style={teamStyles.memberCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={person.name} manager={manager} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
                    {person.name}
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={styles.small}>{manager ? t('Manager') : t('Worker')}</Text>
                    <Text
                      style={{ fontSize: 12, color: person.active ? colors.green : colors.muted }}
                    >
                      · {person.active ? t('Active') : t('Inactive')}
                    </Text>
                  </View>
                  <Text style={styles.small}>{person.mobile}</Text>
                </View>
                {canEdit && (
                  <IconButton
                    compact
                    name="create-outline"
                    label={t('Edit {0}', [person.name])}
                    onPress={() =>
                      navigation.navigate('WorkerForm', { worker: person, kind: person.role })
                    }
                  />
                )}
              </View>
              {person.password_reset_requested && (
                <View style={teamStyles.notice}>
                  <Ionicons name="key-outline" size={14} color="#8B5A08" />
                  <Text style={{ fontSize: 12, color: '#8B5A08', flex: 1 }}>
                    {' '}
                    {t('Password reset requested')}{' '}
                  </Text>
                </View>
              )}
              <View style={teamStyles.memberActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Attendance · {0}', [person.name])}
                  onPress={() => navigation.navigate('WorkerHistory', { worker: person })}
                  style={({ pressed }) => [teamStyles.textAction, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="calendar-outline" size={17} color={colors.green} />
                  <Text style={teamStyles.actionLabel}>{t('Attendance')}</Text>
                </Pressable>
                {(selected!.permissions.manage_managers ||
                  (!manager &&
                    (selected!.permissions.reset_worker_passwords ||
                      (!person.password_ready && selected!.permissions.add_workers)))) && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Password access · {0}', [person.name])}
                    onPress={() => navigation.navigate('StaffPasswordAccess', { worker: person })}
                    style={({ pressed }) => [teamStyles.textAction, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name="key-outline" size={16} color={colors.green} />
                    <Text style={teamStyles.actionLabel}>{t('Password access')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </Page>
  );
}
const teamStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  addButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addLabel: { color: colors.white, fontSize: 13, fontWeight: '700' },
  roleTabs: { flexDirection: 'row', backgroundColor: colors.mint, borderRadius: 14, padding: 4 },
  roleTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  selectedTab: { backgroundColor: colors.white, boxShadow: '0px 1px 4px rgba(24, 57, 43, 0.08)' },
  statusFilters: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  statusFilter: {
    minHeight: 44,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: -12,
    flexWrap: 'wrap',
  },
  memberCard: {
    paddingHorizontal: 16,
    paddingTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    gap: 12,
  },
  memberActions: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
    paddingVertical: 2,
  },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.green },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    backgroundColor: colors.paleGold,
    borderRadius: 8,
  },
});

export function WorkersScreen() {
  useLocale();
  return <TeamList />;
}
export function ManagersScreen() {
  useLocale();
  return <TeamList managersOnly />;
}

export function WorkerForm({ route, navigation }: NativeStackScreenProps<Routes, 'WorkerForm'>) {
  useLocale();
  const worker = route.params?.worker;
  const manager = route.params?.kind === 'MANAGER';
  const label = manager ? t('manager') : t('worker');
  const { api, selected } = useAuth();
  const [name, setName] = useState(worker?.name || '');
  const [mobile, setMobile] = useState(worker?.mobile || '+91');
  const [active, setActive] = useState(worker?.active ?? true);
  useUnsavedChanges(
    name !== (worker?.name || '') ||
      mobile !== (worker?.mobile || '+91') ||
      active !== (worker?.active ?? true),
  );
  const action = useAction();
  return (
    <Page>
      <Heading
        title={worker ? t('Edit {0}', [label]) : t('Add {0}', [label])}
        subtitle={t('They’ll use this mobile number to log in as a {0}.', [label])}
      />
      <Field
        required
        minLength={2}
        label={manager ? t('Manager name') : t('Worker name')}
        value={name}
        onChangeText={setName}
        placeholder={t('Full name')}
        maxLength={100}
      />
      <PhoneField
        value={mobile}
        onChange={setMobile}
        helperText={t(
          'Used for their password login. After adding them, open Password access to share their first setup code.',
        )}
      />
      {worker && (
        <Card>
          <View style={styles.row}>
            <Text style={styles.heading}>
              {t('Active')} {label}
            </Text>
            <Switch
              accessibilityLabel={t('Active {0}', [label])}
              value={active}
              onValueChange={setActive}
              trackColor={{ true: colors.green }}
            />
          </View>
          <Text style={styles.small}>
            {' '}
            {t('Deactivation blocks shop access and keeps all past attendance.')}{' '}
          </Text>
          {mobile !== worker.mobile && (
            <Text style={styles.small}>
              {' '}
              {t(
                'Changing this number transfers this worker profile and its history to the new number. The old number loses access to this profile.',
              )}{' '}
            </Text>
          )}
        </Card>
      )}
      <ErrorText message={action.error} />
      <Button
        title={`${worker ? t('Save') : t('Add')} ${label}`}
        busy={action.busy}
        disabled={name.trim().length < 2 || !!phoneError(mobile)}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/${manager ? 'managers' : 'workers'}${worker ? '/' + worker.id : ''}`,
              { name, mobile, ...(worker ? { active } : {}) },
              worker ? 'PATCH' : 'POST',
            );
            navigation.goBack();
          })
        }
      />
    </Page>
  );
}

function AttendanceRow({
  row,
  config,
  refresh,
}: {
  row: OwnerToday['rows'][number];
  config: OwnerToday;
  refresh: () => Promise<void>;
}) {
  useLocale();
  const { api, selected } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const action = useAction();
  const { worker, attendance, active_shift: active } = row;
  const mark = (operation: string) =>
    void action.run(async () => {
      await api(
        `/shops/${selected!.shop_id}/workers/${worker.id}/attendance/${operation}`,
        undefined,
        'POST',
      );
      await refresh();
    });
  const canMark = row.can_mark && config.date === dateInZone(config.timezone);
  const showOut =
    attendance.attendance_mode === 'CHECK_IN_OUT' || attendance.check_out || attendance.is_open;
  return (
    <View style={attendanceStyles.memberCard}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Avatar name={worker.name} manager={worker.role === 'MANAGER'} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={attendanceStyles.personName}>{worker.name}</Text>
          <Text style={styles.small}>
            {worker.role === 'MANAGER' ? t('Manager') : t('Worker')}
            {worker.active ? '' : t(' · Inactive')}
          </Text>
        </View>
        <Badge status={attendance.status} />
      </View>
      {(attendance.check_in || attendance.check_out) && (
        <View style={attendanceStyles.times}>
          <Ionicons name="time-outline" size={15} color={colors.muted} />
          <Text style={styles.small}>
            {' '}
            {t('In')} {timeLabel(attendance.check_in, config.timezone)}
            {showOut ? t(' · Out {0}', [timeLabel(attendance.check_out, config.timezone)]) : ''}
          </Text>
        </View>
      )}
      {canMark && active && active.date !== config.date && (
        <View style={attendanceStyles.notice}>
          <Ionicons name="time-outline" size={17} color="#8B5A08" />
          <Text style={{ flex: 1, color: '#8B5A08', fontSize: 13, lineHeight: 20 }}>
            {' '}
            {t('Open shift from')} {active.date}
            {t('. Record departure before starting a new day.')}{' '}
          </Text>
        </View>
      )}
      <ErrorText message={action.error} />
      <View style={attendanceStyles.memberActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.can_edit ? t('Update / history') : t('History')} · ${worker.name}`}
          onPress={() => navigation.navigate('WorkerHistory', { worker, date: config.date })}
          style={({ pressed }) => [attendanceStyles.textAction, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={attendanceStyles.actionLabel}>
            {row.can_edit ? t('View / edit') : t('View history')}
          </Text>
          <Ionicons name="chevron-forward" size={15} color={colors.green} />
        </Pressable>
        {canMark && worker.active && !active && attendance.status === 'NOT_MARKED' && (
          <View style={{ minWidth: 112 }}>
            <Button
              title={t('Mark in')}
              accessibilityLabel={t('Mark in · {0}', [worker.name])}
              busy={action.busy}
              onPress={() => mark('check-in')}
            />
          </View>
        )}
        {canMark && active && (
          <View style={{ minWidth: 112 }}>
            <Button
              title={t('Mark out')}
              accessibilityLabel={t('Mark out · {0}', [worker.name])}
              busy={action.busy}
              onPress={() => mark('check-out')}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const registerFilters: { value: 'ALL' | Status; label: string }[] = localized(() => [
  { value: 'ALL', label: t('Everyone') },
  { value: 'NOT_MARKED', label: t('Not marked') },
  { value: 'PRESENT', label: t('Present') },
  { value: 'ABSENT', label: t('Absent') },
  { value: 'HALF_DAY', label: t('Half day') },
  { value: 'LEAVE', label: t('Leave') },
]);
export function TodayAttendance({ route }: NativeStackScreenProps<Routes, 'TodayAttendanceRoot'>) {
  useLocale();
  // Each Home shortcut starts a fresh register view; ordinary tab switches preserve it.
  return <AttendanceRegister key={route.params?.requestId ?? 'register'} {...route.params} />;
}

function AttendanceRegister({
  status: initialStatus = 'ALL',
  openCalendar = false,
}: AttendanceEntry) {
  useLocale();
  const { selected } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const date = chosenDate || today;
  const [calendarOpen, setCalendarOpen] = useState(openCalendar);
  const [helpOpen, setHelpOpen] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | Status>(initialStatus);
  const resource = useResource<OwnerToday>(
    `/shops/${selected!.shop_id}/attendance/${chosenDate ? `register?day=${chosenDate}` : 'today'}`,
    true,
  );
  const rows = resource.data?.rows || [];
  const visible = rows
    .filter(
      (row) =>
        (status === 'ALL' || row.attendance.status === status) && matchesPerson(row.worker, query),
    )
    .sort((a, b) => a.worker.name.localeCompare(b.worker.name));
  const selectDate = (value: string) => {
    setChosenDate(value === today ? null : value);
    setMonth(value.slice(0, 7));
    setStatus('ALL');
    setCalendarOpen(false);
  };
  const moveDay = (offset: number) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    selectDate(value.toISOString().slice(0, 10));
  };
  const dateLabel = new Intl.DateTimeFormat(localeTag(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const resetFilters = () => {
    setQuery('');
    setStatus('ALL');
  };
  return (
    <Page refresh={resource.refresh}>
      <View style={styles.row}>
        <Text style={styles.title}>{t('Attendance')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('About attendance')}
          aria-expanded={helpOpen}
          onPress={() => setHelpOpen(!helpOpen)}
          style={({ pressed }) => [attendanceStyles.helpButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="information-circle-outline" size={24} color={colors.green} />
        </Pressable>
      </View>
      {helpOpen && (
        <View style={attendanceStyles.help}>
          <Text style={[styles.small, { color: colors.ink }]}>
            {' '}
            {t(
              'Not marked means no entry yet, not absent. Counts show the whole register, including inactive staff with an entry on the selected date. People who had not joined yet are excluded. Open a person’s details to review history. If you have permission, you can also record absence, half day or leave.',
            )}{' '}
          </Text>
        </View>
      )}
      <View style={{ gap: 10 }}>
        <View style={attendanceStyles.dateBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Previous day')}
            onPress={() => moveDay(-1)}
            style={({ pressed }) => [attendanceStyles.dayArrow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="chevron-back" size={21} color={colors.green} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              calendarOpen ? t('Hide attendance calendar') : t('Choose attendance date')
            }
            aria-expanded={calendarOpen}
            onPress={() => {
              setMonth(date.slice(0, 7));
              setCalendarOpen(!calendarOpen);
            }}
            style={({ pressed }) => [attendanceStyles.dateLabel, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={attendanceStyles.dateTitle}>
              {date === today ? t('Today') : t('Past attendance')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.small}>{dateLabel}</Text>
              <Ionicons
                name={calendarOpen ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={colors.muted}
              />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Next day')}
            accessibilityState={{ disabled: date >= today }}
            disabled={date >= today}
            onPress={() => moveDay(1)}
            style={[attendanceStyles.dayArrow, { opacity: date >= today ? 0.3 : 1 }]}
          >
            <Ionicons name="chevron-forward" size={21} color={colors.green} />
          </Pressable>
        </View>
        {date !== today && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Back to today')}
            onPress={() => selectDate(today)}
            style={[attendanceStyles.textAction, { alignSelf: 'flex-end' }]}
          >
            <Ionicons name="today-outline" size={16} color={colors.green} />
            <Text style={attendanceStyles.actionLabel}>{t('Back to today')}</Text>
          </Pressable>
        )}
        {calendarOpen && (
          <View style={{ gap: 10 }}>
            <MonthPicker month={month} setMonth={setMonth} timezone={selected!.shop.timezone} />
            <RegisterCalendar month={month} today={today} selected={date} onSelect={selectDate} />
          </View>
        )}
      </View>
      <View style={{ gap: 12 }}>
        <SearchField label={t('Search register')} value={query} onChange={setQuery} />
        <View style={attendanceStyles.filters}>
          {registerFilters.map((filter) => {
            const count =
              filter.value === 'ALL'
                ? rows.length
                : rows.filter((row) => row.attendance.status === filter.value).length;
            const active = status === filter.value;
            return (
              <Pressable
                key={filter.value}
                accessibilityRole="button"
                accessibilityLabel={t('Attendance filter: {0}, {1}', [
                  filter.label,
                  resource.data ? count : 'unavailable',
                ])}
                aria-selected={active}
                onPress={() => setStatus(filter.value)}
                style={({ pressed }) => [
                  attendanceStyles.filter,
                  active && attendanceStyles.selectedFilter,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[
                    attendanceStyles.filterLabel,
                    active && { color: colors.green, fontWeight: '700' },
                  ]}
                >
                  {filter.label}
                </Text>
                <Text style={{ color: colors.green, fontSize: 14, fontWeight: '700' }}>
                  {resource.data ? count : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ErrorText message={resource.error} />
      {!!resource.error && (
        <View style={{ gap: 8 }}>
          {resource.data && (
            <Text style={styles.small}>{t('Showing the last loaded attendance.')}</Text>
          )}
          <Button title={t('Retry attendance')} secondary onPress={() => void resource.refresh()} />
        </View>
      )}
      {resource.loading && <Loading />}
      {resource.data && (
        <View style={styles.row}>
          <Text style={styles.small}>
            {status === 'ALL' ? t('Everyone') : statusLabel(status)} · {visible.length}
          </Text>
          {(query.trim() || status !== 'ALL') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Reset register filters')}
              onPress={resetFilters}
              style={attendanceStyles.textAction}
            >
              <Text style={attendanceStyles.actionLabel}>{t('Clear filters')}</Text>
            </Pressable>
          )}
        </View>
      )}
      {resource.data && visible.length === 0 && (
        <EmptyState
          title={rows.length ? t('No matching attendance') : t('Your register is ready')}
          description={
            rows.length
              ? t('Try a different status, name or mobile number.')
              : t('No eligible team members or recorded attendance for this date.')
          }
        />
      )}
      <View style={{ gap: 12 }}>
        {visible.map((row) => (
          <AttendanceRow
            key={row.worker.id}
            row={row}
            config={resource.data!}
            refresh={resource.refresh}
          />
        ))}
      </View>
    </Page>
  );
}

const attendanceStyles = StyleSheet.create({
  helpButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  help: { padding: 14, backgroundColor: colors.mint, borderRadius: 14 },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 4,
  },
  dayArrow: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dateTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  selectedFilter: { backgroundColor: colors.mint, borderColor: colors.green },
  filterLabel: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.muted },
  memberCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  personName: { fontSize: 17, lineHeight: 23, fontWeight: '600', color: colors.ink },
  times: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paleGold,
    padding: 10,
    borderRadius: 10,
  },
  memberActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.green },
});
