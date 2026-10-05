import { t, useLocale } from './../i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, Field, styles } from './ui';

export function PasswordField({
  label = t('Password'),
  value,
  onChange,
  fresh = false,
  error = '',
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  fresh?: boolean;
  error?: string;
}) {
  useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Field
        required
        minLength={fresh ? 12 : 1}
        error={
          error ||
          (fresh && value.trim() !== value
            ? t('Remove spaces at the beginning or end of the password.')
            : '')
        }
        label={label}
        style={[styles.input, { paddingRight: 60 }]}
        value={value}
        onChangeText={onChange}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={128}
        autoComplete={fresh ? 'new-password' : 'current-password'}
        textContentType={fresh ? 'newPassword' : 'password'}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${visible ? t('Hide') : t('Show')} ${label.toLowerCase()}`}
        onPress={() => setVisible(!visible)}
        style={{
          position: 'absolute',
          bottom: 4,
          right: 6,
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={22}
          color={colors.green}
        />
      </Pressable>
    </View>
  );
}
export function passwordChecks(password: string, mobile = '', email = '') {
  const length = Array.from(password).length;
  const stem = password.toLowerCase().replace(/[^a-z]/g, '');
  const common = [
    'password',
    'qwerty',
    'admin',
    'administrator',
    'welcome',
    'letmein',
    'hishob',
    'iloveyou',
    'correcthorsebatterystaple',
  ];
  return {
    length: length >= 12 && length <= 128,
    spaces: !!password && password.trim() === password,
    uncommon:
      !!password &&
      new Set(password).size >= 4 &&
      !common.includes(stem) &&
      !['123456789012'].includes(password),
    personal:
      !!password &&
      !(mobile && password.includes(mobile.replace(/^\+/, ''))) &&
      !(email && password.toLowerCase() === email.toLowerCase()),
  };
}
export function passwordsMatch(password: string, confirm: string, mobile = '', email = '') {
  return (
    Object.values(passwordChecks(password, mobile, email)).every(Boolean) && password === confirm
  );
}

export function NewPasswordFields({
  password,
  confirm,
  setPassword,
  setConfirm,
  mobile = '',
  email = '',
}: {
  password: string;
  confirm: string;
  setPassword: (value: string) => void;
  setConfirm: (value: string) => void;
  mobile?: string;
  email?: string;
}) {
  useLocale();
  const checks = passwordChecks(password, mobile, email);
  const valid = Object.values(checks).every(Boolean);
  const length = Array.from(password).length;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) =>
    r.test(password),
  ).length;
  const repeated = /(.{1,4})\1{2,}/u.test(password);
  const level = !password
    ? 0
    : !valid || repeated
      ? 1
      : length >= 20 &&
          new Set(password).size >= 10 &&
          (variety >= 3 || password.trim().split(/\s+/).length >= 4)
        ? 3
        : 2;
  const strength = [t('Not entered'), t('Low'), t('Medium'), t('High')][level];
  const tone = [colors.muted, colors.red, '#8A5A00', colors.green][level];
  const rules: [string, boolean][] = [
    [t('12–128 characters'), checks.length],
    [t('No spaces at the beginning or end'), checks.spaces],
    [t('Avoid common passwords and use at least 4 different characters'), checks.uncommon],
    ...(mobile || email
      ? [
          [t('Does not contain your mobile number or equal your email'), checks.personal] as [
            string,
            boolean,
          ],
        ]
      : []),
    [t('Passwords match'), !!confirm && password === confirm],
  ];
  return (
    <>
      <PasswordField label={t('New password')} value={password} onChange={setPassword} fresh />
      <View
        style={{
          backgroundColor: colors.background,
          borderRadius: 14,
          padding: 14,
          gap: 10,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: tone, fontSize: 13, fontWeight: '600' }}
        >
          {t('Password strength: {0}', [strength])}
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('Estimated password strength')}
          accessibilityValue={{ min: 0, max: 3, now: level, text: strength }}
          style={{ flexDirection: 'row', gap: 6 }}
        >
          {[1, 2, 3].map((segment) => (
            <View
              key={segment}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: segment <= level ? tone : colors.line,
              }}
            />
          ))}
        </View>
        <Text style={styles.small}>
          {t('Strength is an estimate. Use a unique, long passphrase you do not use elsewhere.')}
        </Text>
      </View>
      <PasswordField
        error={confirm && password !== confirm ? t('Passwords do not match.') : ''}
        label={t('Confirm password')}
        value={confirm}
        onChange={setConfirm}
        fresh
      />
      <View style={{ gap: 9 }}>
        {rules.map(([label, passed]) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${passed ? t('Passed') : t('Not met')}: ${label}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
          >
            <Ionicons
              name={passed ? 'checkmark-circle' : 'close-circle-outline'}
              size={18}
              color={passed ? colors.green : password || confirm ? colors.red : colors.muted}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 13,
                lineHeight: 19,
                color: passed ? colors.green : colors.ink,
              }}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}
