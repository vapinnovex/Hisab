import { t, useLocale } from './../i18n';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { colors } from './ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Routes } from '../types';
import { ShopSwitcher } from './ShopSwitcher';

export const logo =
  process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? require('../../assets/brand/hishob-dev-logo.png')
    : require('../../assets/brand/hishob-logo.png');
export function BrandMark({ size = 46, subtitle }: { size?: number; subtitle?: string }) {
  useLocale();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1, minWidth: 0 }}
    >
      <Image
        source={logo}
        accessibilityLabel={t('Hishob logo')}
        resizeMode="contain"
        style={{ width: size, height: size }}
      />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: size > 50 ? 30 : 23,
            fontWeight: '800',
            color: colors.ink,
            letterSpacing: -0.8,
          }}
        >
          {' '}
          {t('Hishob')}
          <Text style={{ color: colors.gold }}>.</Text>
        </Text>
        {subtitle && (
          <Text style={{ fontSize: 10, color: colors.muted, letterSpacing: 0.4 }}>{subtitle}</Text>
        )}
      </View>
    </View>
  );
}
export function AccountButton() {
  useLocale();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Open account')}
      onPress={() => navigation.navigate('Profile')}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 10,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.mint,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="person-circle-outline" size={22} color={colors.green} />
      <Text style={{ color: colors.green, fontSize: 12, fontWeight: '600' }}>{t('Account')}</Text>
    </Pressable>
  );
}

export function AppHeader({
  onBack,
  showAccount = true,
  showShopSwitcher = true,
}: {
  onBack?: () => void;
  showAccount?: boolean;
  showShopSwitcher?: boolean;
}) {
  useLocale();
  const { session } = useAuth();
  const multipleShops = (session?.memberships.length || 0) > 1;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: colors.background }}>
      <View
        style={{
          paddingHorizontal: 16,
          minWidth: 0,
          paddingVertical: 10,
          gap: 10,
          maxWidth: 720,
          // Shared by tab roots and every nested screen.
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {onBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Back')}
              onPress={onBack}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 14,
                backgroundColor: pressed ? colors.mint : 'transparent',
              })}
            >
              <Ionicons name="chevron-back" size={24} color={colors.green} />
            </Pressable>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <BrandMark size={36} />
          </View>
          {showAccount && (
            <View style={{ flexShrink: 0 }}>
              <AccountButton />
            </View>
          )}
        </View>
        {showShopSwitcher && multipleShops && (
          <View style={{ alignItems: 'flex-start' }}>
            <ShopSwitcher />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
