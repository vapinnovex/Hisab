import React, { useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import countries from '../data/countries.json';
import { colors, styles } from './ui';
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
  label = 'Mobile number',
  helperText = 'Use this number to sign in to Hishob',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [preferred, setPreferred] = useState(india);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const country = countryFor(value, preferred);
  const national = value.startsWith(country.code) ? value.slice(country.code.length) : value;
  const term = query.trim().toLowerCase();
  const matches = countries.filter((item) =>
    `${item.name} ${item.region} ${item.code}`.toLowerCase().includes(term),
  );
  return (
    <View style={{ gap: 9 }}>
      <Text style={styles.label}>{label}</Text>
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
          accessibilityLabel={`Country code: ${country.name} ${country.code}`}
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
          accessibilityLabel={label}
          value={national}
          onChangeText={(text) => {
            const cleaned = text.trim().replace(/[^\d+]/g, '');
            if (cleaned.startsWith('+')) {
              setPreferred(countryFor(cleaned, country));
              onChange(cleaned);
            } else onChange(country.code + cleaned.replace(/\+/g, ''));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          autoCorrect={false}
          autoCapitalize="none"
          placeholder={country.region === 'IN' ? '98765 43210' : 'Mobile number'}
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
        {country.name} · {helperText}
      </Text>
      {open && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <View
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,60,49,0.3)' }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss country picker"
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
                <Text style={styles.heading}>Country code</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close country picker"
                  onPress={() => setOpen(false)}
                  style={{ padding: 12 }}
                >
                  <Ionicons name="close" size={22} color={colors.green} />
                </Pressable>
              </View>
              <SearchField label="Search countries" value={query} onChange={setQuery} />
              <FlatList
                data={matches}
                keyExtractor={(item) => item.region}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={styles.small}>
                    No countries found. Try a country name or calling code.
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name} ${item.code}`}
                    accessibilityState={{ selected: item.region === country.region }}
                    onPress={() => {
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
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>{item.name}</Text>
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
