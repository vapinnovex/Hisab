import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { request } from '../api';
import { useAuth } from '../auth';
import { Button, Card, colors, ErrorText, Field, Heading, Page, styles } from '../components/ui';
import { useAction } from '../hooks';
import { Challenge, Routes } from '../types';

export function RoleSelection({ navigation }: NativeStackScreenProps<Routes, 'RoleSelection'>) {
  return (
    <Page>
      <View style={{ paddingTop: 44, paddingBottom: 20, gap: 18 }}>
        <View
          style={{
            backgroundColor: colors.green,
            height: 64,
            width: 64,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="storefront-outline" color="white" size={32} />
        </View>
        <Text style={styles.eyebrow}>HISAB · YOUR SHOP, TOGETHER</Text>
        <Heading
          title="A good day starts here."
          subtitle="Your team, your shop, and attendance. All in one place."
        />
      </View>
      <Card>
        <Ionicons name="storefront-outline" size={28} color={colors.green} />
        <Text style={styles.heading}>I run a shop</Text>
        <Text style={styles.subtitle}>
          Set up your shop, manage your workers, and keep track of every day.
        </Text>
        <Button
          title="Continue as Owner"
          onPress={() => navigation.navigate('MobileLogin', { role: 'OWNER' })}
        />
      </Card>
      <Card>
        <Ionicons name="briefcase-outline" size={28} color={colors.green} />
        <Text style={styles.heading}>I manage a shop</Text>
        <Text style={styles.subtitle}>
          Record attendance and support the team, with permissions set by your owner.
        </Text>
        <Button
          title="Continue as Manager"
          secondary
          onPress={() => navigation.navigate('MobileLogin', { role: 'MANAGER' })}
        />
      </Card>
      <Card>
        <Ionicons name="people-outline" size={28} color={colors.green} />
        <Text style={styles.heading}>I work at a shop</Text>
        <Text style={styles.subtitle}>
          See your monthly attendance. Your owner or manager records your workdays.
        </Text>
        <Button
          secondary
          title="Continue as Worker"
          onPress={() => navigation.navigate('MobileLogin', { role: 'WORKER' })}
        />
      </Card>
      <Text style={[styles.small, { textAlign: 'center' }]}>Simple days. A stronger team.</Text>
    </Page>
  );
}

export function MobileLogin({ navigation, route }: NativeStackScreenProps<Routes, 'MobileLogin'>) {
  const [mobile, setMobile] = useState('+91');
  const action = useAction();
  const { role } = route.params;
  return (
    <Page>
      <Text style={styles.eyebrow}>{role} LOGIN</Text>
      <Heading
        title="Your mobile number"
        subtitle={
          role === 'OWNER'
            ? 'New here? Your account is created after you verify your number.'
            : 'Use the number your shop owner added for you.'
        }
      />
      <Field
        label="Mobile number"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={mobile}
        onChangeText={setMobile}
        placeholder="+919876543210"
        maxLength={20}
      />
      <Text style={styles.small}>Include your country code, for example +91 for India.</Text>
      <ErrorText message={action.error} />
      <Button
        title="Send OTP"
        busy={action.busy}
        disabled={mobile.length < 8}
        onPress={() =>
          void action.run(async () => {
            const challenge = await request<Challenge>(
              '/auth/otp/request',
              null,
              { mobile: mobile.trim(), role },
              'POST',
            );
            navigation.navigate('OTP', { mobile: mobile.trim(), role, challenge });
          })
        }
      />
    </Page>
  );
}

export function OTPScreen({ route, navigation }: NativeStackScreenProps<Routes, 'OTP'>) {
  const { mobile, role } = route.params;
  const [challenge, setChallenge] = useState(route.params.challenge);
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(challenge.resend_after);
  const action = useAction();
  const { signIn } = useAuth();
  useEffect(() => {
    const interval = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <Page>
      <Heading
        title="Verify your number"
        subtitle={`Enter the 6-digit code for ${mobile}. It expires in ${Math.round(challenge.expires_in / 60)} minutes.`}
      />
      {challenge.dev_otp && (
        <Card>
          <Text style={styles.eyebrow}>DEVELOPMENT MODE</Text>
          <Text style={styles.subtitle}>Use OTP {challenge.dev_otp}. No SMS is sent.</Text>
        </Card>
      )}
      <Field
        label="OTP code"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        maxLength={6}
        placeholder="6-digit code"
      />
      <ErrorText message={action.error} />
      <Button
        title="Verify & continue"
        disabled={code.length !== 6}
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            const result = await request<{ access_token: string }>(
              '/auth/otp/verify',
              null,
              { challenge_id: challenge.challenge_id, code },
              'POST',
            );
            await signIn(result.access_token);
          })
        }
      />
      <Button
        title={remaining ? `Resend in ${remaining}s` : 'Resend OTP'}
        secondary
        disabled={remaining > 0 || action.busy}
        onPress={() =>
          void action.run(async () => {
            const next = await request<Challenge>(
              '/auth/otp/request',
              null,
              { mobile, role },
              'POST',
            );
            setChallenge(next);
            setRemaining(next.resend_after);
            setCode('');
          })
        }
      />
      <Button
        title="Change mobile number"
        secondary
        disabled={action.busy}
        onPress={() => navigation.goBack()}
      />
    </Page>
  );
}
