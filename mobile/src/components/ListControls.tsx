import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, styles } from './ui';

export function matchesPerson(person: { name: string; mobile: string }, query: string) {
  const term = query.trim().toLocaleLowerCase();
  const digits = term.replace(/[^0-9]/g, '');
  return (
    !term ||
    person.name.toLocaleLowerCase().includes(term) ||
    person.mobile.includes(term) ||
    (!!digits && /^[+\d\s()-]+$/.test(term) && person.mobile.includes(digits))
  );
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder = 'Search by name or mobile',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.white,
        paddingLeft: 14,
      }}
    >
      <Ionicons name="search-outline" size={20} color={colors.muted} />
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, paddingVertical: 15, fontSize: 15, color: colors.ink }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Clear ${label.toLowerCase()}`}
        disabled={!value}
        onPress={() => onChange('')}
        style={{ padding: 14, opacity: value ? 1 : 0 }}
      >
        <Ionicons name="close-circle" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option.label}${option.count === undefined ? '' : `, ${option.count}`}`}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: active ? colors.green : colors.line,
              backgroundColor: active ? colors.green : colors.white,
            }}
          >
            <Text
              style={[
                styles.small,
                { color: active ? colors.white : colors.ink, fontWeight: '600' },
              ]}
            >
              {option.label}
            </Text>
            {option.count !== undefined && (
              <Text style={{ color: active ? '#D5E5D9' : colors.muted, fontSize: 12 }}>
                {option.count}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
