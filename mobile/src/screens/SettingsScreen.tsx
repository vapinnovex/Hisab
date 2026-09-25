import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useUnsavedChanges } from '../pwa';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { ShopSettings } from '../types';
import { Button, Card, colors, ErrorText, Heading, Loading, Page, styles } from '../components/ui';

function SettingsForm({ initial }: { initial: ShopSettings }) {
  const { selected, api, reload } = useAuth();
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(false);
  useUnsavedChanges(!saved && JSON.stringify(settings) !== JSON.stringify(initial));
  const action = useAction();
  const change = (patch: Partial<ShopSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const toggles: {
    key: Exclude<keyof ShopSettings, 'attendance_mode'>;
    title: string;
    description: string;
  }[] = [
    {
      key: 'manager_can_access_hishob',
      title: 'Managers can access Hishob',
      description:
        'Allow viewing cash history, opening a day, updating opening cash with a reason, and adding transactions. Corrections and deletions stay owner-only.',
    },
    {
      key: 'manager_can_close_hishob',
      title: 'Managers can close Hishob',
      description:
        'Allow daily closing when Hishob access is also enabled. Only the owner can reopen a closed day.',
    },
    {
      key: 'manager_can_mark_own_attendance',
      title: 'Managers can mark their own attendance',
      description:
        'Allow managers to record their own arrival and departure. Only the owner can correct their past attendance.',
    },
    {
      key: 'manager_can_manage_attendance',
      title: 'Managers can record and correct attendance',
      description: 'Check workers in/out and correct present, half-day, absent or leave entries.',
    },
    {
      key: 'manager_can_add_workers',
      title: 'Managers can add workers',
      description: 'Let managers onboard new workers using a name and mobile number.',
    },
    {
      key: 'manager_can_edit_workers',
      title: 'Managers can edit and deactivate workers',
      description: 'Includes changing mobile numbers and reactivating existing workers.',
    },
    {
      key: 'workers_can_view_attendance',
      title: 'Workers can view their own attendance',
      description:
        'Workers can only read their own records. They can never mark or edit attendance.',
    },
  ];
  return (
    <>
      <Card>
        <Text style={styles.heading}>How do you record a workday?</Text>
        <Button
          title="Check-in only"
          secondary={settings.attendance_mode !== 'CHECK_IN_ONLY'}
          onPress={() => change({ attendance_mode: 'CHECK_IN_ONLY' })}
        />
        <Text style={styles.small}>
          Recommended for a simple daily register. Mark arrival once; no check-out to chase.
        </Text>
        <Button
          title="Check-in and check-out"
          secondary={settings.attendance_mode !== 'CHECK_IN_OUT'}
          onPress={() => change({ attendance_mode: 'CHECK_IN_OUT' })}
        />
        <Text style={styles.small}>
          Record arrival and departure. Existing open shifts can still be closed after changing this
          setting.
        </Text>
      </Card>
      <Text style={styles.heading}>Who can do what?</Text>
      {toggles.map((item) => (
        <Card key={item.key}>
          <View style={styles.row}>
            <Text style={[styles.heading, { flex: 1 }]}>{item.title}</Text>
            <Switch
              accessibilityLabel={item.title}
              value={settings[item.key]}
              onValueChange={(value) => change({ [item.key]: value })}
              trackColor={{ true: colors.green }}
            />
          </View>
          <Text style={styles.small}>{item.description}</Text>
        </Card>
      ))}
      <Text style={styles.small}>
        These permissions apply only to {selected!.shop.name}. Only you can change settings or
        appoint managers.
      </Text>
      <ErrorText message={action.error} />
      {saved && (
        <Text accessibilityRole="alert" style={styles.subtitle}>
          Shop settings saved.
        </Text>
      )}
      <Button
        title="Save shop settings"
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            await api(`/shops/${selected!.shop_id}/settings`, settings, 'PUT');
            await reload();
            setSaved(true);
          })
        }
      />
    </>
  );
}
export function ShopSettingsScreen() {
  const { selected } = useAuth();
  const resource = useResource<ShopSettings>(`/shops/${selected!.shop_id}/settings`);
  if (!selected!.permissions.manage_settings)
    return (
      <Page>
        <Heading title="Owner access required" />
      </Page>
    );
  return (
    <Page>
      <Heading title="Shop settings" subtitle={selected!.shop.name} />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && <SettingsForm initial={resource.data} />}
    </Page>
  );
}
