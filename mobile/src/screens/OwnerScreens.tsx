import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
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
} from '../components/ui';
import { ShopSwitcher } from '../components/ShopSwitcher';
import { useAction, useResource } from '../hooks';
import { OwnerToday, Routes, Shop, Worker } from '../types';

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

export function OwnerDashboard({ navigation }: NativeStackScreenProps<Routes, 'Dashboard'>) {
  const { selected, session } = useAuth();
  const shop = selected!.shop;
  const resource = useResource<OwnerToday>(`/shops/${shop.id}/attendance/today`, true);
  const rows = resource.data?.rows || [];
  return (
    <Page refresh={resource.refresh}>
      <Text style={styles.eyebrow}>
        {session!.role === 'OWNER' ? 'OWNER’S DESK' : 'MANAGER’S DESK'}
      </Text>
      <Heading title={shop.name} subtitle="A little clarity for your everyday." />
      <ShopSwitcher />
      {resource.loading && <Loading />}
      <ErrorText message={resource.error} />
      <Card>
        <View style={styles.row}>
          <Text style={styles.heading}>Today at your shop</Text>
          <Text style={styles.small}>{resource.data?.date}</Text>
        </View>
        <View style={styles.row}>
          {[
            ['Active workers', rows.filter((r) => r.worker.active).length],
            ['Present', rows.filter((r) => r.attendance.status === 'PRESENT').length],
            ['Not marked', rows.filter((r) => r.attendance.status === 'NOT_MARKED').length],
          ].map(([label, value]) => (
            <View key={label} style={{ gap: 5 }}>
              <Text style={[styles.title, { color: colors.green }]}>{value}</Text>
              <Text style={styles.small}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.small}>Updates every 5 seconds while this screen is open.</Text>
        <Button
          title="View today’s attendance"
          onPress={() => navigation.navigate('TodayAttendance')}
        />
      </Card>
      <Card>
        <Text style={styles.heading}>Your people, in one place</Text>
        <Text style={styles.subtitle}>
          Add workers, update their details, and look back at their attendance.
        </Text>
        <Button title="Manage workers" onPress={() => navigation.navigate('Workers')} secondary />
        {selected!.permissions.add_workers && (
          <Button title="Add worker" onPress={() => navigation.navigate('WorkerForm')} />
        )}
      </Card>
      {session!.role === 'OWNER' && (
        <>
          <Button
            title="Manage managers"
            secondary
            onPress={() => navigation.navigate('Managers')}
          />
          <Button
            title="Shop settings"
            secondary
            onPress={() => navigation.navigate('ShopSettings')}
          />
          <Button
            title="Create another shop"
            secondary
            onPress={() => navigation.navigate('ShopSetup')}
          />
        </>
      )}
      <Button secondary title="Profile & sign out" onPress={() => navigation.navigate('Profile')} />
    </Page>
  );
}

function TeamList({ kind }: { kind: 'WORKER' | 'MANAGER' }) {
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { selected } = useAuth();
  const manager = kind === 'MANAGER';
  const resource = useResource<Worker[]>(
    `/shops/${selected!.shop_id}/${manager ? 'managers' : 'workers'}`,
  );
  const canAdd = manager
    ? selected!.permissions.manage_managers
    : selected!.permissions.add_workers;
  const canEdit = manager
    ? selected!.permissions.manage_managers
    : selected!.permissions.edit_workers;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={manager ? 'Your managers' : 'Your workers'}
        subtitle={
          manager
            ? 'Appoint someone you trust. You control their permissions in Shop settings.'
            : 'Your team, with attendance history kept even after deactivation.'
        }
      />
      {canAdd && (
        <Button
          title={manager ? 'Add manager' : 'Add worker'}
          onPress={() => navigation.navigate('WorkerForm', { kind })}
        />
      )}
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data?.length === 0 && (
        <Card>
          <Text style={styles.subtitle}>No {manager ? 'managers' : 'workers'} yet.</Text>
        </Card>
      )}
      {resource.data?.map((worker) => (
        <Card key={worker.id}>
          <View style={styles.row}>
            <Text style={styles.heading}>{worker.name}</Text>
            <Text style={styles.small}>
              {worker.active ? 'Active' : 'Inactive'} · {manager ? 'Manager' : 'Worker'}
            </Text>
          </View>
          <Text style={styles.subtitle}>{worker.mobile}</Text>
          {canEdit && (
            <Button
              secondary
              title={`Edit ${worker.name}`}
              onPress={() => navigation.navigate('WorkerForm', { worker, kind })}
            />
          )}
          {!manager && (
            <Button
              secondary
              title={`Attendance · ${worker.name}`}
              onPress={() => navigation.navigate('WorkerHistory', { worker })}
            />
          )}
        </Card>
      ))}
    </Page>
  );
}
export function WorkersScreen() {
  return <TeamList kind="WORKER" />;
}
export function ManagersScreen() {
  return <TeamList kind="MANAGER" />;
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
  const canMark = config.permissions.manage_attendance;
  const showOut =
    attendance.attendance_mode === 'CHECK_IN_OUT' || attendance.check_out || attendance.is_open;
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>
          {worker.name}
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
        title={`${canMark ? 'Update / history' : 'History'} · ${worker.name}`}
        onPress={() => navigation.navigate('WorkerHistory', { worker })}
      />
    </Card>
  );
}
export function TodayAttendance() {
  const { selected } = useAuth();
  const resource = useResource<OwnerToday>(`/shops/${selected!.shop_id}/attendance/today`, true);
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title="Today’s attendance"
        subtitle={`${resource.data?.date || 'Today'} · ${selected!.shop.timezone}`}
      />
      <Text style={styles.small}>
        {resource.data?.settings.attendance_mode === 'CHECK_IN_OUT'
          ? 'Record arrival and departure.'
          : 'Check-in only. Mark each arrival once; no check-out needed.'}{' '}
        Use history to correct half-days, leave or absences.
      </Text>
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data?.rows.length === 0 && (
        <Text style={styles.subtitle}>Add a worker to start your daily register.</Text>
      )}
      {resource.data?.rows.map((row) => (
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
