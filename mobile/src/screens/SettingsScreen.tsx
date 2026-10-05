import { t, useLocale, localized } from './../i18n';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUnsavedChanges } from '../pwa';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { Routes, ShopSettings } from '../types';
import { LanguagePicker } from '../components/LanguagePicker';
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

type Icon = React.ComponentProps<typeof Ionicons>['name'];
type PermissionKey = Exclude<
  keyof ShopSettings,
  'attendance_enabled' | 'attendance_mode' | 'hishob_mode'
>;
type Permission = { key: PermissionKey; title: string; label: string; description: string };
const groups: { title: string; icon: Icon; description: string; items: Permission[] }[] = localized(
  () => [
    {
      title: t('Manager · Hishob'),
      icon: 'wallet-outline',
      description: t('Choose how managers help with the cash register.'),
      items: [
        {
          key: 'manager_can_access_hishob',
          title: t('Hishob access'),
          label: t('Managers can access Hishob'),
          description: t(
            'View history, start today, update opening cash and add sales, expenses or customer payments.',
          ),
        },
        {
          key: 'manager_can_close_hishob',
          title: t('Close the day'),
          label: t('Managers can close Hishob'),
          description: t('Count cash and save the daily closing. Requires Hishob access.'),
        },
      ],
    },
    {
      title: t('Attendance access'),
      icon: 'calendar-outline',
      description: t('Set who can record attendance and see their own history.'),
      items: [
        {
          key: 'manager_can_manage_attendance',
          title: t('Manage worker attendance'),
          label: t('Managers can record and correct attendance'),
          description: t(
            'When face attendance is off, managers can record and correct worker attendance.',
          ),
        },
        {
          key: 'manager_can_correct_face_attendance',
          title: t('Manual corrections in face mode'),
          label: t('Managers can correct worker face attendance'),
          description: t(
            'Allow managers to manually record and correct worker attendance when face scans fail. This does not allow corrections for themselves or other managers.',
          ),
        },
        {
          key: 'manager_can_mark_own_attendance',
          title: t('Manager self-attendance'),
          label: t('Managers can mark their own attendance'),
          description: t(
            'When face attendance is off, managers can mark their own arrival and departure. Face mode always requires the shop station.',
          ),
        },
        {
          key: 'workers_can_view_attendance',
          title: t('Worker attendance history'),
          label: t('Workers can view their own attendance'),
          description: t(
            'Workers can view their own records. They cannot mark or edit attendance.',
          ),
        },
      ],
    },
    {
      title: t('Manager · Team'),
      icon: 'people-outline',
      description: t('Delegate everyday worker administration.'),
      items: [
        {
          key: 'manager_can_add_workers',
          title: t('Add workers'),
          label: t('Managers can add workers'),
          description: t('Add a worker using their name and mobile number.'),
        },
        {
          key: 'manager_can_edit_workers',
          title: t('Edit worker profiles'),
          label: t('Managers can edit and deactivate workers'),
          description: t(
            'Change worker details, including mobile numbers, and deactivate or reactivate workers.',
          ),
        },
        {
          key: 'manager_can_reset_worker_passwords',
          title: t('Worker password resets'),
          label: t('Managers can approve worker password resets'),
          description: t('Approve reset requests and share one-time setup codes for workers.'),
        },
      ],
    },
  ],
);

function SectionHeading({
  title,
  icon,
  description,
}: {
  title: string;
  icon: Icon;
  description?: string;
}) {
  useLocale();
  return (
    <View style={local.sectionHeading}>
      <View style={local.sectionIcon}>
        <Ionicons name={icon} size={20} color={colors.green} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.heading}>{title}</Text>
        {description && <Text style={styles.small}>{description}</Text>}
      </View>
    </View>
  );
}

function Choice({
  title,
  description,
  icon,
  selected,
  label = title,
  disabled,
  onPress,
}: {
  title: string;
  description: string;
  icon: Icon;
  selected: boolean;
  label?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  useLocale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        local.choice,
        selected && local.selectedChoice,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={21} color={colors.green} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={local.optionTitle}>{title}</Text>
        <Text style={styles.small}>{description}</Text>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={21}
        color={selected ? colors.green : colors.muted}
      />
    </Pressable>
  );
}

function SettingsForm({ initial }: { initial: ShopSettings }) {
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  useLocale();
  const { selected, api, reload } = useAuth();
  const defaults = { ...initial, attendance_enabled: initial.attendance_enabled ?? true };
  const [settings, setSettings] = useState(defaults);
  const face = useResource<{
    enabled: boolean;
    revision: number;
    manager_can_enroll_workers: boolean;
    allow_manager_attendance: boolean;
  }>(`/shops/${selected!.shop_id}/face`, true);
  const [name, setName] = useState(selected!.shop.name);
  const [language, setLanguage] = useState(selected!.shop.language || 'en');
  const [baseline, setBaseline] = useState({
    settings: defaults,
    name: selected!.shop.name,
    language,
  });
  const [saved, setSaved] = useState(false);
  const dirty =
    language !== baseline.language ||
    name.trim() !== baseline.name ||
    JSON.stringify(settings) !== JSON.stringify(baseline.settings);
  const validName = name.trim().length >= 2 && name.trim().length <= 100;
  useUnsavedChanges(dirty);
  const action = useAction();
  const change = (patch: Partial<ShopSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  return (
    <View style={{ flex: 1 }}>
      <Page>
        <Heading
          title={t('Shop settings')}
          subtitle={t('Your shop, daily routines and team access.')}
        />
        <Card>
          <SectionHeading title={t('Shop details')} icon="storefront-outline" />
          <Field
            label={t('Shop name')}
            required
            minLength={2}
            maxLength={100}
            value={name}
            editable={!action.busy}
            onChangeText={(value) => {
              setName(value);
              setSaved(false);
            }}
            placeholder={t('e.g. Market Road Store')}
          />
          <LanguagePicker
            label={t('Shop default language')}
            value={language}
            onChange={(value) => {
              setLanguage(value || 'en');
              setSaved(false);
            }}
          />
          <View style={local.infoRow}>
            <Ionicons name="time-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={local.optionTitle}>{t('Business timezone')}</Text>
              <Text style={styles.small}>{selected!.shop.timezone}</Text>
            </View>
          </View>
          <Text style={styles.small}>
            {' '}
            {t(
              'Attendance and Hishob dates follow this timezone, set when the shop was created.',
            )}{' '}
          </Text>
        </Card>
        <Card>
          <SectionHeading
            title={t('Sales method')}
            icon="calculator-outline"
            description={t('Choose how you work out each day’s sales.')}
          />
          {(
            [
              {
                value: 'ENTRIES',
                title: t('Enter sales'),
                icon: 'receipt-outline',
                description: t(
                  'Record individual sales or totals by payment type. Compare expected cash with your closing count.',
                ),
              },
              {
                value: 'COUNTED',
                title: t('Count cash'),
                icon: 'cash-outline',
                description: t(
                  'Record expenses, then count cash to estimate sales. Cash shortages cannot be measured independently.',
                ),
              },
              {
                value: 'BILLING',
                title: t('Use billing totals'),
                icon: 'print-outline',
                description: t(
                  'Enter your billing total at closing. Add payment totals when available to check the cash difference.',
                ),
              },
            ] as const
          ).map((option) => (
            <Choice
              key={option.value}
              {...option}
              label={t('Hishob method: {0}', [option.title])}
              selected={settings.hishob_mode === option.value}
              disabled={action.busy}
              onPress={() => change({ hishob_mode: option.value })}
            />
          ))}
          <Text style={styles.small}>
            {' '}
            {t('Applies to newly started Hishob days. Existing days keep their saved method.')}{' '}
          </Text>
        </Card>
        <Card>
          <SectionHeading
            title={t('Attendance')}
            icon="checkmark-done-outline"
            description={t('Keep attendance as simple as your shop needs.')}
          />
          <View style={local.permission}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={local.optionTitle}>{t('Enable attendance')}</Text>
              <Text style={styles.small}>
                {t(
                  'Turn off attendance across this shop. Existing records and face enrollments are preserved.',
                )}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t('Enable attendance')}
              value={settings.attendance_enabled}
              disabled={action.busy}
              onValueChange={(attendance_enabled) => change({ attendance_enabled })}
              trackColor={{ false: '#D4DCD5', true: colors.green }}
            />
          </View>
          {settings.attendance_enabled && (
            <>
              <Text style={styles.heading}>{t('Attendance method')}</Text>
              <ErrorText message={face.error} />
              <Choice
                title={t('Manual attendance')}
                icon="create-outline"
                description={t(
                  'Owner or permitted managers record attendance in the app. Switching methods takes effect immediately.',
                )}
                selected={!!face.data && !face.data.enabled}
                disabled={dirty || action.busy || !face.data}
                onPress={() =>
                  void action.run(async () => {
                    if (!face.data || !face.data.enabled) return;
                    await api(
                      `/shops/${selected!.shop_id}/face/settings`,
                      {
                        revision: face.data.revision,
                        manager_can_enroll_workers: face.data.manager_can_enroll_workers,
                        allow_manager_attendance: face.data.allow_manager_attendance,
                        enabled: false,
                        supervised_use_acknowledged: true,
                      },
                      'PUT',
                    );
                    await face.refresh();
                    await reload();
                  })
                }
              />
              <Choice
                title={t('Face scan')}
                icon="scan-outline"
                description={t(
                  'Employees scan at an approved shop station. Open setup to enable scanning, connect a device and enroll your team.',
                )}
                selected={!!face.data?.enabled}
                disabled={dirty || action.busy || !face.data}
                onPress={() => navigation.navigate('FaceAttendance')}
              />
              {dirty && (
                <Text style={styles.small}>
                  {t('Save or discard changes before opening face attendance.')}
                </Text>
              )}
              <Text style={styles.heading}>{t('Workday tracking')}</Text>
              <Choice
                title={t('Check-in only')}
                icon="log-in-outline"
                description={t('Record arrival once. Best for a simple daily register.')}
                selected={settings.attendance_mode === 'CHECK_IN_ONLY'}
                disabled={action.busy}
                onPress={() => change({ attendance_mode: 'CHECK_IN_ONLY' })}
              />
              <Choice
                title={t('Check-in and check-out')}
                icon="swap-horizontal-outline"
                description={t('Record both arrival and departure.')}
                selected={settings.attendance_mode === 'CHECK_IN_OUT'}
                disabled={action.busy}
                onPress={() => change({ attendance_mode: 'CHECK_IN_OUT' })}
              />
              <Text style={styles.small}>
                {' '}
                {t('Existing open shifts can still be closed after changing this setting.')}{' '}
              </Text>
            </>
          )}
        </Card>
        <View style={{ gap: 5 }}>
          <Text style={styles.heading}>{t('Team permissions')}</Text>
          <Text style={styles.small}>
            {' '}
            {t('Applies to this shop only. Changes take effect after saving.')}{' '}
          </Text>
        </View>
        {groups
          .filter((group) => settings.attendance_enabled || group.icon !== 'calendar-outline')
          .map((group) => (
            <Card key={group.title}>
              <SectionHeading
                title={group.title}
                icon={group.icon}
                description={group.description}
              />
              {group.items.map((item) => {
                const needsAccess =
                  item.key === 'manager_can_close_hishob' && !settings.manager_can_access_hishob;
                return (
                  <View key={item.key} style={local.permission}>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={local.optionTitle}>{item.title}</Text>
                      <Text style={styles.small}>
                        {needsAccess
                          ? t('Enable Hishob access above to allow managers to close a day.')
                          : item.description}
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel={item.label}
                      disabled={action.busy || needsAccess}
                      value={!needsAccess && settings[item.key]}
                      onValueChange={(value) => change({ [item.key]: value })}
                      trackColor={{ false: '#D4DCD5', true: colors.green }}
                    />
                  </View>
                );
              })}
            </Card>
          ))}
        <View style={local.ownerNote}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.green} />
          <Text style={[styles.small, { flex: 1 }]}>
            {' '}
            {t(
              'Only the owner can change settings, manage managers, open missed Hishob days, reopen closed days, or correct and delete financial entries.',
            )}{' '}
          </Text>
        </View>
      </Page>
      <View style={local.footer}>
        <View style={local.footerContent}>
          <ErrorText message={action.error} />
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.small, saved && !dirty && { color: colors.green }]}
          >
            {dirty
              ? t('You have unsaved changes.')
              : saved
                ? t('Shop settings saved.')
                : t('All changes saved.')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {dirty && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Discard changes')}
                disabled={action.busy}
                onPress={() => {
                  setSettings(baseline.settings);
                  setName(baseline.name);
                  setLanguage(baseline.language);
                  setSaved(false);
                }}
                style={local.discard}
              >
                <Text style={local.optionTitle}>{t('Discard')}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Save shop settings')}
              accessibilityState={{
                disabled: !dirty || !validName || action.busy,
                busy: action.busy,
              }}
              disabled={!dirty || !validName || action.busy}
              style={({ pressed }) => [
                local.save,
                { opacity: !dirty || !validName || action.busy ? 0.5 : pressed ? 0.75 : 1 },
              ]}
              onPress={() =>
                void action.run(async () => {
                  const submitted = { settings, name: name.trim(), language };
                  const result = await api<ShopSettings>(
                    `/shops/${selected!.shop_id}/settings`,
                    {
                      ...submitted.settings,
                      shop_name: submitted.name,
                      language: submitted.language,
                    },
                    'PUT',
                  );
                  setSettings(result);
                  setName(submitted.name);
                  setBaseline({
                    settings: result,
                    name: submitted.name,
                    language: submitted.language,
                  });
                  setSaved(true);
                  await reload();
                })
              }
            >
              {action.busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Ionicons name="checkmark-outline" size={19} color={colors.white} />
              )}
              <Text style={local.saveLabel}>{action.busy ? t('Saving…') : t('Save changes')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

export function ShopSettingsScreen() {
  useLocale();
  const { selected } = useAuth();
  const resource = useResource<ShopSettings>(`/shops/${selected!.shop_id}/settings`);
  if (!selected!.permissions.manage_settings)
    return (
      <Page>
        <Heading title={t('Owner access required')} />
      </Page>
    );
  if (resource.data) return <SettingsForm key={selected!.shop_id} initial={resource.data} />;
  return (
    <Page>
      <Heading title={t('Shop settings')} subtitle={selected!.shop.name} />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {!!resource.error && (
        <Button title={t('Retry settings')} secondary onPress={() => void resource.refresh()} />
      )}
    </Page>
  );
}

const local = StyleSheet.create({
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: '#F5F7F2',
    borderRadius: 12,
    padding: 12,
  },
  choice: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    minHeight: 60,
  },
  selectedChoice: { borderColor: colors.green, backgroundColor: colors.mint },
  permission: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  ownerNote: { flexDirection: 'row', gap: 10, padding: 4 },
  footer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line },
  footerContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  save: {
    flex: 1,
    minHeight: 48,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.green,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: { color: colors.white, fontSize: 15, fontWeight: '700' },
  discard: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
});
