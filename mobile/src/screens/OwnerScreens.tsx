import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  colors,
  ErrorText,
  Field,
  Heading,
  Loading,
  Page,
  styles,
  timeLabel,
  Avatar,
  EmptyState,
  statusLabel,
} from '../components/ui';
import { useAction, useResource } from '../hooks';
import { OwnerToday, Routes, Shop, Status, Worker } from '../types';
import { FilterChips, matchesPerson, SearchField } from '../components/ListControls';

export function ShopSetup() {
  const { api, reload, selected, signOut } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const action = useAction();
  return (
    <Page>
      <Text style={styles.eyebrow}>A PLACE FOR YOUR TEAM</Text>
      <Heading
        title="Let’s set up your shop"
        subtitle="Start with a name. You can add your workers next."
      />
      <Field
        label="Shop name"
        value={name}
        onChangeText={setName}
        maxLength={100}
        placeholder="e.g. Sharma General Store"
      />
      <Field
        label="Shop timezone"
        value={timezone}
        onChangeText={setTimezone}
        autoCapitalize="none"
        placeholder="Asia/Kolkata"
      />
      <Text style={styles.small}>
        Attendance days follow this timezone, even when a worker is travelling.
      </Text>
      <ErrorText message={action.error} />
      <Button
        title="Create shop"
        busy={action.busy}
        disabled={name.trim().length < 2}
        onPress={() =>
          void action.run(async () => {
            const shop = await api<Shop>('/shops', { name, timezone }, 'POST');
            await reload(shop.id);
          })
        }
      />
      {!selected && <Button secondary title="Sign out" onPress={() => void action.run(signOut)} />}
    </Page>
  );
}

export function OwnerDashboard() {
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { selected, session } = useAuth();
  const shop = selected!.shop;
  const resource = useResource<OwnerToday>(`/shops/${shop.id}/attendance/today`, true);
  const rows = resource.data?.rows.filter((row) => row.worker.active) || [];
  const present = rows.filter((row) => row.attendance.status === 'PRESENT').length;
  const pending = rows.filter((row) => row.attendance.status === 'NOT_MARKED').length;
  const shortcuts: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = [
    {
      title: 'Manage workers',
      subtitle: 'Your people, together',
      icon: 'people-outline',
      onPress: () => navigation.navigate('Workers'),
    },
    ...(selected!.permissions.add_workers
      ? [
          {
            title: 'Add worker',
            subtitle: 'Welcome someone new',
            icon: 'person-add-outline' as const,
            onPress: () => navigation.navigate('WorkerForm'),
          },
        ]
      : []),
    ...(session!.role === 'OWNER'
      ? [
          {
            title: 'Manage managers',
            subtitle: 'Trusted hands for your shop',
            icon: 'briefcase-outline' as const,
            onPress: () => navigation.navigate('Managers'),
          },
          {
            title: 'Shop settings',
            subtitle: 'Make it work your way',
            icon: 'options-outline' as const,
            onPress: () => navigation.navigate('ShopSettings'),
          },
        ]
      : [
          {
            title: 'My attendance',
            subtitle: 'Your own workday',
            icon: 'checkmark-circle-outline' as const,
            onPress: () => navigation.navigate('MyAttendance'),
          },
        ]),
  ];
  return (
    <Page refresh={resource.refresh}>
      <View style={{ gap: 5 }}>
        <Text style={styles.eyebrow}>
          {session!.role === 'OWNER' ? 'OWNER’S DESK' : 'MANAGER’S DESK'}
        </Text>
        <Heading
          title="Let’s make today count."
          subtitle={
            resource.data?.date
              ? new Intl.DateTimeFormat('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'UTC',
                }).format(new Date(resource.data.date + 'T12:00:00Z'))
              : 'Your daily shop overview'
          }
        />
      </View>
      <View style={{ backgroundColor: colors.green, borderRadius: 26, padding: 22, gap: 20 }}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#CDE0CF', fontSize: 11, letterSpacing: 1.7, fontWeight: '700' }}>
              TODAY AT
            </Text>
            <Text style={{ color: '#FFFCF2', fontSize: 24, fontWeight: '700' }}>{shop.name}</Text>
          </View>
          <View
            style={{
              width: 44,
              height: 44,
              backgroundColor: '#2A7158',
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="storefront-outline" size={23} color="#F4CD72" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[
            ['Team', rows.length],
            ['Present', present],
            ['To mark', pending],
          ].map(([label, value]) => (
            <View key={label} style={{ gap: 3 }}>
              <Text
                style={{
                  color: label === 'To mark' ? '#F4C368' : '#FFFFFF',
                  fontSize: 36,
                  fontWeight: '700',
                  letterSpacing: -1,
                }}
              >
                {resource.loading ? '—' : value}
              </Text>
              <Text style={{ color: '#D5E5D9', fontSize: 12 }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <ErrorText message={resource.error} />
      <Button
        title="View today’s attendance"
        onPress={() => navigation.navigate('TodayAttendance')}
      />
      <View style={styles.row}>
        <Text style={styles.heading}>A little less to do.</Text>
        <Text style={styles.small}>Quick actions</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {shortcuts.map((item, i) => (
          <Pressable
            key={item.title}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={item.onPress}
            style={({ pressed }) => ({
              width: '48%',
              flexGrow: 1,
              backgroundColor: colors.white,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 20,
              padding: 16,
              gap: 11,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View
              style={{
                backgroundColor: i % 2 ? colors.paleGold : colors.mint,
                width: 42,
                height: 42,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={item.icon} color={i % 2 ? '#96610A' : colors.green} size={21} />
            </View>
            <Text style={[styles.heading, { fontSize: 15 }]}>{item.title}</Text>
            <Text style={[styles.small, { fontSize: 11, lineHeight: 16 }]}>{item.subtitle}</Text>
          </Pressable>
        ))}
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center' }}
      >
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green }} />
        <Text style={styles.small}>Always in step with your team</Text>
      </View>
    </Page>
  );
}

function TeamList({ managersOnly = false }: { managersOnly?: boolean }) {
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
      <Heading
        title={managersOnly ? 'Your managers' : 'Your team'}
        subtitle={
          managersOnly
            ? 'Trusted hands. Permissions stay in your control.'
            : 'Workers and managers, together in one place.'
        }
      />
      <View style={{ gap: 10 }}>
        {!managersOnly && selected!.permissions.add_workers && (
          <Button
            title="Add worker"
            onPress={() => navigation.navigate('WorkerForm', { kind: 'WORKER' })}
          />
        )}
        {selected!.permissions.manage_managers && (
          <Button
            title={managersOnly ? 'Add manager' : 'Manage managers'}
            secondary={!managersOnly}
            onPress={() =>
              managersOnly
                ? navigation.navigate('WorkerForm', { kind: 'MANAGER' })
                : navigation.navigate('Managers')
            }
          />
        )}
      </View>
      <SearchField label="Search team" value={query} onChange={setQuery} />
      {!managersOnly && (
        <FilterChips
          label="Team role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'ALL', label: 'Everyone' },
            { value: 'WORKER', label: 'Workers' },
            { value: 'MANAGER', label: 'Managers' },
          ]}
        />
      )}
      <FilterChips
        label="Team status"
        value={activity}
        onChange={setActivity}
        options={[
          {
            value: 'ACTIVE',
            label: 'Active',
            count: matching.filter((person) => person.active).length,
          },
          {
            value: 'INACTIVE',
            label: 'Inactive',
            count: matching.filter((person) => !person.active).length,
          },
          { value: 'ALL', label: 'All', count: matching.length },
        ]}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <Text style={styles.small}>
          {visible.length} of {people.length} team members
        </Text>
      )}
      {resource.data && visible.length === 0 && (
        <EmptyState
          title={people.length ? 'No matching team members' : 'Your team starts here'}
          description={
            people.length
              ? 'Try another name, mobile number or filter.'
              : 'Add your people to start keeping their attendance together.'
          }
        />
      )}
      {resource.data && people.length > 0 && visible.length === 0 && (
        <Button title="Reset team filters" secondary onPress={reset} />
      )}
      {visible.map((person) => {
        const manager = person.role === 'MANAGER';
        const canEdit = manager
          ? selected!.permissions.manage_managers
          : selected!.permissions.edit_workers;
        return (
          <Card key={person.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={person.name} manager={manager} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.heading}>{person.name}</Text>
                <Text style={styles.small}>
                  {manager ? 'Manager' : 'Worker'} · {person.active ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
            <Text style={styles.subtitle}>{person.mobile}</Text>
            {canEdit && (
              <Button
                secondary
                title={`Edit ${person.name}`}
                onPress={() =>
                  navigation.navigate('WorkerForm', { worker: person, kind: person.role })
                }
              />
            )}
            <Button
              secondary
              title={`Attendance · ${person.name}`}
              onPress={() => navigation.navigate('WorkerHistory', { worker: person })}
            />
          </Card>
        );
      })}
    </Page>
  );
}
export function WorkersScreen() {
  return <TeamList />;
}
export function ManagersScreen() {
  return <TeamList managersOnly />;
}

export function WorkerForm({ route, navigation }: NativeStackScreenProps<Routes, 'WorkerForm'>) {
  const worker = route.params?.worker;
  const manager = route.params?.kind === 'MANAGER';
  const label = manager ? 'manager' : 'worker';
  const { api, selected } = useAuth();
  const [name, setName] = useState(worker?.name || '');
  const [mobile, setMobile] = useState(worker?.mobile || '+91');
  const [active, setActive] = useState(worker?.active ?? true);
  const action = useAction();
  return (
    <Page>
      <Heading
        title={worker ? `Edit ${label}` : `Add ${label}`}
        subtitle={`They’ll use this mobile number to log in as a ${label}.`}
      />
      <Field
        label={manager ? 'Manager name' : 'Worker name'}
        value={name}
        onChangeText={setName}
        placeholder="Full name"
        maxLength={100}
      />
      <Field
        label="Mobile number"
        value={mobile}
        onChangeText={setMobile}
        keyboardType="phone-pad"
        autoComplete="tel"
        maxLength={20}
      />
      {worker && (
        <Card>
          <View style={styles.row}>
            <Text style={styles.heading}>Active {label}</Text>
            <Switch
              accessibilityLabel={`Active ${label}`}
              value={active}
              onValueChange={setActive}
              trackColor={{ true: colors.green }}
            />
          </View>
          <Text style={styles.small}>
            Deactivation blocks shop access and keeps all past attendance.
          </Text>
          {mobile !== worker.mobile && (
            <Text style={styles.small}>
              Changing this number transfers this worker profile and its history to the new number.
              The old number loses access to this profile.
            </Text>
          )}
        </Card>
      )}
      <ErrorText message={action.error} />
      <Button
        title={`${worker ? 'Save' : 'Add'} ${label}`}
        busy={action.busy}
        disabled={name.trim().length < 2 || mobile.length < 8}
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
  const canMark = row.can_mark;
  const showOut =
    attendance.attendance_mode === 'CHECK_IN_OUT' || attendance.check_out || attendance.is_open;
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>
          {worker.name}
          {worker.role === 'MANAGER' ? ' · Manager' : ''}
          {worker.active ? '' : ' · inactive'}
        </Text>
        <Badge status={attendance.status} />
      </View>
      <Text style={styles.small}>
        In {timeLabel(attendance.check_in, config.timezone)}
        {showOut ? ` · Out ${timeLabel(attendance.check_out, config.timezone)}` : ''}
      </Text>
      {active && active.date !== config.date && (
        <Text style={styles.small}>
          Open shift from {active.date}. Record departure before starting a new day.
        </Text>
      )}
      <ErrorText message={action.error} />
      {canMark && worker.active && !active && attendance.status === 'NOT_MARKED' && (
        <Button
          title={`Mark in · ${worker.name}`}
          busy={action.busy}
          onPress={() => mark('check-in')}
        />
      )}
      {canMark && active && (
        <Button
          title={`Mark out · ${worker.name}`}
          busy={action.busy}
          onPress={() => mark('check-out')}
        />
      )}
      <Button
        secondary
        title={`${row.can_edit ? 'Update / history' : 'History'} · ${worker.name}`}
        onPress={() => navigation.navigate('WorkerHistory', { worker })}
      />
    </Card>
  );
}
const registerFilters: {
  value: 'ALL' | Status;
  label: string;
  background: string;
  color: string;
}[] = [
  { value: 'ALL', label: 'Everyone', background: colors.mint, color: colors.green },
  { value: 'PRESENT', label: 'Present', background: '#DDF0E4', color: '#176C50' },
  { value: 'ABSENT', label: 'Absent', background: '#FBE3DF', color: '#A53535' },
  { value: 'NOT_MARKED', label: 'Not marked', background: '#ECEFEA', color: '#59685F' },
  { value: 'HALF_DAY', label: 'Half day', background: colors.paleGold, color: '#8B5A08' },
  { value: 'LEAVE', label: 'Leave', background: '#EAE5FD', color: '#5946A3' },
];
export function TodayAttendance() {
  const { selected } = useAuth();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | Status>('ALL');
  const resource = useResource<OwnerToday>(`/shops/${selected!.shop_id}/attendance/today`, true);
  const rows = resource.data?.rows || [];
  const visible = rows
    .filter(
      (row) =>
        (status === 'ALL' || row.attendance.status === status) && matchesPerson(row.worker, query),
    )
    .sort((a, b) => a.worker.name.localeCompare(b.worker.name));
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title="Today’s attendance"
        subtitle={`${resource.data?.date || 'Today'} · ${selected!.shop.name}`}
      />
      <Text style={styles.small}>
        Tap a count to see who’s present, absent or still to be marked.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
              accessibilityLabel={`Attendance filter: ${filter.label}, ${count}`}
              accessibilityState={{ selected: active }}
              onPress={() => setStatus(filter.value)}
              style={{
                width: '30%',
                flexGrow: 1,
                padding: 12,
                gap: 3,
                borderRadius: 16,
                borderWidth: 2,
                borderColor: active ? filter.color : 'transparent',
                backgroundColor: filter.background,
              }}
            >
              <Text style={{ color: filter.color, fontSize: 25, fontWeight: '700' }}>
                {resource.loading ? '—' : count}
              </Text>
              <Text style={{ color: filter.color, fontSize: 12, fontWeight: '600' }}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <SearchField label="Search register" value={query} onChange={setQuery} />
      <Text style={styles.small}>
        Not marked means no entry yet, not absent. Counts show the whole register, including
        inactive staff with an entry today.
      </Text>
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <View style={styles.row}>
          <Text style={styles.heading}>
            {status === 'ALL' ? 'Everyone' : statusLabel(status)} · {visible.length}
          </Text>
          <Text style={styles.small}>
            {query.trim() ? 'Matching your search' : 'Today’s register'}
          </Text>
        </View>
      )}
      {resource.data && visible.length === 0 && (
        <>
          <EmptyState
            title={rows.length ? 'No matching attendance' : 'Your register is ready'}
            description={
              rows.length
                ? 'Try a different status, name or mobile number.'
                : 'Add a worker or manager to start recording attendance.'
            }
          />
          {(query || status !== 'ALL') && (
            <Button
              secondary
              title="Reset register filters"
              onPress={() => {
                setQuery('');
                setStatus('ALL');
              }}
            />
          )}
        </>
      )}
      {visible.map((row) => (
        <AttendanceRow
          key={row.worker.id}
          row={row}
          config={resource.data!}
          refresh={resource.refresh}
        />
      ))}
    </Page>
  );
}
