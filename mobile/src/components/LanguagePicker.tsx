import { t, useLocale, translate, getLanguage } from './../i18n';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, styles } from './ui';
import { Language } from '../types';

export const languages: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'mr', label: 'मराठी' },
];

export function LanguagePicker({
  value,
  onChange,
  label = t('Language'),
  allowDefault = false,
  uiLanguage = getLanguage(),
}: {
  value: Language | null;
  onChange: (value: Language | null) => void;
  label?: string;
  allowDefault?: boolean;
  uiLanguage?: Language;
}) {
  useLocale();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      {allowDefault && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === null }}
          onPress={() => onChange(null)}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: value === null ? colors.mint : colors.white,
          }}
        >
          <Text style={styles.heading}>{translate(uiLanguage, 'useShopDefault')}</Text>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {languages.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: value === item.value }}
            onPress={() => onChange(item.value)}
            style={{
              flex: 1,
              paddingVertical: 11,
              alignItems: 'center',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: value === item.value ? colors.green : colors.line,
              backgroundColor: value === item.value ? colors.mint : colors.white,
            }}
          >
            <Text style={{ color: colors.ink, fontWeight: '700' }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
