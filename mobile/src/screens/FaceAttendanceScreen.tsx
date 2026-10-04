import React, { useEffect, useState } from 'react';
import { Image, Linking, Modal, Platform, Switch, Text, View } from 'react-native';
import { t, useLocale } from '../i18n';
import { API_URL } from '../api';
import { SearchField } from '../components/ListControls';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import {
  Button,
  Card,
  colors,
  ErrorText,
  Field,
  Heading,
  Loading,
  Page,
  styles,
} from '../components/ui';

type Device = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PENDING';
  confirmation: string;
  last_seen: string;
  expires_at: string;
  camera: string;
};
type Member = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  enrolled: boolean;
  has_template: boolean;
  can_enroll: boolean;
  eligible: boolean;
};
type Overview = {
  revision: number;
  enabled: boolean;
  manager_can_enroll_workers: boolean;
  allow_manager_attendance: boolean;
  ready: boolean;
  problem: string;
  owner: boolean;
  members: Member[];
  devices: Device[];
  station_path: string;
  enrollments: {
    id: string;
    member_id: string;
    device_id: string;
    status: string;
    expires_at: string;
  }[];
  events: {
    at: string;
    by: string;
    actor_name: string;
    action: string;
    device_name?: string;
    member_id?: string;
  }[];
};
type ConfirmAction = { title: string; detail: string; path: string; body?: unknown };

function Toggle({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.heading}>{label}</Text>
        {detail && <Text style={styles.small}>{detail}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: '#D4DCD5', true: colors.green }}
      />
    </View>
  );
}

function eventName(action: string) {
  const names: Record<string, string> = {
    SETTINGS_CHANGED: t('Face settings changed'),
    PAIRING_CREATED: t('Pairing code created'),
    DEVICE_REQUESTED: t('Device connection requested'),
    DEVICE_APPROVED: t('Device approved'),
    DEVICE_REVOKED: t('Device revoked'),
    DEVICE_DISCONNECTED: t('Device disconnected'),
    DEVICE_RENAMED: t('Device renamed'),
    ENROLLMENT_STARTED: t('Enrollment started'),
    ENROLLMENT_CANCELLED: t('Enrollment cancelled'),
    FACE_ENROLLED: t('Face enrollment confirmed'),
    FACE_REMOVED: t('Face enrollment removed'),
    ALL_FACES_REMOVED: t('All face enrollments removed'),
  };
  return names[action] || action;
}

export function FaceAttendanceScreen() {
  useLocale();
  const { selected, api, reload } = useAuth();
  const base = `/shops/${selected!.shop_id}/face`;
  const resource = useResource<Overview>(base, true);
  const action = useAction();
  const qrAction = useAction();
  const [showQr, setShowQr] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const data = resource.data;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [enrolling, setEnrolling] = useState<Member | null>(null);
  const [informed, setInformed] = useState(false);
  const [search, setSearch] = useState('');
  const [rename, setRename] = useState<Device | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [notice, setNotice] = useState('');
  const stationUrl = `${API_URL || (Platform.OS === 'web' ? window.location.origin : '')}/api/face-station/?shop=${encodeURIComponent(selected!.shop_id)}`;
  const filteredMembers =
    data?.members.filter((member) =>
      member.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) || [];
  const localStation = new URL(stationUrl).protocol !== 'https:';
  const activeDevice = data?.devices.find((device) => device.status === 'ACTIVE');
  const update = (patch: Partial<Overview>) =>
    void action.run(async () => {
      if (!data) return;
      try {
        await api(
          `${base}/settings`,
          {
            revision: data.revision,
            enabled: data.enabled,
            manager_can_enroll_workers: data.manager_can_enroll_workers,
            allow_manager_attendance: data.allow_manager_attendance,
            supervised_use_acknowledged: data.enabled || acknowledged,
            ...patch,
          },
          'PUT',
        );
        await reload();
        setNotice(t('Face settings saved.'));
      } finally {
        await resource.refresh();
      }
    });
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Face attendance')}
        subtitle={t('A dedicated station for your shop’s arrivals and departures.')}
      />
      <ErrorText message={resource.error || action.error} />
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={styles.small}>
          {notice}
        </Text>
      )}
      {resource.loading && <Loading />}
      {data && (
        <>
          <Card>
            <Heading
              title={t('Set up face attendance')}
              subtitle={t('Complete these steps in order to start scanning.')}
            />
            {[
              { title: t('1. Enable supervised face scanning'), done: data.enabled },
              { title: t('2. Connect and approve a shop device'), done: !!activeDevice },
              {
                title: t('3. Enroll your active employees'),
                done:
                  data.members.some((m) => m.active && m.eligible) &&
                  data.members.filter((m) => m.active && m.eligible).every((m) => m.enrolled),
              },
            ].map((step) => (
              <View key={step.title} style={styles.row}>
                <Text style={[styles.small, { flex: 1 }]}>{step.title}</Text>
                <Text style={[styles.small, { color: step.done ? colors.green : colors.muted }]}>
                  {step.done ? t('Ready') : t('Pending')}
                </Text>
              </View>
            ))}
          </Card>
          <Card>
            <Text style={styles.eyebrow}>
              {data.enabled ? t('FACE ATTENDANCE ON') : t('FACE ATTENDANCE OFF')}
            </Text>
            <Text style={styles.small}>
              {t(
                'Use a dedicated camera device with power, internet and this station open. Keep a supervisor nearby: face matching does not detect photo or video impersonation.',
              )}
            </Text>
            <Text style={styles.small}>
              {t(
                'In face mode, employees use the shop station. Only the owner can record manual corrections. Workday tracking rules still apply.',
              )}
            </Text>
            {!data.ready && <ErrorText message={data.problem} />}
            {data.owner && (
              <>
                {!data.enabled && (
                  <Toggle
                    label={t('I understand supervised use is required')}
                    value={acknowledged}
                    onChange={setAcknowledged}
                  />
                )}
                <Toggle
                  label={t('Enable face attendance')}
                  value={data.enabled}
                  disabled={action.busy || (!data.enabled && (!acknowledged || !data.ready))}
                  onChange={(enabled) => update({ enabled })}
                />
                <Toggle
                  label={t('Managers can enroll workers')}
                  detail={t(
                    'Managers cannot enroll themselves or other managers. The owner approves manager enrollment.',
                  )}
                  value={data.manager_can_enroll_workers}
                  disabled={action.busy}
                  onChange={(manager_can_enroll_workers) => update({ manager_can_enroll_workers })}
                />
                <Toggle
                  label={t('Allow manager face attendance')}
                  detail={t('Separate from permission to mark attendance in the main app.')}
                  value={data.allow_manager_attendance}
                  disabled={action.busy}
                  onChange={(allow_manager_attendance) => update({ allow_manager_attendance })}
                />
              </>
            )}
          </Card>
          {data.enabled && (
            <Text style={styles.small}>
              {t(
                'Face attendance is enabled. Use the shop station to scan IN or OUT. Only the owner can make manual corrections.',
              )}
            </Text>
          )}
          {!data.owner && (
            <Card>
              <Text style={styles.heading}>{t('Your manager access')}</Text>
              <Text style={styles.small}>
                {t('The owner manages devices and settings, and enrolls your own face.')}
              </Text>
              <Text style={styles.small}>
                {data.manager_can_enroll_workers
                  ? t('You can enroll workers and confirm the enrollments you start.')
                  : t('Ask the owner to enable worker face enrollment for managers.')}
              </Text>
              <Text style={styles.small}>
                {data.allow_manager_attendance
                  ? t(
                      'You can use the station for your own attendance after the owner enrolls your face.',
                    )
                  : t('Your own face attendance is off. Ask the owner to enable it.')}
              </Text>
            </Card>
          )}
          {confirm && (
            <Modal visible animationType="slide" onRequestClose={() => setConfirm(null)}>
              <Page>
                <Card>
                  <Heading title={confirm.title} subtitle={confirm.detail} />
                  <ErrorText message={action.error} />
                  <Button
                    title={t('Confirm action')}
                    busy={action.busy}
                    onPress={() =>
                      void action.run(async () => {
                        await api(`${base}${confirm.path}`, confirm.body || {}, 'POST');
                        setConfirm(null);
                        setNotice(t('Change saved.'));
                        await resource.refresh();
                      })
                    }
                  />
                  <Button
                    title={t('Cancel')}
                    secondary
                    disabled={action.busy}
                    onPress={() => setConfirm(null)}
                  />
                </Card>
              </Page>
            </Modal>
          )}
          <Card>
            <Heading
              title={t('Attendance device')}
              subtitle={t(
                'One connected device per shop. Revoke it before connecting a replacement.',
              )}
            />
            <Button
              title={showQr ? t('Hide station QR') : t('Show station QR')}
              secondary
              busy={qrAction.busy}
              onPress={() => {
                if (showQr) {
                  setShowQr(false);
                  return;
                }
                void qrAction.run(async () => {
                  if (!qrImage) {
                    const result = await api<{ image: string }>(
                      `${base}/station-qr`,
                      { url: stationUrl },
                      'POST',
                    );
                    setQrImage(result.image);
                  }
                  setShowQr(true);
                });
              }}
            />
            <ErrorText message={qrAction.error} />
            {showQr && qrImage && (
              <View
                style={{ gap: 12, backgroundColor: colors.mint, borderRadius: 18, padding: 14 }}
              >
                <Text style={styles.heading}>{t('Scan to open the station')}</Text>
                <View
                  style={{
                    alignItems: 'center',
                    backgroundColor: colors.white,
                    padding: 10,
                    borderRadius: 12,
                  }}
                >
                  <Image
                    source={{ uri: qrImage }}
                    accessibilityLabel={t('Attendance station QR code')}
                    style={{ width: '100%', maxWidth: 240, aspectRatio: 1 }}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.small}>
                  {t(
                    'Scan with the attendance device’s camera. This opens the station; a new device still needs the owner’s pairing code and approval.',
                  )}
                </Text>
                {localStation && (
                  <Text style={styles.small}>
                    {t(
                      'This is a development address. To use another device’s camera, open Hishob through an HTTPS address that device can reach.',
                    )}
                  </Text>
                )}
                <Text selectable style={styles.small}>
                  {stationUrl}
                </Text>
              </View>
            )}
            <Button
              title={t('Open attendance station')}
              secondary
              onPress={() =>
                void action.run(async () => {
                  await Linking.openURL(stationUrl);
                })
              }
            />
            {data.devices.length === 0 && (
              <Text style={styles.small}>{t('No device connected yet.')}</Text>
            )}
            {data.owner && data.enabled && data.devices.length === 0 && (
              <Button
                title={t('Create pairing code')}
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    setCode(await api(`${base}/pairing`, {}, 'POST'));
                    await resource.refresh();
                  })
                }
              />
            )}
            {code && data.devices.length === 0 && (
              <View style={{ backgroundColor: colors.mint, padding: 18, borderRadius: 16, gap: 8 }}>
                <Text selectable style={[styles.title, { letterSpacing: 3, fontSize: 24 }]}>
                  {new Date(code.expires_at).getTime() > clock ? code.code : t('Code expired')}
                </Text>
                <Text style={styles.small}>
                  {t('Single use. Expires at {0}.', [
                    new Date(code.expires_at).toLocaleTimeString(),
                  ])}
                </Text>
              </View>
            )}
            {data.devices.map((device) => (
              <View key={device.id} style={{ gap: 10 }}>
                <Text style={styles.heading}>{device.name}</Text>
                {device.status === 'PENDING' ? (
                  <>
                    <Text selectable style={styles.heading}>
                      {device.confirmation}
                    </Text>
                    <Text style={styles.small}>
                      {t(
                        'Approve only if this number matches the attendance device in front of you.',
                      )}
                    </Text>
                    {data.owner && (
                      <Button
                        title={t('Approve matching device')}
                        busy={action.busy}
                        onPress={() =>
                          setConfirm({
                            title: t('Approve matching device'),
                            detail: t(
                              'This device will be able to submit face attendance for this shop.',
                            ),
                            path: `/devices/${device.id}/approve`,
                          })
                        }
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.small}>
                      {t('Last connected: {0}', [new Date(device.last_seen).toLocaleString()])}
                    </Text>
                    <Text style={styles.small}>
                      {new Date(device.last_seen).getTime() < clock - 120000
                        ? t('Device has not checked in recently.')
                        : device.camera === 'READY'
                          ? t('Camera ready')
                          : t('Camera not ready. Open the station and allow camera access.')}
                    </Text>
                    {data.owner && (
                      <Button
                        title={t('Rename device')}
                        secondary
                        onPress={() => {
                          setRename(device);
                          setDeviceName(device.name);
                        }}
                      />
                    )}
                  </>
                )}
                {data.owner && (
                  <Button
                    title={t('Revoke device')}
                    secondary
                    onPress={() =>
                      setConfirm({
                        title: t('Revoke device'),
                        detail: t(
                          'This device will immediately lose access. Attendance history will remain.',
                        ),
                        path: `/devices/${device.id}/revoke`,
                      })
                    }
                  />
                )}
              </View>
            ))}
            {rename && (
              <View style={{ gap: 10 }}>
                <Field
                  label={t('Device name')}
                  value={deviceName}
                  onChangeText={setDeviceName}
                  maxLength={60}
                />
                <Button
                  title={t('Save device name')}
                  busy={action.busy}
                  disabled={deviceName.trim().length < 2}
                  onPress={() =>
                    void action.run(async () => {
                      await api(`${base}/devices/${rename.id}`, { name: deviceName }, 'PATCH');
                      setRename(null);
                      await resource.refresh();
                    })
                  }
                />
                <Button title={t('Cancel')} secondary onPress={() => setRename(null)} />
              </View>
            )}
          </Card>
          {data.enrollments.map((grant) => (
            <Card key={grant.id}>
              <Heading
                title={t('Enrollment: {0}', [
                  data.members.find((member) => member.id === grant.member_id)?.name ||
                    t('Team member'),
                ])}
                subtitle={
                  grant.status === 'READY'
                    ? t(
                        'Samples captured. Confirm only if the correct employee was present and informed.',
                      )
                    : t('Waiting for face capture on the attendance device.')
                }
              />
              <Text style={styles.small}>
                {t('Expires at {0}', [new Date(grant.expires_at).toLocaleTimeString()])}
              </Text>
              {grant.status === 'READY' && (
                <Button
                  title={t('Confirm face enrollment')}
                  busy={action.busy}
                  onPress={() =>
                    setConfirm({
                      title: t('Confirm face enrollment'),
                      detail: t(
                        'I verified the employee’s identity during capture. These samples will replace any previous face enrollment.',
                      ),
                      path: `/enrollments/${grant.id}/confirm`,
                    })
                  }
                />
              )}
              <Button
                title={t('Cancel enrollment')}
                secondary
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await api(`${base}/enrollments/${grant.id}/cancel`, {}, 'POST');
                    await resource.refresh();
                  })
                }
              />
            </Card>
          ))}
          {enrolling && (
            <Modal visible animationType="slide" onRequestClose={() => setEnrolling(null)}>
              <Page>
                <Card>
                  <Heading
                    title={t('Enroll {0}', [enrolling.name])}
                    subtitle={t(
                      'Stay with this employee during capture. Enrollment approval expires after five minutes.',
                    )}
                  />
                  <Text style={styles.small}>
                    {t(
                      'Explain that face features are stored securely for attendance, camera images are not retained, and manual attendance is available. The owner can remove the enrollment.',
                    )}
                  </Text>
                  <ErrorText message={action.error} />
                  <Toggle
                    label={t('Employee informed and identity checked')}
                    value={informed}
                    onChange={setInformed}
                  />
                  <Button
                    title={t('Start supervised enrollment')}
                    busy={action.busy}
                    disabled={!informed || !activeDevice || !data.enabled}
                    onPress={() =>
                      void action.run(async () => {
                        await api(
                          `${base}/enrollments`,
                          {
                            member_id: enrolling.id,
                            device_id: activeDevice!.id,
                            employee_informed: true,
                          },
                          'POST',
                        );
                        setEnrolling(null);
                        setInformed(false);
                        await resource.refresh();
                      })
                    }
                  />
                  <Button title={t('Cancel')} secondary onPress={() => setEnrolling(null)} />
                </Card>
              </Page>
            </Modal>
          )}
          <Card>
            <Heading
              title={t('Face enrollments')}
              subtitle={t('{0} of {1} active employees enrolled', [
                data.members.filter((m) => m.active && m.enrolled).length,
                data.members.filter((m) => m.active).length,
              ])}
            />
            <SearchField
              label={t('Search employees')}
              placeholder={t('Search by name')}
              value={search}
              onChange={setSearch}
            />
            {!!search.trim() && filteredMembers.length === 0 && data.members.length > 0 && (
              <Text style={styles.small}>{t('No employees match your search.')}</Text>
            )}
            {filteredMembers.map((member) => (
              <View
                key={member.id}
                style={{
                  gap: 8,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Text style={styles.heading}>{member.name}</Text>
                <Text style={styles.small}>
                  {!member.active
                    ? t('Inactive')
                    : member.enrolled
                      ? t('Face enrolled')
                      : t('Face not enrolled')}
                  {member.active && !member.eligible
                    ? ` · ${t('Manager face attendance is disabled')}`
                    : ''}
                </Text>
                {member.can_enroll && (
                  <Button
                    title={member.enrolled ? t('Replace face enrollment') : t('Enroll face')}
                    secondary
                    disabled={
                      !data.enabled || !activeDevice || !!data.enrollments.length || action.busy
                    }
                    onPress={() => {
                      setEnrolling(member);
                      setInformed(false);
                      setConfirm(null);
                    }}
                  />
                )}
                {data.owner && member.has_template && (
                  <Button
                    title={t('Remove face enrollment')}
                    secondary
                    onPress={() =>
                      setConfirm({
                        title: t('Remove face enrollment'),
                        detail: t(
                          'This employee will need manual attendance until enrolled again. Existing attendance stays unchanged.',
                        ),
                        path: `/members/${member.id}/remove`,
                      })
                    }
                  />
                )}
              </View>
            ))}
            {data.members.length === 0 && (
              <Text style={styles.small}>
                {t('Add employees from Team before enrolling their faces.')}
              </Text>
            )}
            {data.owner && data.members.some((member) => member.has_template) && (
              <Button
                title={t('Remove all face enrollments')}
                secondary
                onPress={() =>
                  setConfirm({
                    title: t('Remove all face enrollments'),
                    detail: t(
                      'All employees will need manual attendance until enrolled again. This removes face templates, not attendance history.',
                    ),
                    path: '/remove-all',
                  })
                }
              />
            )}
          </Card>
          <Card>
            <Heading
              title={t('Recent face activity')}
              subtitle={t(
                'Latest 50 setup events. Face attendance appears in the attendance register.',
              )}
            />
            {data.events.map((event, index) => (
              <View key={`${event.at}-${index}`} style={{ gap: 3 }}>
                <Text style={styles.heading}>{eventName(event.action)}</Text>
                <Text style={styles.small}>
                  {new Date(event.at).toLocaleString()}
                  {event.actor_name ? ` · ${event.actor_name}` : ''}
                  {event.device_name ? ` · ${event.device_name}` : ''}
                  {event.member_id
                    ? ` · ${data.members.find((member) => member.id === event.member_id)?.name || t('Team member')}`
                    : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </Page>
  );
}
