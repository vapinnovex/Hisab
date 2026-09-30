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
export function passwordsMatch(password: string, confirm: string) {
  return (
    password.length >= 12 &&
    password.length <= 128 &&
    password.trim() === password &&
    password === confirm
  );
}
export function NewPasswordFields({
  password,
  confirm,
  setPassword,
  setConfirm,
}: {
  password: string;
  confirm: string;
  setPassword: (value: string) => void;
  setConfirm: (value: string) => void;
}) {
  useLocale();
  return (
    <>
      <Text style={styles.small}>
        {' '}
        {t(
          'Use 12–128 characters. A unique phrase with several words is easier to remember. Avoid common passwords and your mobile number.',
        )}{' '}
      </Text>
      <PasswordField label={t('New password')} value={password} onChange={setPassword} fresh />
      <PasswordField
        error={confirm && password !== confirm ? t('Passwords do not match.') : ''}
        label={t('Confirm password')}
        value={confirm}
        onChange={setConfirm}
        fresh
      />
      {!!confirm && password !== confirm && (
        <Text style={styles.small}>{t('Passwords do not match yet.')}</Text>
      )}
    </>
  );
}
