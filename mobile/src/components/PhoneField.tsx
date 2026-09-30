import { t, useLocale, countryName } from './../i18n';
import { phoneError, phoneRule } from '../phone';
import React, { useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import countries from '../data/countries.json';
import { ErrorText, useFieldValidation, colors, styles } from './ui';
import { SearchField } from './ListControls';

const india = countries.find((country) => country.region === 'IN')!;
const byPrefix = [...countries].sort(
  (a, b) => b.code.length - a.code.length || Number(b.primary) - Number(a.primary),
);
function countryFor(number: string, preferred: typeof india) {
  if (number.startsWith(preferred.code)) return preferred;
  // Shared calling codes keep the selected country; otherwise use the primary region.
  return byPrefix.find((country) => number.startsWith(country.code)) || preferred;
}

export function PhoneField({
  value,
  onChange,
  label = t('Mobile number'),
  helperText = t('Use this number to sign in to Hishob'),
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
}) {
  useLocale();
  const input = useRef<TextInput>(null);
  const edited = useRef(false);
  const [touched, setTouched] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [focused, setFocused] = useState(false);
  const [preferred, setPreferred] = useState(india);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const country = countryFor(value, preferred);
  const national = value.startsWith(country.code) ? value.slice(country.code.length) : value;
  const validation = phoneError(value, country.region);
  useFieldValidation(validation, () => {
    setTouched(true);
    input.current?.focus();
  });
  const accept = (next: string, selected: typeof india) => {
    const rule = phoneRule(selected.region);
    const max = Math.max(...rule.lengths);
    const national = next.slice(selected.code.length);
    // Accept a pasted domestic trunk prefix only when removing it produces a valid mobile.
    if (rule.prefix && /^\d+$/.test(rule.prefix) && national.startsWith(rule.prefix)) {
      const withoutPrefix = national.slice(rule.prefix.length);
      if (!phoneError(selected.code + withoutPrefix, selected.region))
        next = selected.code + withoutPrefix;
    }
    if (next.slice(selected.code.length).length > max) {
      setLimitError(
        t('Use no more than {0} digits for {1}.', [
          max,
          countryName(selected.region, selected.name),
        ]),
      );
      return;
    }
    setLimitError('');
    setPreferred(selected);
    onChange(next);
  };
  const term = query.trim().toLowerCase();
  const matches = countries.filter((item) =>
    `${countryName(item.region, item.name)} ${item.name} ${item.region} ${item.code}`
      .toLowerCase()
      .includes(term),
  );
  return (
    <View style={{ gap: 9 }}>
      <Text style={styles.label}>
        {label} {t('· Required')}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          borderWidth: 2,
          borderColor: focused ? colors.green : colors.line,
          borderRadius: 18,
          backgroundColor: colors.white,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Country code: {0} {1}', [
            countryName(country.region, country.name),
            country.code,
          ])}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            Keyboard.dismiss();
            setQuery('');
            setOpen(true);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 46,
            paddingHorizontal: 8,
            backgroundColor: colors.mint,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: colors.green, fontWeight: '700', fontSize: 15 }}>
            {country.code}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.green} />
        </Pressable>
        <TextInput
          ref={input}
          accessibilityLabel={label}
          value={national}
          onChangeText={(text) => {
            edited.current = true;
            const cleaned = text.trim().replace(/[^\d+]/g, '');
            if (cleaned.startsWith('+')) {
              accept(cleaned, countryFor(cleaned, country));
            } else accept(country.code + cleaned.replace(/\+/g, ''), country);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (edited.current) setTouched(true);
          }}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          autoCorrect={false}
          autoCapitalize="none"
          placeholder={country.region === 'IN' ? '98765 43210' : t('Mobile number')}
          placeholderTextColor={colors.muted}
          maxLength={25}
          returnKeyType="done"
          style={{
            outlineStyle: 'solid',
            outlineWidth: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 20,
            color: colors.ink,
            paddingVertical: 20,
          }}
        />
      </View>
      <Text style={styles.small}>
        {countryName(country.region, country.name)} · {helperText}
      </Text>
      <ErrorText message={limitError || (touched ? validation : '')} />
      {open && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <View
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,60,49,0.3)' }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Dismiss country picker')}
              onPress={() => setOpen(false)}
              style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            />
            <View
              accessibilityViewIsModal
              style={{
                height: '75%',
                maxWidth: 680,
                width: '100%',
                alignSelf: 'center',
                backgroundColor: colors.background,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 20,
                paddingBottom: Math.max(20, insets.bottom),
                gap: 14,
              }}
            >
              <View style={styles.row}>
                <Text style={styles.heading}>{t('Country code')}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Close country picker')}
                  onPress={() => setOpen(false)}
                  style={{ padding: 12 }}
                >
                  <Ionicons name="close" size={22} color={colors.green} />
                </Pressable>
              </View>
              <SearchField label={t('Search countries')} value={query} onChange={setQuery} />
              <FlatList
                data={matches}
                keyExtractor={(item) => item.region}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={styles.small}>
                    {' '}
                    {t('No countries found. Try a country name or calling code.')}{' '}
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${countryName(item.region, item.name)} ${item.code}`}
                    accessibilityState={{ selected: item.region === country.region }}
                    onPress={() => {
                      setLimitError('');
                      setPreferred(item);
                      onChange(item.code + national);
                      setOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 15,
                      marginBottom: 6,
                      borderRadius: 14,
                      backgroundColor: item.region === country.region ? colors.mint : colors.white,
                    }}
                  >
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>
                      {countryName(item.region, item.name)}
                    </Text>
                    <Text style={{ fontWeight: '700', color: colors.green }}>{item.code}</Text>
                    {item.region === country.region && (
                      <Ionicons name="checkmark" size={18} color={colors.green} />
                    )}
                  </Pressable>
                )}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
