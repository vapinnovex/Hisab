import { t, useLocale, getLanguage, roleLabel, setLanguage as setAppLanguage } from './../i18n';
import { phoneError } from '../phone';
import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { request } from '../api';
import { useAuth } from '../auth';
import { Button, Card, colors, ErrorText, Field, Heading, Page, styles } from '../components/ui';
import { useAction } from '../hooks';
import { Challenge, Routes, Role } from '../types';
import { logo } from '../components/Brand';
import { NewPasswordFields, PasswordField, passwordsMatch } from '../components/PasswordFields';
import { PhoneField } from '../components/PhoneField';
import { LanguagePicker } from '../components/LanguagePicker';

export function RoleSelection({ navigation }: NativeStackScreenProps<Routes, 'RoleSelection'>) {
  useLocale();
  const roles: {
    role: Role;
    title: string;
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      role: 'OWNER',
      title: t('Owner'),
      detail: t('Your shop. Your team. Your way.'),
      icon: 'storefront-outline',
    },
    {
      role: 'MANAGER',
      title: t('Manager'),
      detail: t('Keep the team and the day on track.'),
      icon: 'briefcase-outline',
    },
    {
      role: 'WORKER',
      title: t('Worker'),
      detail: t('Every workday, clearly in view.'),
      icon: 'person-outline',
    },
  ];
  return (
    <Page topInset>
      <LanguagePicker value={getLanguage()} onChange={(value) => value && setAppLanguage(value)} />
      <View style={{ alignItems: 'center', gap: 9, paddingTop: 10, paddingBottom: 12 }}>
        <Image
          source={logo}
          accessibilityLabel={t('Hishob logo')}
          resizeMode="contain"
          style={{ width: 152, height: 152 }}
        />
        <Text style={{ fontSize: 39, fontWeight: '800', color: colors.ink, letterSpacing: -1.5 }}>
          {' '}
          {t('Hishob')}
          <Text style={{ color: colors.gold }}>.</Text>
        </Text>
        <Text style={[styles.eyebrow, { fontSize: 10, letterSpacing: 2.3 }]}>
          {' '}
          {t('SMALL SHOP. BIG POSSIBILITIES.')}{' '}
        </Text>
      </View>
      <Heading
        title={t('Good days start together.')}
        subtitle={t('A simpler way to look after your shop and the people who make it happen.')}
      />
      <Text style={styles.label}>{t('HOW WILL YOU USE HISHOB?')}</Text>
      {roles.map((item) => (
        <Pressable
          key={item.role}
          accessibilityRole="button"
          accessibilityLabel={t('Continue as {0}', [item.title])}
          onPress={() => navigation.navigate('MobileLogin', { role: item.role })}
          style={({ pressed }) => ({
            padding: 18,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: item.role === 'OWNER' ? colors.green : colors.line,
            backgroundColor: item.role === 'OWNER' ? colors.green : colors.white,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: item.role === 'OWNER' ? '#347860' : colors.mint,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons
              name={item.icon}
              size={23}
              color={item.role === 'OWNER' ? '#FFF4D6' : colors.green}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              style={{
                fontSize: 17,
                fontWeight: '700',
                color: item.role === 'OWNER' ? 'white' : colors.ink,
              }}
            >
              {' '}
              {t('Continue as')} {item.title}
            </Text>
            <Text
              style={{
                fontSize: 11,
                lineHeight: 17,
                color: item.role === 'OWNER' ? '#DFE9DF' : colors.muted,
              }}
            >
              {item.detail}
            </Text>
          </View>
          <Ionicons
            name="arrow-forward"
            size={19}
            color={item.role === 'OWNER' ? '#F4C56A' : colors.green}
          />
        </Pressable>
      ))}
      <Text style={[styles.small, { textAlign: 'center', fontSize: 11 }]}>
        {' '}
        {t('One mobile number. Your place in the team.')}{' '}
      </Text>
    </Page>
  );
}

type Step =
  | 'NUMBER'
  | 'PASSWORD'
  | 'REGISTER'
  | 'REGISTER_CONFIRM'
  | 'RECOVERY'
  | 'RECOVERY_CONFIRM'
  | 'SETUP'
  | 'OWNER_MIGRATION';
export function MobileLogin({ route }: NativeStackScreenProps<Routes, 'MobileLogin'>) {
  useLocale();
  const { role } = route.params;
  const { signIn } = useAuth();
  const [mobile, setMobile] = useState('+91');
  const [step, setStep] = useState<Step>('NUMBER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const language = getLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState('');
  const action = useAction();
  const post = <T,>(path: string, body: unknown) => request<T>(path, null, body, 'POST');
  const go = (next: Step) => {
    setStep(next);
    setPassword('');
    setConfirm('');
    setCode('');
    setMessage('');
  };
  const finish = async (path: string, body: unknown) => {
    const result = await post<{ access_token?: string }>(path, body);
    await signIn(result.access_token);
  };
  const sendEmail = async () => {
    const registration = step === 'REGISTER';
    const next = await post<Challenge>(
      `/auth/owner/${registration ? 'register' : 'recovery'}/request`,
      registration ? { mobile, role, name, email, language } : { email },
    );
    setChallenge(next);
    go(registration ? 'REGISTER_CONFIRM' : 'RECOVERY_CONFIRM');
  };
  const emailConfirm = step === 'REGISTER_CONFIRM' || step === 'RECOVERY_CONFIRM';
  return (
    <Page>
      <Text style={styles.eyebrow}>{t('{0} account', [roleLabel(role)])}</Text>
      <Heading
        title={
          step === 'NUMBER'
            ? t('Welcome to Hishob')
            : step === 'PASSWORD'
              ? t('Welcome back')
              : step === 'REGISTER'
                ? t('Create your owner account')
                : step === 'RECOVERY'
                  ? t('Recover your account')
                  : step === 'SETUP'
                    ? t('Set your password')
                    : step === 'OWNER_MIGRATION'
                      ? t('Secure your existing account')
                      : t('Check your email')
        }
        subtitle={
          step === 'NUMBER'
            ? t('Use your mobile number to continue.')
            : step === 'PASSWORD' || step === 'SETUP'
              ? mobile
              : emailConfirm
                ? t('Enter the code sent to {0}.', [email])
                : undefined
        }
      />
      {step === 'NUMBER' && (
        <>
          <Card>
            <PhoneField value={mobile} onChange={setMobile} />
            <Text style={styles.small}>
              {role === 'OWNER'
                ? t('New owners will need an email address for account recovery.')
                : t('Your owner must add your number to an active shop first.')}
            </Text>
          </Card>
          <Button
            title={t('Continue')}
            busy={action.busy}
            disabled={!!phoneError(mobile)}
            onPress={() =>
              void action.run(async () => {
                const result = await post<{ step: string }>('/auth/password/options', {
                  mobile,
                  role,
                });
                go(result.step === 'OWNER_RECOVERY' ? 'RECOVERY' : (result.step as Step));
              })
            }
          />
        </>
      )}
      {step === 'PASSWORD' && (
        <>
          <Card>
            <PasswordField value={password} onChange={setPassword} />
          </Card>
          <Button
            title={t('Sign in')}
            busy={action.busy}
            disabled={!password}
            onPress={() =>
              void action.run(() => finish('/auth/password/login', { mobile, role, password }))
            }
          />
          <Button
            title={t('Forgot password?')}
            secondary
            disabled={action.busy}
            onPress={() => go(role === 'OWNER' ? 'RECOVERY' : 'SETUP')}
          />
        </>
      )}
      {(step === 'REGISTER' || step === 'RECOVERY') && (
        <>
          <Card>
            {step === 'REGISTER' && (
              <>
                <Field
                  required
                  minLength={2}
                  label={t('Your name')}
                  value={name}
                  onChangeText={setName}
                  maxLength={100}
                  autoComplete="name"
                />
                <LanguagePicker
                  value={language}
                  onChange={(value) => value && setAppLanguage(value)}
                />
              </>
            )}
            <Field
              required
              error={
                email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                  ? t('Enter a valid email address.')
                  : ''
              }
              label={t('Email address')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              maxLength={254}
            />
            <Text style={styles.small}>
              {step === 'REGISTER'
                ? t('We will verify this email. Keep access to it to recover your password.')
                : t(
                    'If this email belongs to an owner account, we’ll send a recovery code. Your shop data stays unchanged.',
                  )}
            </Text>
          </Card>
          <Button
            title={t('Send email code')}
            busy={action.busy}
            disabled={
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
              (step === 'REGISTER' && name.trim().length < 2)
            }
            onPress={() => void action.run(sendEmail)}
          />
        </>
      )}
      {emailConfirm && (
        <>
          {challenge?.dev_otp && (
            <Card>
              <Text style={styles.eyebrow}>{t('DEVELOPMENT EMAIL')}</Text>
              <Text style={styles.small}>
                {' '}
                {t('Use code')} {challenge.dev_otp}
                {t('. No email is sent in development mode.')}{' '}
              </Text>
            </Card>
          )}
          <Card>
            <Field
              required
              minLength={6}
              label={t('Email code')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
              maxLength={6}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <NewPasswordFields
              mobile={mobile}
              email={email}
              password={password}
              confirm={confirm}
              setPassword={setPassword}
              setConfirm={setConfirm}
            />
          </Card>
          <Button
            title={
              step === 'REGISTER_CONFIRM' ? t('Create account') : t('Reset password & sign in')
            }
            busy={action.busy}
            disabled={code.length !== 6 || !passwordsMatch(password, confirm, mobile, email)}
            onPress={() =>
              void action.run(() =>
                finish(
                  `/auth/owner/${step === 'REGISTER_CONFIRM' ? 'register' : 'recovery'}/confirm`,
                  {
                    challenge_id: challenge!.challenge_id,
                    code,
                    password,
                    confirm_password: confirm,
                  },
                ),
              )
            }
          />
          <Button
            title={t('Request a fresh email code')}
            secondary
            disabled={action.busy}
            onPress={() => go(step === 'REGISTER_CONFIRM' ? 'REGISTER' : 'RECOVERY')}
          />
        </>
      )}
      {step === 'SETUP' && (
        <>
          <Card>
            <Text style={styles.subtitle}>
              {' '}
              {t(
                'Ask your owner for a one-time setup code. For a forgotten password, request approval below first. An authorised manager can help workers when the owner enables this.',
              )}{' '}
            </Text>
            <Field
              required
              minLength={8}
              label={t('Setup code')}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={100}
            />
            <NewPasswordFields
              mobile={mobile}
              email={email}
              password={password}
              confirm={confirm}
              setPassword={setPassword}
              setConfirm={setConfirm}
            />
          </Card>
          <Button
            title={t('Set password & sign in')}
            busy={action.busy}
            disabled={code.trim().length < 8 || !passwordsMatch(password, confirm, mobile, email)}
            onPress={() =>
              void action.run(() =>
                finish('/auth/staff/password/setup', {
                  mobile,
                  role,
                  setup_code: code,
                  password,
                  confirm_password: confirm,
                }),
              )
            }
          />
          <Button
            title={t('Request password reset')}
            secondary
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                const result = await post<{ message: string }>('/auth/staff/reset-request', {
                  mobile,
                  role,
                });
                setMessage(result.message);
              })
            }
          />
          <Button
            title={t('My account also owns a shop')}
            secondary
            onPress={() => go('RECOVERY')}
          />
        </>
      )}
      {step === 'OWNER_MIGRATION' && (
        <Card>
          <Text style={styles.subtitle}>
            {' '}
            {t(
              'This existing owner account needs a recovery email and password. Use an already signed-in device to complete setup. If you no longer have a session, contact the Hishob administrator to link your recovery email securely. Your shops are preserved.',
            )}{' '}
          </Text>
        </Card>
      )}
      {!!message && (
        <Card>
          <Text style={styles.subtitle}>{message}</Text>
        </Card>
      )}
      <ErrorText message={action.error} />
      {step !== 'NUMBER' && (
        <Button
          title={t('Use another mobile number')}
          secondary
          disabled={action.busy}
          onPress={() => go('NUMBER')}
        />
      )}
      {step === 'NUMBER' && role === 'OWNER' && (
        <Button title={t('Forgot password?')} secondary onPress={() => go('RECOVERY')} />
      )}
    </Page>
  );
}
