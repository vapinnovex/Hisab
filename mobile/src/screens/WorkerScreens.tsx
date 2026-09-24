import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../auth';
import {
  AttendanceCard,
  Button,
  Card,
  colors,
  ErrorText,
  Loading,
  Page,
  styles,
} from '../components/ui';
import { useAction, useResource } from '../hooks';
import { Routes, Today } from '../types';

function TodayPreview() {
  const { selected } = useAuth();
  const resource = useResource<Today>(`/shops/${selected!.shop_id}/me/attendance/today`, true);
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.heading}>Your day, so far</Text>
        <Ionicons name="sunny-outline" size={22} color={colors.gold} />
      </View>
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
export function ManagerSelfAttendance({ onChanged }: { onChanged: () => Promise<void> }) {
  const { selected, api } = useAuth();
  const resource = useResource<Today>(`/shops/${selected!.shop_id}/me/attendance/today`, true);
  const action = useAction();
  const today = resource.data;
  const canMark = selected!.permissions.mark_own_attendance;
  const record = (operation: 'check-in' | 'check-out') =>
    void action.run(async () => {
      await api(`/shops/${selected!.shop_id}/me/attendance/${operation}`, undefined, 'POST');
      await Promise.all([resource.refresh(), onChanged()]);
    });
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>My workday</Text>
        <Ionicons name="finger-print-outline" size={23} color={colors.green} />
      </View>
      <ErrorText message={resource.error || action.error} />
      {resource.loading && <Loading />}
      {today && (
        <Text style={styles.small}>
          {today.attendance.status === 'NOT_MARKED'
            ? 'Your arrival has not been recorded today.'
            : `Today: ${today.attendance.status.replaceAll('_', ' ').toLowerCase()}`}
        </Text>
      )}
      {!canMark ? (
        <Text style={styles.subtitle}>
          Your owner records your attendance. They can enable self-marking in Shop settings.
        </Text>
      ) : (
        <>
          {today?.active_shift && today.active_shift.date !== today.date && (
            <Text style={styles.small}>
              Close your open shift from {today.active_shift.date} first.
            </Text>
          )}
          <Button
            title="Mark my arrival"
            busy={action.busy}
            disabled={!today || !!today.active_shift || today.attendance.status !== 'NOT_MARKED'}
            onPress={() => record('check-in')}
          />
          {today?.active_shift && (
            <Button
              title="Mark my departure"
              secondary
              busy={action.busy}
              onPress={() => record('check-out')}
            />
          )}
          <Text style={styles.small}>
            Past attendance and corrections are handled by your owner.
          </Text>
        </>
      )}
    </Card>
  );
}
export function WorkerDashboard() {
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { selected } = useAuth();
  return (
    <Page>
      <View style={{ backgroundColor: colors.green, padding: 24, borderRadius: 26, gap: 12 }}>
        <View style={styles.row}>
          <Text style={{ color: '#D0E3D2', fontSize: 11, fontWeight: '700', letterSpacing: 1.7 }}>
            A NEW DAY, TOGETHER
          </Text>
          <Ionicons name="sparkles-outline" color="#F1C369" size={24} />
        </View>
        <Text style={{ color: '#FFFDF6', fontSize: 29, fontWeight: '700', letterSpacing: -0.8 }}>
          Hello, {selected!.worker_name || 'there'}
        </Text>
        <Text style={{ color: '#DCE8DE', fontSize: 14 }}>{selected!.shop.name}</Text>
      </View>
      {selected!.permissions.view_own_attendance ? (
        <>
          <TodayPreview />
          <Card>
            <Text style={styles.heading}>Every workday tells a story.</Text>
            <Text style={styles.subtitle}>
              Your month, from present days to well-earned time off. All in one view.
            </Text>
            <Button title="My attendance" onPress={() => navigation.navigate('MyAttendance')} />
          </Card>
        </>
      ) : (
        <Card>
          <Text style={styles.subtitle}>
            Your owner has turned off attendance viewing for this shop.
          </Text>
        </Card>
      )}
    </Page>
  );
}
