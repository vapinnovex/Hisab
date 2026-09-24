import React from 'react';
import { Image, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { colors, styles } from './ui';
import { ShopSwitcher } from './ShopSwitcher';

export const logo = require('../../assets/brand/hishob-logo.png');
export function BrandMark({ size = 46, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Image
        source={logo}
        accessibilityLabel="Hishob logo"
        resizeMode="contain"
        style={{ width: size, height: size }}
      />
      <View>
        <Text
          style={{
            fontSize: size > 50 ? 30 : 23,
            fontWeight: '800',
            color: colors.ink,
            letterSpacing: -0.8,
          }}
        >
          Hishob<Text style={{ color: colors.gold }}>.</Text>
        </Text>
        {subtitle && (
          <Text style={{ fontSize: 10, color: colors.muted, letterSpacing: 0.4 }}>{subtitle}</Text>
        )}
      </View>
    </View>
  );
}
export function AppHeader() {
  const { session } = useAuth();
  const multipleShops = (session?.memberships.length || 0) > 1;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          maxWidth: 720,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <BrandMark
          size={multipleShops ? 36 : 46}
          subtitle={multipleShops ? undefined : 'YOUR SHOP. YOUR PEOPLE.'}
        />
        {multipleShops ? (
          <ShopSwitcher />
        ) : (
          <View
            style={{
              backgroundColor: colors.mint,
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 7,
            }}
          >
            <Text style={[styles.small, { color: colors.green, fontWeight: '700', fontSize: 11 }]}>
              {session?.role === 'OWNER'
                ? 'Owner'
                : session?.role === 'MANAGER'
                  ? 'Manager'
                  : 'Worker'}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
