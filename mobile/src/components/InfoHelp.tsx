import { t, useLocale } from './../i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

/** Inline help works with touch, keyboard and screen readers, without hiding the form. */
export function InfoHelp({ title, children }: { title: string; children: string }) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ flexShrink: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('About {0}', [title])}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
      >
        <Ionicons name="information-circle-outline" size={21} color="#145C45" />
        <Text style={{ color: '#145C45', fontSize: 13 }}>{title}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#145C45" />
      </Pressable>
      {expanded && (
        <Text
          style={{
            backgroundColor: '#E8F0E8',
            color: '#123C31',
            padding: 14,
            borderRadius: 12,
            fontSize: 14,
            lineHeight: 22,
          }}
        >
          {children}
        </Text>
      )}
    </View>
  );
}
