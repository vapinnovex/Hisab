import { t, useLocale } from './../i18n';
import { phoneError } from '../phone';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InstallHelp, useUnsavedChanges } from '../pwa';
import { useAuth } from '../auth';
import {
  Avatar,
  Button,
  Card,
  colors,
  ErrorText,
  Field,
  Heading,
  Page,
  styles,
} from '../components/ui';
import { BrandMark } from '../components/Brand';
import { PasswordField } from '../components/PasswordFields';
import { PhoneField } from '../components/PhoneField';
import { LanguagePicker } from '../components/LanguagePicker';
import { useAction } from '../hooks';
import { Challenge, Language, Routes } from '../types';

function AccountLink({
  title,
  detail,
  icon,
  onPress,
}: {
  title: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  useLocale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        paddingVertical: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ backgroundColor: colors.mint, padding: 10, borderRadius: 13 }}>
        <Ionicons name={icon} color={colors.green} size={21} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.heading, { fontSize: 15 }]}>{title}</Text>
        <Text style={[styles.small, { fontSize: 12 }]}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" color={colors.muted} size={17} />
    </Pressable>
  );
}

export function Profile() {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { session, selected, signOut, reload } = useAuth();
  const action = useAction();
  const owner = session!.role === 'OWNER';
  const name = owner
    ? session!.user.name || t('Welcome, shop owner')
    : selected?.worker_name || t('Team member');
  return (
    <Page refresh={reload}>
      <Heading
        title={t('Your account')}
        subtitle={t('A little about you. Everything for your shop.')}
      />
      <View style={{ backgroundColor: colors.green, borderRadius: 26, padding: 22, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar
            name={owner && !session!.user.name ? t('Shop owner') : name}
            manager={session!.role !== 'WORKER'}
          />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 23 }}>{name}</Text>
            <Text style={{ color: '#D5E5D9', fontSize: 12 }}>
              {owner ? t('Shop owner') : session!.role === 'MANAGER' ? t('Manager') : t('Worker')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" color="#F4CD72" size={18} />
          <Text style={{ color: '#EDF5EE', fontSize: 15 }}>{session!.user.mobile}</Text>
        </View>
      </View>
      {owner && (
        <>
          <Text style={styles.eyebrow}>{t('PERSONAL DETAILS')}</Text>
          <Card>
            <AccountLink
              title={session!.user.name ? t('Edit your name') : t('Add your name')}
              detail={t('How you’ll appear in Hishob')}
              icon="person-outline"
              onPress={() => navigation.navigate('OwnerProfile')}
            />
            <AccountLink
              title={t('Change mobile number')}
              detail={t('Confirm with your password and recovery email')}
              icon="call-outline"
              onPress={() => navigation.navigate('ChangeMobile')}
            />
            <AccountLink
              title={t('Change recovery email')}
              detail={session!.user.email || t('Verify a new recovery email')}
              icon="mail-outline"
              onPress={() => navigation.navigate('ChangeEmail')}
            />
          </Card>
        </>
      )}
      <Card>
        <AccountLink
          title={t('Language')}
          detail={t('Choose English, हिंदी or मराठी for your personal login')}
          icon="language-outline"
          onPress={() => navigation.navigate('LanguageSettings')}
        />
        <AccountLink
          title={t('Password & security')}
          detail={t('Change your password and review recovery details')}
          icon="lock-closed-outline"
          onPress={() => navigation.navigate('PasswordSecurity')}
        />
      </Card>
      <Card>
        <AccountLink
          title={t('Help & support')}
          detail={t('Contact Hishob support')}
          icon="help-circle-outline"
          onPress={() => navigation.navigate('Support')}
        />
      </Card>
      <Text style={styles.eyebrow}>{t('CURRENT SHOP')}</Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Ionicons name="storefront-outline" size={24} color={colors.green} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{selected?.shop.name}</Text>
            <Text style={styles.small}>{selected?.shop.timezone}</Text>
          </View>
        </View>
        {session!.role === 'MANAGER' && selected!.permissions.view_own_attendance && (
          <AccountLink
            title={t('My attendance')}
            detail={t('Your workday and monthly attendance')}
            icon="checkmark-circle-outline"
            onPress={() => navigation.navigate('MyAttendance')}
          />
        )}
        {session!.role !== 'WORKER' && selected!.shop.settings.attendance_enabled && (
          <AccountLink
            title={t('Face attendance')}
            detail={t('Devices, enrollment and face attendance access')}
            icon="scan-outline"
            onPress={() => navigation.navigate('FaceAttendance')}
          />
        )}
        {selected!.permissions.view_hishob && (
          <AccountLink
            title={t('Hishob history')}
            detail={t('Daily cash records and preserved closings')}
            icon="wallet-outline"
            onPress={() =>
              navigation.navigate('Hishob', { screen: 'HishobHistory', initial: false })
            }
          />
        )}
        {owner && (
          <>
            <AccountLink
              title={t('Shop settings')}
              detail={t('Attendance rules and team permissions')}
              icon="options-outline"
              onPress={() => navigation.navigate('ShopSettings')}
            />
            <AccountLink
              title={t('Manage managers')}
              detail={t('The people you trust to run the day')}
              icon="briefcase-outline"
              onPress={() => navigation.navigate('Managers')}
            />
            <AccountLink
              title={t('Create another shop')}
              detail={t('One account, all your shops')}
              icon="add-circle-outline"
              onPress={() => navigation.navigate('ShopSetup')}
            />
          </>
        )}
      </Card>
      {session!.role === 'MANAGER' && selected!.permissions.view_own_attendance && (
        <Card>
          <Text style={styles.heading}>{t('Your permissions')}</Text>
          {[
            [t('Record worker attendance'), selected!.permissions.manage_attendance],
            [t('Mark my own attendance'), selected!.permissions.mark_own_attendance],
            [t('Add workers'), selected!.permissions.add_workers],
            [t('Edit workers'), selected!.permissions.edit_workers],
          ].map(([label, allowed]) => (
            <View style={styles.row} key={String(label)}>
              <Text style={[styles.small, { flex: 1 }]}>{label}</Text>
              <Text
                style={{
                  color: allowed ? colors.green : colors.muted,
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                {allowed ? t('Enabled') : t('Owner only')}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {!owner && (
        <Text style={styles.small}>
          {' '}
          {t(
            'Your shop owner manages your name and mobile number. Ask them if your details need updating.',
          )}{' '}
        </Text>
      )}
      <ErrorText message={action.error} />
      <InstallHelp />
      <Button
        title={t('Sign out')}
        secondary
        busy={action.busy}
        onPress={() => void action.run(signOut)}
      />
      <View style={{ alignItems: 'center', paddingVertical: 12, gap: 4 }}>
        <BrandMark size={40} />
        <Text style={[styles.small, { fontSize: 11 }]}>
          {t('Made for the people behind the shop.')}
        </Text>
      </View>
    </Page>
  );
}

export function OwnerProfile({ navigation }: NativeStackScreenProps<Routes, 'OwnerProfile'>) {
  useLocale();
  const { session, api, reload } = useAuth();
  const [name, setName] = useState(session!.user.name || '');
  useUnsavedChanges(name !== (session!.user.name || ''));
  const action = useAction();
  return (
    <Page>
      <Heading
        title={t('What should we call you?')}
        subtitle={t('Your name makes Hishob feel a little more yours.')}
      />
      <Card>
        <Field
          required
          minLength={2}
          label={t('Your name')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          placeholder={t('e.g. Prajwal Patil')}
          maxLength={100}
        />
        <Text style={styles.small}>
          {' '}
          {t('This name belongs to your account and is used across your shops.')}{' '}
        </Text>
      </Card>
      <ErrorText message={action.error} />
      <Button
        title={t('Save name')}
        busy={action.busy}
        disabled={name.trim().length < 2}
        onPress={() =>
          void action.run(async () => {
            await api('/auth/profile', { name }, 'PATCH');
            await reload();
            navigation.goBack();
          })
        }
      />
    </Page>
  );
}

export function ChangeMobile({ navigation }: NativeStackScreenProps<Routes, 'ChangeMobile'>) {
  useLocale();
  const { session, api, signIn } = useAuth();
  const [mobile, setMobile] = useState('+91');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const action = useAction();
  return (
    <Page>
      <Heading
        title={done ? t('Your number is updated') : t('A new number. Same shop.')}
        subtitle={
          done
            ? t('Your shops, people and attendance are all right here.')
            : t('Confirm your password, then verify the code sent to your recovery email.')
        }
      />
      <Card>
        <Text style={styles.small}>{t('Current login number')}</Text>
        <Text style={styles.heading}>{session!.user.mobile}</Text>
      </Card>
      {!done &&
        (!challenge ? (
          <>
            <PhoneField label={t('New mobile number')} value={mobile} onChange={setMobile} />
            <PasswordField label={t('Current password')} value={password} onChange={setPassword} />
            <Text style={styles.small}>
              {' '}
              {t(
                'This changes your login number. It does not verify ownership of the new phone number. Check it carefully.',
              )}{' '}
            </Text>
            <Button
              title={t('Send confirmation email')}
              busy={action.busy}
              disabled={!!phoneError(mobile) || !password}
              onPress={() =>
                void action.run(async () => {
                  setChallenge(
                    await api<Challenge>(
                      '/auth/mobile-change/request',
                      { mobile, password, role: 'OWNER' },
                      'POST',
                    ),
                  );
                  setPassword('');
                })
              }
            />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {t('Check')} {session!.user.email}
            </Text>
            {challenge.dev_otp && (
              <Text style={styles.small}>
                {t('Development email code:')} {challenge.dev_otp}
              </Text>
            )}
            <Field
              required
              minLength={6}
              label={t('Email code')}
              value={code}
              onChangeText={setCode}
              maxLength={6}
              keyboardType="number-pad"
            />
            <Button
              title={t('Confirm mobile change')}
              busy={action.busy}
              disabled={code.length !== 6}
              onPress={() =>
                void action.run(async () => {
                  const result = await api<{ access_token?: string }>(
                    '/auth/mobile-change/confirm',
                    { challenge_id: challenge.challenge_id, code },
                    'POST',
                  );
                  await signIn(result.access_token);
                  setDone(true);
                })
              }
            />
            <Button
              title={t('Start again')}
              secondary
              onPress={() => {
                setChallenge(null);
                setCode('');
              }}
            />
          </>
        ))}
      {done && (
        <>
          <Text style={styles.subtitle}>
            {' '}
            {t(
              'Use this number next time you log in. Other signed-in sessions have been signed out.',
            )}{' '}
          </Text>
          <Button title={t('Back to account')} onPress={() => navigation.goBack()} />
        </>
      )}
      <ErrorText message={action.error} />
    </Page>
  );
}

export function ChangeEmail({ navigation }: NativeStackScreenProps<Routes, 'ChangeEmail'>) {
  useLocale();
  const { session, api, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const action = useAction();
  return (
    <Page>
      <Heading
        title={done ? t('Recovery email updated') : t('Use a new recovery email')}
        subtitle={
          done
            ? t('Your new email is ready for password recovery and account confirmation.')
            : t('Confirm your password, then verify a code sent to the new email address.')
        }
      />
      <Card>
        <Text style={styles.small}>{t('Current recovery email')}</Text>
        <Text style={styles.heading}>{session!.user.email || t('Not set')}</Text>
      </Card>
      {!done &&
        (!challenge ? (
          <>
            <Field
              required
              label={t('New recovery email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            <PasswordField label={t('Current password')} value={password} onChange={setPassword} />
            <Text style={styles.small}>
              {' '}
              {t(
                'The confirmation code is sent to this new address. It becomes your password-recovery email after verification.',
              )}{' '}
            </Text>
            <Button
              title={t('Send verification email')}
              busy={action.busy}
              disabled={!email.includes('@') || !password}
              onPress={() =>
                void action.run(async () => {
                  setChallenge(
                    await api<Challenge>(
                      '/auth/email-change/request',
                      { email, current_password: password },
                      'POST',
                    ),
                  );
                  setPassword('');
                })
              }
            />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {t('Check')} {email.trim().toLowerCase()}
            </Text>
            {challenge.dev_otp && (
              <Text style={styles.small}>
                {t('Development email code:')} {challenge.dev_otp}
              </Text>
            )}
            <Field
              required
              minLength={6}
              label={t('Email code')}
              value={code}
              onChangeText={setCode}
              maxLength={6}
              keyboardType="number-pad"
            />
            <Button
              title={t('Confirm email change')}
              busy={action.busy}
              disabled={code.length !== 6}
              onPress={() =>
                void action.run(async () => {
                  const result = await api<{ access_token?: string }>(
                    '/auth/email-change/confirm',
                    { challenge_id: challenge.challenge_id, code },
                    'POST',
                  );
                  await signIn(result.access_token);
                  setDone(true);
                })
              }
            />
            <Button
              title={t('Start again')}
              secondary
              onPress={() => {
                setChallenge(null);
                setCode('');
              }}
            />
          </>
        ))}
      {done && <Button title={t('Back to account')} onPress={() => navigation.goBack()} />}
      <ErrorText message={action.error} />
    </Page>
  );
}

export function LanguageSettings({
  navigation,
}: NativeStackScreenProps<Routes, 'LanguageSettings'>) {
  useLocale();
  const { session, selected, api, reload } = useAuth();
  const [language, setLanguage] = useState<Language | null>(session!.user.language || null);
  const action = useAction();
  const defaultLanguage = selected?.shop.language || 'en';
  return (
    <Page>
      <Heading
        title={t('Language')}
        subtitle={t('Your choice overrides this shop’s default language.')}
      />
      <Card>
        <LanguagePicker
          value={language}
          onChange={setLanguage}
          allowDefault
          label={t('Personal language')}
          defaultLanguage={defaultLanguage}
          uiLanguage={session!.user.language || defaultLanguage}
        />
      </Card>
      <ErrorText message={action.error} />
      <Button
        title={t('Save language')}
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            await api('/auth/language', { language }, 'PATCH');
            await reload();
            navigation.goBack();
          })
        }
      />
    </Page>
  );
}
