import { localeTag, t, useLocale } from './../i18n';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { Button, Card, ErrorText, Field, Heading, Page, styles } from '../components/ui';
import { NewPasswordFields, PasswordField, passwordsMatch } from '../components/PasswordFields';
import { Challenge, Routes, Worker } from '../types';
import { useNavigation } from '@react-navigation/native';

export function PasswordSecurity() {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { session, api, signIn, signOut } = useAuth();
  const enroll = session!.role === 'OWNER' && !session!.user.password_ready;
  const [email, setEmail] = useState(session!.user.email || '');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saved, setSaved] = useState(false);
  const action = useAction();
  return (
    <Page>
      {enroll && (
        <Button
          title={t('Personal language')}
          secondary
          onPress={() => navigation.navigate('LanguageSettings')}
        />
      )}
      <Heading
        title={enroll ? t('Secure your owner account') : t('Password & security')}
        subtitle={
          enroll
            ? t(
                'Set a password and verify a recovery email. Your existing shops and records stay with you.',
              )
            : t('Changing your password signs out your other devices.')
        }
      />
      {session!.user.email && (
        <Card>
          <Text style={styles.label}>{t('Recovery email')}</Text>
          <Text style={styles.subtitle}>{session!.user.email}</Text>
        </Card>
      )}
      {enroll && !challenge ? (
        <>
          <Field
            required
            label={t('Email address')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Button
            title={t('Verify recovery email')}
            busy={action.busy}
            disabled={!email.includes('@')}
            onPress={() =>
              void action.run(async () => {
                setChallenge(await api<Challenge>('/auth/owner/enroll/request', { email }, 'POST'));
              })
            }
          />
        </>
      ) : (
        <Card>
          {enroll ? (
            <>
              {challenge?.dev_otp && (
                <Text style={styles.small}>
                  {' '}
                  {t('Development email code:')} {challenge.dev_otp}
                  {t('. No email is sent.')}{' '}
                </Text>
              )}
              <Field
                required
                minLength={6}
                label={t('Email code')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            </>
          ) : (
            <PasswordField label={t('Current password')} value={current} onChange={setCurrent} />
          )}
          <NewPasswordFields
            mobile={session!.user.mobile}
            email={email}
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
          />
          <Button
            title={enroll ? t('Finish password setup') : t('Change password')}
            busy={action.busy}
            disabled={
              !passwordsMatch(password, confirm, session!.user.mobile, email) ||
              (enroll ? code.length !== 6 : !current)
            }
            onPress={() =>
              void action.run(async () => {
                const result = await api<{ access_token?: string }>(
                  enroll ? '/auth/owner/enroll/confirm' : '/auth/password/change',
                  {
                    password,
                    confirm_password: confirm,
                    ...(enroll
                      ? { challenge_id: challenge!.challenge_id, code }
                      : { current_password: current }),
                  },
                  'POST',
                );
                await signIn(result.access_token);
                setCurrent('');
                setPassword('');
                setConfirm('');
                setSaved(true);
              })
            }
          />
          {enroll && (
            <Button
              title={t('Request a fresh email code')}
              secondary
              onPress={() => {
                setChallenge(null);
                setCode('');
              }}
            />
          )}
        </Card>
      )}
      {saved && (
        <Text style={styles.subtitle}>
          {t('Password updated. Other devices have been signed out.')}
        </Text>
      )}
      <ErrorText message={action.error} />
      {enroll && (
        <Button title={t('Sign out')} secondary onPress={() => void action.run(signOut)} />
      )}
      {!enroll && !session!.user.password_ready && (
        <Text style={styles.small}>
          {' '}
          {t(
            'Ask your owner for a setup code, then sign out and set your first password from the login screen.',
          )}{' '}
        </Text>
      )}
    </Page>
  );
}

export function StaffPasswordAccess({
  route,
}: NativeStackScreenProps<Routes, 'StaffPasswordAccess'>) {
  useLocale();
  const { api, selected } = useAuth();
  const resource = useResource<Worker[]>(`/shops/${selected!.shop_id}/team`, true);
  const worker = resource.data?.find((w) => w.id === route.params.worker.id);
  const action = useAction();
  const [issued, setIssued] = useState<{
    setup_code: string;
    expires_at: string;
    message: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Team password access')}
        subtitle={`${route.params.worker.name} · ${route.params.worker.mobile}`}
      />
      {worker && (
        <Card>
          <Text style={styles.heading}>
            {!worker.password_ready
              ? t('First password setup')
              : worker.password_reset_required
                ? t('Reset approved')
                : worker.password_reset_requested
                  ? t('Password reset requested')
                  : t('Password is already set')}
          </Text>
          <Text style={styles.small}>
            {' '}
            {t(
              'Confirm who you are speaking to before sharing a code. Approval signs this person out on all devices. The code expires in 24 hours and works once. A new code replaces any previous one.',
            )}{' '}
          </Text>
          {worker.active &&
            (!worker.password_ready ||
              worker.password_reset_requested ||
              worker.password_reset_required) && (
              <Button
                title={
                  !worker.password_ready ? t('Generate setup code') : t('Approve password reset')
                }
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    setIssued(
                      await api(
                        `/shops/${selected!.shop_id}/team/${worker.id}/password-access`,
                        {},
                        'POST',
                      ),
                    );
                    await resource.refresh();
                  })
                }
              />
            )}
          {worker.password_reset_requested && !worker.password_reset_required && (
            <Button
              title={t('Decline request')}
              secondary
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  await api(
                    `/shops/${selected!.shop_id}/team/${worker.id}/password-deny`,
                    {},
                    'POST',
                  );
                  setMessage(t('Request declined.'));
                  await resource.refresh();
                })
              }
            />
          )}
          {!worker.active && (
            <Text style={styles.small}>
              {' '}
              {t('Activate this team member before allowing password setup.')}{' '}
            </Text>
          )}
          {worker.password_ready &&
            !worker.password_reset_requested &&
            !worker.password_reset_required && (
              <Text style={styles.small}>
                {' '}
                {t(
                  'For a forgotten password, they must request a reset from their login screen first.',
                )}{' '}
              </Text>
            )}
        </Card>
      )}
      {issued && (
        <Card>
          <Text style={styles.eyebrow}>{t('SHARE DIRECTLY WITH THIS PERSON')}</Text>
          <Text
            selectable
            accessibilityLabel={t('Setup code {0}', [issued.setup_code])}
            style={[styles.heading, { fontSize: 26, letterSpacing: 2 }]}
          >
            {issued.setup_code}
          </Text>
          <Text style={styles.small}>{issued.message}</Text>
          <Text style={styles.small}>
            {t('Expires')} {new Date(issued.expires_at).toLocaleString(localeTag())}
          </Text>
        </Card>
      )}
      {!!message && <Text style={styles.subtitle}>{message}</Text>}
      <ErrorText message={action.error || resource.error} />
    </Page>
  );
}
