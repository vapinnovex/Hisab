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
              detail="Confirm with your password and recovery email"
              icon="call-outline"
              onPress={() => navigation.navigate('ChangeMobile')}
            />
          </Card>
        </>
      )}
      <Card>
        <AccountLink
          title="Password & security"
          detail="Change your password and review recovery details"
          icon="lock-closed-outline"
          onPress={() => navigation.navigate('PasswordSecurity')}
        />
      </Card>
      <Text style={styles.eyebrow}>CURRENT SHOP</Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Ionicons name="storefront-outline" size={24} color={colors.green} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.heading}>{selected?.shop.name}</Text>
            <Text style={styles.small}>{selected?.shop.timezone}</Text>
          </View>
        </View>
        {session!.role === 'MANAGER' && (
          <AccountLink
            title="My attendance"
            detail="Your workday and monthly attendance"
            icon="checkmark-circle-outline"
            onPress={() => navigation.navigate('MyAttendance')}
          />
        )}
        {selected!.permissions.view_hishob && (
          <AccountLink
            title="Hishob history"
            detail="Daily cash records and preserved closings"
            icon="wallet-outline"
            onPress={() =>
              navigation.navigate('Hishob', { screen: 'HishobHistory', initial: false })
            }
          />
        )}
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
      <InstallHelp />
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
  useUnsavedChanges(name !== (session!.user.name || ''));
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
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const action = useAction();
  return (
    <Page>
      <Heading
        title={done ? 'Your number is updated' : 'A new number. Same shop.'}
        subtitle={
          done
            ? 'Your shops, people and attendance are all right here.'
            : 'Confirm your password, then verify the code sent to your recovery email.'
        }
      />
      <Card>
        <Text style={styles.small}>Current login number</Text>
        <Text style={styles.heading}>{session!.user.mobile}</Text>
      </Card>
      {!done &&
        (!challenge ? (
          <>
            <PhoneField label="New mobile number" value={mobile} onChange={setMobile} />
            <PasswordField label="Current password" value={password} onChange={setPassword} />
            <Text style={styles.small}>
              This changes your login number. It does not verify ownership of the new phone number.
              Check it carefully.
            </Text>
            <Button
              title="Send confirmation email"
              busy={action.busy}
              disabled={mobile.length < 8 || !password}
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
            <Text style={styles.subtitle}>Check {session!.user.email}</Text>
            {challenge.dev_otp && (
              <Text style={styles.small}>Development email code: {challenge.dev_otp}</Text>
            )}
            <Field
              label="Email code"
              value={code}
              onChangeText={setCode}
              maxLength={6}
              keyboardType="number-pad"
            />
            <Button
              title="Confirm mobile change"
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
              title="Start again"
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
            Use this number next time you log in. Other signed-in sessions have been signed out.
          </Text>
          <Button title="Back to account" onPress={() => navigation.goBack()} />
        </>
      )}
      <ErrorText message={action.error} />
    </Page>
  );
}
