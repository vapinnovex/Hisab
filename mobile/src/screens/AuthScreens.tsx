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

export function RoleSelection({ navigation }: NativeStackScreenProps<Routes, 'RoleSelection'>) {
  const roles: {
    role: Role;
    title: string;
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      role: 'OWNER',
      title: 'Owner',
      detail: 'Your shop. Your team. Your way.',
      icon: 'storefront-outline',
    },
    {
      role: 'MANAGER',
      title: 'Manager',
      detail: 'Keep the team and the day on track.',
      icon: 'briefcase-outline',
    },
    {
      role: 'WORKER',
      title: 'Worker',
      detail: 'Every workday, clearly in view.',
      icon: 'person-outline',
    },
  ];
  return (
    <Page topInset>
      <View style={{ alignItems: 'center', gap: 9, paddingTop: 10, paddingBottom: 12 }}>
        <Image
          source={logo}
          accessibilityLabel="Hishob logo"
          resizeMode="contain"
          style={{ width: 152, height: 152 }}
        />
        <Text style={{ fontSize: 39, fontWeight: '800', color: colors.ink, letterSpacing: -1.5 }}>
          Hishob<Text style={{ color: colors.gold }}>.</Text>
        </Text>
        <Text style={[styles.eyebrow, { fontSize: 10, letterSpacing: 2.3 }]}>
          SMALL SHOP. BIG POSSIBILITIES.
        </Text>
      </View>
      <Heading
        title="Good days start together."
        subtitle="A simpler way to look after your shop and the people who make it happen."
      />
      <Text style={styles.label}>HOW WILL YOU USE HISHOB?</Text>
      {roles.map((item) => (
        <Pressable
          key={item.role}
          accessibilityRole="button"
          accessibilityLabel={`Continue as ${item.title}`}
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
              Continue as {item.title}
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
        One mobile number. Your place in the team.
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
  const { role } = route.params;
  const { signIn } = useAuth();
  const [mobile, setMobile] = useState('+91');
  const [step, setStep] = useState<Step>('NUMBER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
      registration ? { mobile, role, name, email } : { email },
    );
    setChallenge(next);
    go(registration ? 'REGISTER_CONFIRM' : 'RECOVERY_CONFIRM');
  };
  const emailConfirm = step === 'REGISTER_CONFIRM' || step === 'RECOVERY_CONFIRM';
  return (
    <Page>
      <Text style={styles.eyebrow}>{role} ACCOUNT</Text>
      <Heading
        title={
          step === 'NUMBER'
            ? 'Welcome to Hishob'
            : step === 'PASSWORD'
              ? 'Welcome back'
              : step === 'REGISTER'
                ? 'Create your owner account'
                : step === 'RECOVERY'
                  ? 'Recover your account'
                  : step === 'SETUP'
                    ? 'Set your password'
                    : step === 'OWNER_MIGRATION'
                      ? 'Secure your existing account'
                      : 'Check your email'
        }
        subtitle={
          step === 'NUMBER'
            ? 'Use your mobile number to continue.'
            : step === 'PASSWORD' || step === 'SETUP'
              ? mobile
              : emailConfirm
                ? `Enter the code sent to ${email}.`
                : undefined
        }
      />
      {step === 'NUMBER' && (
        <>
          <Card>
            <PhoneField value={mobile} onChange={setMobile} />
            <Text style={styles.small}>
              {role === 'OWNER'
                ? 'New owners will need an email address for account recovery.'
                : 'Your owner must add your number to an active shop first.'}
            </Text>
          </Card>
          <Button
            title="Continue"
            busy={action.busy}
            disabled={mobile.length < 8}
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
            title="Sign in"
            busy={action.busy}
            disabled={!password}
            onPress={() =>
              void action.run(() => finish('/auth/password/login', { mobile, role, password }))
            }
          />
          <Button
            title="Forgot password?"
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
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                maxLength={100}
                autoComplete="name"
              />
            )}
            <Field
              label="Email address"
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
                ? 'We will verify this email. Keep access to it to recover your password.'
                : 'If this email belongs to an owner account, we’ll send a recovery code. Your shop data stays unchanged.'}
            </Text>
          </Card>
          <Button
            title="Send email code"
            busy={action.busy}
            disabled={!email.includes('@') || (step === 'REGISTER' && name.trim().length < 2)}
            onPress={() => void action.run(sendEmail)}
          />
        </>
      )}
      {emailConfirm && (
        <>
          {challenge?.dev_otp && (
            <Card>
              <Text style={styles.eyebrow}>DEVELOPMENT EMAIL</Text>
              <Text style={styles.small}>
                Use code {challenge.dev_otp}. No email is sent in development mode.
              </Text>
            </Card>
          )}
          <Card>
            <Field
              label="Email code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
              maxLength={6}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <NewPasswordFields
              password={password}
              confirm={confirm}
              setPassword={setPassword}
              setConfirm={setConfirm}
            />
          </Card>
          <Button
            title={step === 'REGISTER_CONFIRM' ? 'Create account' : 'Reset password & sign in'}
            busy={action.busy}
            disabled={code.length !== 6 || !passwordsMatch(password, confirm)}
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
            title="Request a fresh email code"
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
              Ask your owner for a one-time setup code. For a forgotten password, request approval
              below first. An authorised manager can help workers when the owner enables this.
            </Text>
            <Field
              label="Setup code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={100}
            />
            <NewPasswordFields
              password={password}
              confirm={confirm}
              setPassword={setPassword}
              setConfirm={setConfirm}
            />
          </Card>
          <Button
            title="Set password & sign in"
            busy={action.busy}
            disabled={code.trim().length < 8 || !passwordsMatch(password, confirm)}
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
            title="Request password reset"
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
          <Button title="My account also owns a shop" secondary onPress={() => go('RECOVERY')} />
        </>
      )}
      {step === 'OWNER_MIGRATION' && (
        <Card>
          <Text style={styles.subtitle}>
            This existing owner account needs a recovery email and password. Use an already
            signed-in device to complete setup. If you no longer have a session, contact the Hishob
            administrator to link your recovery email securely. Your shops are preserved.
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
          title="Use another mobile number"
          secondary
          disabled={action.busy}
          onPress={() => go('NUMBER')}
        />
      )}
      {step === 'NUMBER' && role === 'OWNER' && (
        <Button title="Forgot password?" secondary onPress={() => go('RECOVERY')} />
      )}
    </Page>
  );
}
