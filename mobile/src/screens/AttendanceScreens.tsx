import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import {
  AttendanceCard,
  Button,
  Card,
  ErrorText,
  Field,
  Heading,
  Loading,
  MonthPicker,
  monthInZone,
  Page,
  statusLabel,
  styles,
} from '../components/ui';
import { useAction, useResource } from '../hooks';
import { Attendance, History, Routes, Status } from '../types';
import { AttendanceCalendar } from '../components/AttendanceCalendar';
import { ManagerSelfAttendance } from './WorkerScreens';

const statuses: Status[] = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'NOT_MARKED'];
function Editor({
  item,
  workerId,
  close,
  refresh,
}: {
  item: Attendance;
  workerId: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { selected, api } = useAuth();
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.note);
  const action = useAction();
  return (
    <Card>
      <Text style={styles.heading}>Update {item.date}</Text>
      <View style={{ gap: 8 }}>
        {statuses.map((value) => (
          <Button
            key={value}
            title={statusLabel(value)}
            secondary={status !== value}
            onPress={() => setStatus(value)}
          />
        ))}
      </View>
      <Field
        label="Attendance note"
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
      />
      <Text style={styles.small}>
        {status === 'NOT_MARKED'
          ? 'This clears recorded times. You or an authorised manager can record arrival again.'
          : 'This corrects the day and closes any open shift. Existing times are kept. Workers can only view the result.'}
      </Text>
      <ErrorText message={action.error} />
      <Button
        title="Save attendance"
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/workers/${workerId}/attendance`,
              { date: item.date, status, note },
              'PUT',
            );
            await refresh();
            close();
          })
        }
      />
      <Button title="Cancel update" secondary disabled={action.busy} onPress={close} />
    </Card>
  );
}

export function WorkerHistory({ route }: NativeStackScreenProps<Routes, 'WorkerHistory'>) {
  const { selected } = useAuth();
  const { worker } = route.params;
  const [month, setMonth] = useState(monthInZone(selected!.shop.timezone));
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Attendance | null>(null);
  const resource = useResource<History>(
    `/shops/${selected!.shop_id}/workers/${worker.id}/attendance?month=${month}`,
    true,
  );
  const record =
    resource.data?.days.find((item) => item.date === day) || resource.data?.days.slice(-1)[0];
  const canEdit = resource.data?.can_edit === true;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={worker.name}
        subtitle="A month at a glance. Tap a date to see or correct the day."
      />
      <MonthPicker
        month={month}
        timezone={selected!.shop.timezone}
        setMonth={(value) => {
          setMonth(value);
          setDay(null);
          setEditing(null);
        }}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <AttendanceCalendar
          history={resource.data}
          selected={record?.date || null}
          onSelect={(item) => {
            setDay(item.date);
            setEditing(null);
          }}
        />
      )}
      {resource.data?.days.length === 0 && (
        <Text style={styles.subtitle}>
          No attendance days in this month. History starts on the worker’s join date.
        </Text>
      )}
      {editing && canEdit && (
        <Editor
          key={editing.date}
          item={editing}
          workerId={worker.id}
          close={() => setEditing(null)}
          refresh={resource.refresh}
        />
      )}
      {record && (
        <AttendanceCard
          item={record}
          timezone={selected!.shop.timezone}
          action={
            canEdit ? (
              <Button
                secondary
                title={`Update ${record.date}`}
                onPress={() => setEditing(record)}
              />
            ) : undefined
          }
        />
      )}
    </Page>
  );
}

export function MyAttendance() {
  const { selected, session } = useAuth();
  const [month, setMonth] = useState(monthInZone(selected!.shop.timezone));
  const [day, setDay] = useState<string | null>(null);
  const resource = useResource<History>(
    `/shops/${selected!.shop_id}/me/attendance?month=${month}`,
    true,
  );
  const record =
    resource.data?.days.find((item) => item.date === day) || resource.data?.days.slice(-1)[0];
  if (!selected!.permissions.view_own_attendance)
    return (
      <Page>
        <Heading
          title="Attendance viewing is off"
          subtitle="Ask your shop owner to enable it for this shop."
        />
      </Page>
    );
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title="My attendance"
        subtitle={`${selected!.shop.name} · ${selected!.shop.timezone}`}
      />
      {session!.role === 'MANAGER' && <ManagerSelfAttendance onChanged={resource.refresh} />}
      <MonthPicker
        month={month}
        setMonth={(value) => {
          setMonth(value);
          setDay(null);
        }}
        timezone={selected!.shop.timezone}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <AttendanceCalendar
          history={resource.data}
          selected={record?.date || null}
          onSelect={(item) => setDay(item.date)}
        />
      )}
      {resource.data?.days.length === 0 && (
        <Text style={styles.subtitle}>No attendance days in this month.</Text>
      )}
      {record && <AttendanceCard item={record} timezone={selected!.shop.timezone} />}
    </Page>
  );
}
