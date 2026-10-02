import React from 'react';
import { Text, View } from 'react-native';
import { t, useLocale } from '../i18n';
import { Button, ErrorText, Loading, styles } from './ui';

// A failed refresh retains data for the same query; label it until a retry succeeds.
export function ResourceStatus({
  resource,
  loadingLabel,
  retryLabel,
}: {
  resource: {
    data: unknown;
    error: string;
    loading: boolean;
    refreshing: boolean;
    refresh: () => Promise<void>;
  };
  loadingLabel: string;
  retryLabel: string;
}) {
  useLocale();
  if (resource.loading)
    return (
      <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
        <Text style={styles.small}>{loadingLabel}</Text>
        <Loading />
      </View>
    );
  if (!resource.error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ErrorText message={resource.error} />
      {resource.data != null && (
        <Text style={styles.small}>
          {t(
            'Showing previously loaded information. It may be out of date until refresh succeeds.',
          )}
        </Text>
      )}
      <Button
        title={retryLabel}
        secondary
        busy={resource.refreshing}
        onPress={() => void resource.refresh()}
      />
    </View>
  );
}
