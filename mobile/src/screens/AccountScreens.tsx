import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { PhoneField } from '../components/PhoneField';
import { useAction } from '../hooks';
import { Challenge, Routes } from '../types';

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
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const { session, selected, signOut, reload } = useAuth();
  const action = useAction();
  const owner = session!.role === 'OWNER';
  const name = owner
    ? session!.user.name || 'Welcome, shop owner'
    : selected?.worker_name || 'Team member';
  return (
    <Page refresh={reload}>
      <Heading title="Your account" subtitle="A little about you. Everything for your shop." />
      <View style={{ backgroundColor: colors.green, borderRadius: 26, padding: 22, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar
            name={owner && !session!.user.name ? 'Shop owner' : name}
            manager={session!.role !== 'WORKER'}
          />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: 23 }}>{name}</Text>
            <Text style={{ color: '#D5E5D9', fontSize: 12 }}>
              {owner ? 'Shop owner' : session!.role === 'MANAGER' ? 'Manager' : 'Worker'}
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
          <Text style={styles.eyebrow}>PERSONAL DETAILS</Text>
          <Card>
            <AccountLink
              title={session!.user.name ? 'Edit your name' : 'Add your name'}
              detail="How you’ll appear in Hishob"
              icon="person-outline"
              onPress={() => navigation.navigate('OwnerProfile')}
            />
            <AccountLink
              title="Change mobile number"
              detail="Verify your current and new numbers"
              icon="call-outline"
              onPress={() => navigation.navigate('ChangeMobile')}
            />
          </Card>
        </>
      )}
      <Text style={styles.eyebrow}>CURRENT SHOP</Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Ionicons name="storefront-outline" size={24} color={colors.green} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{selected?.shop.name}</Text>
            <Text style={styles.small}>{selected?.shop.timezone}</Text>
          </View>
        </View>
        {owner && (
          <>
            <AccountLink
              title="Shop settings"
              detail="Attendance rules and team permissions"
              icon="options-outline"
              onPress={() => navigation.navigate('ShopSettings')}
            />
            <AccountLink
              title="Manage managers"
              detail="The people you trust to run the day"
              icon="briefcase-outline"
              onPress={() => navigation.navigate('Managers')}
            />
            <AccountLink
              title="Create another shop"
              detail="One account, all your shops"
              icon="add-circle-outline"
              onPress={() => navigation.navigate('ShopSetup')}
            />
          </>
        )}
      </Card>
      {session!.role === 'MANAGER' && (
        <Card>
          <Text style={styles.heading}>Your permissions</Text>
          {[
            ['Record worker attendance', selected!.permissions.manage_attendance],
            ['Mark my own attendance', selected!.permissions.mark_own_attendance],
            ['Add workers', selected!.permissions.add_workers],
            ['Edit workers', selected!.permissions.edit_workers],
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
                {allowed ? 'Enabled' : 'Owner only'}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {!owner && (
        <Text style={styles.small}>
          Your shop owner manages your name and mobile number. Ask them if your details need
          updating.
        </Text>
      )}
      <ErrorText message={action.error} />
      <Button
        title="Sign out"
        secondary
        busy={action.busy}
        onPress={() => void action.run(signOut)}
      />
      <View style={{ alignItems: 'center', paddingVertical: 12, gap: 4 }}>
        <BrandMark size={40} />
        <Text style={[styles.small, { fontSize: 11 }]}>Made for the people behind the shop.</Text>
      </View>
    </Page>
  );
}

export function OwnerProfile({ navigation }: NativeStackScreenProps<Routes, 'OwnerProfile'>) {
  const { session, api, reload } = useAuth();
  const [name, setName] = useState(session!.user.name || '');
  const action = useAction();
  return (
    <Page>
      <Heading
        title="What should we call you?"
        subtitle="Your name makes Hishob feel a little more yours."
      />
      <Card>
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          placeholder="e.g. Prajwal Patil"
          maxLength={100}
        />
        <Text style={styles.small}>
          This name belongs to your account and is used across your shops.
        </Text>
      </Card>
      <ErrorText message={action.error} />
      <Button
        title="Save name"
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
  const { session, api, signIn } = useAuth();
  const [mobile, setMobile] = useState('+91');
  const [step, setStep] = useState<'NUMBER' | 'CURRENT' | 'NEW' | 'DONE'>('NUMBER');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const action = useAction();
  const start = async () => {
    const next = await api<Challenge>('/auth/mobile-change/request', { mobile }, 'POST');
    setChallenge(next);
    setCode('');
    setStep('CURRENT');
  };
  return (
    <Page>
      <Text style={styles.eyebrow}>ACCOUNT SECURITY</Text>
      <Heading
        title={
          step === 'DONE'
            ? 'Your number is updated'
            : step === 'NUMBER'
              ? 'A new number. Same shop.'
              : step === 'CURRENT'
                ? 'Verify your current number'
                : 'Verify your new number'
        }
        subtitle={
          step === 'DONE'
            ? 'Your shops, people and attendance are all right here.'
            : step === 'NUMBER'
              ? 'We’ll verify both numbers before updating your login.'
              : `Enter the 6-digit code sent to ${step === 'CURRENT' ? session!.user.mobile : mobile}.`
        }
      />
      {step === 'DONE' ? (
        <>
          <Card>
            <Ionicons name="checkmark-circle" size={48} color={colors.green} />
            <Text style={styles.heading}>{session!.user.mobile}</Text>
            <Text style={styles.subtitle}>
              Use this number next time you log in. Other signed-in sessions have been signed out.
            </Text>
          </Card>
          <Button title="Back to account" onPress={() => navigation.goBack()} />
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['New number', 'Current OTP', 'New OTP'].map((label, i) => (
              <View key={label} style={{ flex: 1, gap: 7 }}>
                <View
                  style={{
                    height: 4,
                    borderRadius: 4,
                    backgroundColor:
                      i <= ['NUMBER', 'CURRENT', 'NEW'].indexOf(step) ? colors.green : colors.line,
                  }}
                />
                <Text style={[styles.small, { fontSize: 11 }]}>{label}</Text>
              </View>
            ))}
          </View>
          {step === 'NUMBER' ? (
            <>
              <Card>
                <Text style={styles.small}>Current login number</Text>
                <Text style={styles.heading}>{session!.user.mobile}</Text>
              </Card>
              <PhoneField label="New mobile number" value={mobile} onChange={setMobile} />
              <Text style={styles.small}>
                Keep access to both phones. A number already linked to another Hishob account cannot
                be used.
              </Text>
            </>
          ) : (
            <>
              {challenge?.dev_otp && (
                <Card>
                  <Text style={styles.eyebrow}>DEVELOPMENT MODE</Text>
                  <Text style={styles.small}>Use OTP {challenge.dev_otp}. No SMS is sent.</Text>
                </Card>
              )}
              <Field
                label="Verification code"
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
                maxLength={6}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="6-digit code"
              />
              <Text style={styles.small}>
                Code expires in {Math.round((challenge?.expires_in || 300) / 60)} minutes. If it
                expires or doesn’t arrive, start again to request fresh verification.
              </Text>
            </>
          )}
          <ErrorText message={action.error} />
          <Button
            title={
              step === 'NUMBER'
                ? 'Verify current number'
                : step === 'CURRENT'
                  ? 'Verify & send new OTP'
                  : 'Confirm mobile change'
            }
            busy={action.busy}
            disabled={step === 'NUMBER' ? mobile.trim().length < 8 : code.length !== 6}
            onPress={() =>
              void action.run(async () => {
                if (step === 'NUMBER') return start();
                const body = { challenge_id: challenge!.challenge_id, code };
                if (step === 'CURRENT') {
                  const next = await api<Challenge>(
                    '/auth/mobile-change/verify-current',
                    body,
                    'POST',
                  );
                  setChallenge(next);
                  setCode('');
                  setStep('NEW');
                } else {
                  const result = await api<{ access_token: string }>(
                    '/auth/mobile-change/confirm',
                    body,
                    'POST',
                  );
                  await signIn(result.access_token);
                  setStep('DONE');
                }
              })
            }
          />
          {step !== 'NUMBER' && (
            <Button
              title="Start again"
              secondary
              disabled={action.busy}
              onPress={() => {
                setStep('NUMBER');
                setCode('');
                setChallenge(null);
              }}
            />
          )}
        </>
      )}
    </Page>
  );
}
