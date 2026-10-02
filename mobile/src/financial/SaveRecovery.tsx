import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { t, useLocale } from '../i18n';
import { useAction } from '../hooks';
import { Button, ErrorText, styles } from '../components/ui';

// Checking is read-only: never automatically replay an uncertain financial write.
export function SaveRecovery({ check }: { check: () => Promise<boolean> }) {
  useLocale();
  const action = useAction();
  const [notFound, setNotFound] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Button
        title={t('Check saved result')}
        secondary
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            setNotFound(false);
            setNotFound(!(await check()));
          })
        }
      />
      <ErrorText message={action.error} />
      {notFound && (
        <Text accessibilityLiveRegion="polite" style={styles.small}>
          {t(
            'This change is not confirmed yet. Keep this form open and retry the same save, or review the latest day if it changed.',
          )}
        </Text>
      )}
    </View>
  );
}
