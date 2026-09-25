import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { request } from '../api';
import { useAuth } from '../auth';
import { Button, Card, colors, ErrorText, Field, Heading, Page, styles } from '../components/ui';
import { useAction } from '../hooks';
import { Challenge, Routes, Role } from '../types';
import { logo } from '../components/Brand';
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

export function MobileLogin({ navigation, route }: NativeStackScreenProps<Routes, 'MobileLogin'>) {
  const [mobile, setMobile] = useState('+91');
  const action = useAction();
  const { role } = route.params;
  return (
    <Page>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: colors.mint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="phone-portrait-outline" size={30} color={colors.green} />
      </View>
      <Text style={styles.eyebrow}>{role} LOGIN</Text>
      <Heading
        title="Your mobile number"
        subtitle={
          role === 'OWNER'
            ? 'New here? Your account is created after you verify your number.'
            : 'Use the number your shop owner added for you.'
        }
      />
      <Card>
        <PhoneField value={mobile} onChange={setMobile} />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.green} />
          <Text style={[styles.small, { flex: 1 }]}>A one-time code. No password to remember.</Text>
        </View>
      </Card>
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
            const result = await request<{ access_token?: string }>(
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
