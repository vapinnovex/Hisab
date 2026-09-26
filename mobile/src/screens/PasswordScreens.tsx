import React, { useState } from 'react';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { Button, Card, ErrorText, Field, Heading, Page, styles } from '../components/ui';
import { NewPasswordFields, PasswordField, passwordsMatch } from '../components/PasswordFields';
import { Challenge, Routes, Worker } from '../types';

export function PasswordSecurity() {
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
      <Heading
        title={enroll ? 'Secure your owner account' : 'Password & security'}
        subtitle={
          enroll
            ? 'Set a password and verify a recovery email. Your existing shops and records stay with you.'
            : 'Changing your password signs out your other devices.'
        }
      />
      {session!.user.email && (
        <Card>
          <Text style={styles.label}>Recovery email</Text>
          <Text style={styles.subtitle}>{session!.user.email}</Text>
        </Card>
      )}
      {enroll && !challenge ? (
        <>
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Button
            title="Verify recovery email"
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
                  Development email code: {challenge.dev_otp}. No email is sent.
                </Text>
              )}
              <Field
                label="Email code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            </>
          ) : (
            <PasswordField label="Current password" value={current} onChange={setCurrent} />
          )}
          <NewPasswordFields
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
          />
          <Button
            title={enroll ? 'Finish password setup' : 'Change password'}
            busy={action.busy}
            disabled={!passwordsMatch(password, confirm) || (enroll ? code.length !== 6 : !current)}
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
              title="Request a fresh email code"
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
        <Text style={styles.subtitle}>Password updated. Other devices have been signed out.</Text>
      )}
      <ErrorText message={action.error} />
      {enroll && <Button title="Sign out" secondary onPress={() => void action.run(signOut)} />}
      {!enroll && !session!.user.password_ready && (
        <Text style={styles.small}>
          Ask your owner for a setup code, then sign out and set your first password from the login
          screen.
        </Text>
      )}
    </Page>
  );
}

export function StaffPasswordAccess({
  route,
}: NativeStackScreenProps<Routes, 'StaffPasswordAccess'>) {
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
        title="Team password access"
        subtitle={`${route.params.worker.name} · ${route.params.worker.mobile}`}
      />
      {worker && (
        <Card>
          <Text style={styles.heading}>
            {!worker.password_ready
              ? 'First password setup'
              : worker.password_reset_required
                ? 'Reset approved'
                : worker.password_reset_requested
                  ? 'Password reset requested'
                  : 'Password is already set'}
          </Text>
          <Text style={styles.small}>
            Confirm who you are speaking to before sharing a code. Approval signs this person out on
            all devices. The code expires in 24 hours and works once. A new code replaces any
            previous one.
          </Text>
          {worker.active &&
            (!worker.password_ready ||
              worker.password_reset_requested ||
              worker.password_reset_required) && (
              <Button
                title={!worker.password_ready ? 'Generate setup code' : 'Approve password reset'}
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
              title="Decline request"
              secondary
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  await api(
                    `/shops/${selected!.shop_id}/team/${worker.id}/password-deny`,
                    {},
                    'POST',
                  );
                  setMessage('Request declined.');
                  await resource.refresh();
                })
              }
            />
          )}
          {!worker.active && (
            <Text style={styles.small}>
              Activate this team member before allowing password setup.
            </Text>
          )}
          {worker.password_ready &&
            !worker.password_reset_requested &&
            !worker.password_reset_required && (
              <Text style={styles.small}>
                For a forgotten password, they must request a reset from their login screen first.
              </Text>
            )}
        </Card>
      )}
      {issued && (
        <Card>
          <Text style={styles.eyebrow}>SHARE DIRECTLY WITH THIS PERSON</Text>
          <Text
            selectable
            accessibilityLabel={`Setup code ${issued.setup_code}`}
            style={[styles.heading, { fontSize: 26, letterSpacing: 2 }]}
          >
            {issued.setup_code}
          </Text>
          <Text style={styles.small}>{issued.message}</Text>
          <Text style={styles.small}>Expires {new Date(issued.expires_at).toLocaleString()}</Text>
        </Card>
      )}
      {!!message && <Text style={styles.subtitle}>{message}</Text>}
      <ErrorText message={action.error || resource.error} />
    </Page>
  );
}
