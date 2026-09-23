import React from 'react';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import {
  AttendanceCard,
  Button,
  Card,
  ErrorText,
  Heading,
  Loading,
  Page,
  styles,
} from '../components/ui';
import { ShopSwitcher } from '../components/ShopSwitcher';
import { useAction, useResource } from '../hooks';
import { Routes, Today } from '../types';

function TodayPreview() {
  const { selected } = useAuth();
  const resource = useResource<Today>(`/shops/${selected!.shop_id}/me/attendance/today`, true);
  return (
    <>
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <AttendanceCard item={resource.data.attendance} timezone={resource.data.timezone} />
      )}
      <Text style={styles.small}>
        Your owner or manager records attendance. If something looks wrong, ask them to correct it.
      </Text>
    </>
  );
}

export function WorkerDashboard({ navigation }: NativeStackScreenProps<Routes, 'Dashboard'>) {
  const { selected } = useAuth();
  return (
    <Page>
      <Text style={styles.eyebrow}>YOUR WORKDAY</Text>
      <Heading
        title={`Hello, ${selected!.worker_name || 'there'}`}
        subtitle={selected!.shop.name}
      />
      <ShopSwitcher />
      {selected!.permissions.view_own_attendance ? (
        <>
          <TodayPreview />
          <Button title="My attendance" onPress={() => navigation.navigate('MyAttendance')} />
        </>
      ) : (
        <Card>
          <Text style={styles.subtitle}>
            Your owner has turned off attendance viewing for this shop.
          </Text>
        </Card>
      )}
      <Button title="My profile" secondary onPress={() => navigation.navigate('Profile')} />
    </Page>
  );
}
export function Profile() {
  const { session, selected, signOut, reload } = useAuth();
  const action = useAction();
  return (
    <Page>
      <Heading title="Your profile" subtitle="Your account and shop details." />
      <Card>
        <Text style={styles.eyebrow}>{session!.role}</Text>
        {selected?.worker_name && <Text style={styles.heading}>{selected.worker_name}</Text>}
        <Text style={styles.subtitle}>{session!.user.mobile}</Text>
        <Text style={styles.heading}>{selected?.shop.name || 'No active shop'}</Text>
        <Text style={styles.small}>{selected?.shop.timezone}</Text>
      </Card>
      <ShopSwitcher />
      <Text style={styles.small}>
        {session!.role === 'WORKER'
          ? 'To change your name or mobile number, ask your shop owner.'
          : 'Roles and access are managed separately for each shop.'}
      </Text>
      <ErrorText message={action.error} />
      <Button
        title="Refresh memberships"
        secondary
        busy={action.busy}
        onPress={() => void action.run(reload)}
      />
      <Button title="Sign out" danger busy={action.busy} onPress={() => void action.run(signOut)} />
    </Page>
  );
}
