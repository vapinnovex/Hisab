import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../auth';
import { colors, styles } from './ui';

export function ShopSwitcher() {
  const { session, selected, select } = useAuth();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  if (!session || session.memberships.length < 2) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch shop, current shop: ${selected?.shop.name}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={{
          flexShrink: 1,
          maxWidth: 170,
          minHeight: 46,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 14,
          backgroundColor: colors.mint,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontSize: 10, color: colors.muted }}>
            {session.role === 'OWNER' ? 'Owner' : session.role === 'MANAGER' ? 'Manager' : 'Worker'}{' '}
            · Shop
          </Text>
          <Text numberOfLines={1} style={{ color: colors.green, fontWeight: '700', fontSize: 13 }}>
            {selected?.shop.name}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={colors.green} />
      </Pressable>
      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,60,49,0.3)' }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss shop switcher"
              onPress={() => setOpen(false)}
              style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            />
            <View
              accessibilityViewIsModal
              style={{
                backgroundColor: colors.background,
                maxHeight: '75%',
                width: '100%',
                maxWidth: 680,
                alignSelf: 'center',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 22,
                paddingBottom: Math.max(22, insets.bottom),
                gap: 16,
              }}
            >
              <View style={styles.row}>
                <Text style={styles.heading}>Switch shop</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close shop switcher"
                  onPress={() => setOpen(false)}
                  style={{ padding: 12, borderRadius: 14, backgroundColor: colors.mint }}
                >
                  <Ionicons name="close" size={20} color={colors.green} />
                </Pressable>
              </View>
              <Text style={styles.small}>Choose the shop you want to work with.</Text>
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {session.memberships.map((member) => {
                  const active = selected?.id === member.id;
                  return (
                    <Pressable
                      key={member.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Switch to ${member.shop.name}`}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        setOpen(false);
                        select(member.id);
                      }}
                      style={{
                        padding: 16,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: active ? colors.green : colors.line,
                        backgroundColor: active ? colors.mint : colors.white,
                      }}
                    >
                      <Ionicons name="storefront-outline" size={22} color={colors.green} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.heading, { fontSize: 16 }]}>{member.shop.name}</Text>
                        <Text style={styles.small}>
                          {active ? 'Current shop' : member.shop.timezone}
                        </Text>
                      </View>
                      {active && (
                        <Ionicons name="checkmark-circle" size={22} color={colors.green} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
