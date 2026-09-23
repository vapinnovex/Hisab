import { Text, View } from 'react-native';
import { useAuth } from '../auth';
import { Button, styles } from './ui';

export function ShopSwitcher() {
  const { session, selected, select } = useAuth();
  if (!session || session.memberships.length < 2) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Your shops · tap to switch</Text>
      {session.memberships.map((member) => (
        <Button
          key={member.id}
          title={`${member.shop.name}${selected?.id === member.id ? ' · selected' : ''}`}
          secondary={selected?.id !== member.id}
          onPress={() => select(member.id)}
        />
      ))}
    </View>
  );
}
