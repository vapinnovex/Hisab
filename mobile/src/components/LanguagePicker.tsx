import { t, useLocale, translate, getLanguage } from './../i18n';
import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, styles } from './ui';
import { Language } from '../types';

export const languages: { value: Language; label: string; name: string }[] = [
  { value: 'en', label: 'English', name: 'English' },
  { value: 'hi', label: 'हिंदी', name: 'Hindi' },
  { value: 'mr', label: 'मराठी', name: 'Marathi' },
];

export function LanguagePicker({
  value,
  onChange,
  label = t('Language'),
  allowDefault = false,
  uiLanguage = getLanguage(),
  defaultLanguage,
}: {
  value: Language | null;
  onChange: (value: Language | null) => void;
  label?: string;
  allowDefault?: boolean;
  uiLanguage?: Language;
  defaultLanguage?: Language;
}) {
  useLocale();
  const indicator = (selected: boolean) => (
    <Ionicons
      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
      size={20}
      color={selected ? colors.green : colors.muted}
      accessible={false}
    />
  );
  return (
    <View style={picker.group}>
      <View style={picker.heading}>
        <Ionicons name="language-outline" size={18} color={colors.green} accessible={false} />
        <Text style={[styles.label, picker.label]}>{label}</Text>
      </View>
      <View style={picker.options}>
        {languages.map((item) => {
          const selected = value === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(item.value)}
              style={({ pressed }) => [
                picker.option,
                selected && picker.selected,
                pressed && picker.pressed,
              ]}
            >
              <View style={picker.optionHeader}>
                <Text style={picker.code}>{item.value.toUpperCase()}</Text>
                {indicator(selected)}
              </View>
              <Text style={picker.nativeName}>{item.label}</Text>
              {item.name !== item.label && <Text style={picker.name}>{item.name}</Text>}
            </Pressable>
          );
        })}
      </View>
      {allowDefault && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate(uiLanguage, 'useShopDefault')}
          accessibilityState={{ selected: value === null }}
          onPress={() => onChange(null)}
          style={({ pressed }) => [
            picker.defaultOption,
            value === null && picker.selected,
            pressed && picker.pressed,
          ]}
        >
          <Ionicons name="storefront-outline" size={21} color={colors.green} accessible={false} />
          <View style={picker.defaultText}>
            <Text style={picker.defaultTitle}>{translate(uiLanguage, 'useShopDefault')}</Text>
            {defaultLanguage && (
              <Text style={picker.name}>
                {languages.find((item) => item.value === defaultLanguage)?.label}
              </Text>
            )}
          </View>
          {indicator(value === null)}
        </Pressable>
      )}
    </View>
  );
}

const picker = StyleSheet.create({
  group: { gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    flexGrow: 1,
    flexBasis: 80,
    minWidth: 80,
    padding: 10,
    minHeight: 106,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    gap: 5,
  },
  optionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.green },
  nativeName: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 5 },
  name: { fontSize: 12, color: colors.green },
  selected: { borderColor: colors.green, backgroundColor: colors.mint },
  pressed: { opacity: 0.7 },
  defaultOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  defaultText: { flex: 1, gap: 3 },
  defaultTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
