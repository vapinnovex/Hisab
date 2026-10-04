import React from 'react';
import { Linking, Text } from 'react-native';
import { useAuth } from '../auth';
import { useAction } from '../hooks';
import { t, useLocale } from '../i18n';
import { Button, Card, ErrorText, Heading, Page, styles } from '../components/ui';

export function SupportScreen() {
  useLocale();
  const { selected } = useAuth();
  const action = useAction();
  return (
    <Page>
      <Heading
        title={t('Help & support')}
        subtitle={t('Get help with your account, attendance or Hishob.')}
      />
      <Card>
        <Heading title={t('Phone support')} />
        <Text selectable style={styles.heading}>
          {'+91 90224 45933'}
        </Text>
        <Button
          title={t('Call support')}
          onPress={() =>
            void action.run(async () => {
              try {
                await Linking.openURL('tel:+919022445933');
              } catch {
                throw new Error(
                  t('Could not open the phone app. Dial the support number shown above.'),
                );
              }
            })
          }
        />
        <ErrorText message={action.error} />
      </Card>
      <Card>
        <Heading title={t('Email support')} />
        <Text selectable style={styles.heading}>
          {'hishob.support@gmail.com'}
        </Text>
        <Text style={styles.small}>
          {t('Email support is not active yet. Please use the phone number above.')}
        </Text>
      </Card>
      <Card>
        <Heading title={t('Before contacting support')} />
        <Text style={styles.small}>
          {t(
            'Share your shop name, what you were trying to do, and the error message. Include a screenshot with private details hidden.',
          )}
        </Text>
        {selected && (
          <Text selectable style={styles.heading}>
            {selected.shop.name}
          </Text>
        )}
        <Text style={styles.small}>
          {t('Never share your password, verification code, setup code or face images.')}
        </Text>
      </Card>
    </Page>
  );
}
