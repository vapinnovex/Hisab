import { t, useLocale } from './../i18n';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import { Keyboard, Modal, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, IconButton, Card, colors, ErrorText, Field, Page, styles } from '../components/ui';
import { calculateExpression } from './calculateExpression';

export function Calculator() {
  useLocale();
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('');
  const [message, setMessage] = useState('');
  const edit = (next: string) => {
    setExpression(next);
    setResult('');
    setMessage('');
  };
  const solve = () => {
    try {
      setResult(calculateExpression(expression));
      setMessage('');
    } catch (error) {
      setResult('');
      setMessage((error as Error).message);
    }
  };
  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
  };
  return (
    <>
      <IconButton
        label={t('Calculator')}
        name="calculator-outline"
        onPress={() => {
          Keyboard.dismiss();
          setMessage('');
          setOpen(true);
        }}
      />
      {open && (
        <Modal visible animationType="slide" onRequestClose={close}>
          <SafeAreaProvider>
            <SafeAreaView
              style={{ flex: 1, backgroundColor: colors.background }}
              edges={['top', 'bottom', 'left', 'right']}
            >
              <View
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                    gap: 12,
                  },
                  {
                    paddingHorizontal: 20,
                    paddingTop: 16,
                    paddingBottom: 10,
                    width: '100%',
                    maxWidth: 460,
                    alignSelf: 'center',
                  },
                ]}
              >
                <Text style={styles.heading}>{t('Calculator')}</Text>
                <IconButton label={t('Close calculator')} name="close" onPress={close} />
              </View>
              <Page>
                <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 16 }}>
                  <Text style={styles.small}>
                    {' '}
                    {t('Work out amounts here, then copy the result where you need it.')}{' '}
                  </Text>
                  <Card>
                    <Field
                      showSoftInputOnFocus={false}
                      label={t('Calculation')}
                      value={expression}
                      onChangeText={edit}
                      maxLength={100}
                      placeholder={t('e.g. 2500 + 300 − 150')}
                      onSubmitEditing={solve}
                    />
                    <Text style={styles.small}>{t('Result · rounded to 8 decimal places')}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text
                        selectable
                        accessibilityLabel={t('Calculator result')}
                        style={[styles.title, { flex: 1, fontVariant: ['tabular-nums'] }]}
                      >
                        {result || '—'}
                      </Text>
                      <IconButton
                        label={t('Copy result')}
                        name={
                          message === t('Result copied.') ? 'checkmark-outline' : 'copy-outline'
                        }
                        compact
                        disabled={!result}
                        onPress={() => {
                          void Clipboard.setStringAsync(result)
                            .then((ok) =>
                              setMessage(
                                ok
                                  ? t('Result copied.')
                                  : t('Select and hold the result to copy it.'),
                              ),
                            )
                            .catch(() => setMessage(t('Select and hold the result to copy it.')));
                        }}
                      />
                    </View>
                    {message === t('Result copied.') ? (
                      <Text accessibilityLiveRegion="polite" style={{ color: colors.green }}>
                        {message}
                      </Text>
                    ) : (
                      <ErrorText message={message} />
                    )}
                  </Card>
                  {['C ⌫ % ÷', '7 8 9 ×', '4 5 6 −', '1 2 3 +', '0 . ='].map((row) => (
                    <View key={row} style={{ flexDirection: 'row', gap: 8 }}>
                      {row.split(' ').map((key) => (
                        <Pressable
                          key={key}
                          accessibilityRole="button"
                          accessibilityLabel={
                            key === '⌫'
                              ? t('Backspace')
                              : key === 'C'
                                ? t('Clear calculation')
                                : key === '='
                                  ? t('Calculate result')
                                  : key
                          }
                          onPress={() => {
                            if (key === '=') solve();
                            else if (key === 'C') edit('');
                            else if (key === '⌫') edit(expression.slice(0, -1));
                            else if (expression.length < 100)
                              edit(
                                (result ? (/[+−×÷]/.test(key) ? result : '') : expression) + key,
                              );
                          }}
                          style={({ pressed }) => ({
                            flex: 1,
                            minHeight: 54,
                            padding: 12,
                            borderRadius: 14,
                            backgroundColor: key === '=' ? colors.green : colors.mint,
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: pressed ? 0.6 : 1,
                          })}
                        >
                          <Text
                            style={{ fontSize: 23, color: key === '=' ? colors.white : colors.ink }}
                          >
                            {key}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                  <Text style={styles.small}>
                    {' '}
                    {t(
                      '× and ÷ are calculated first. % divides a number by 100; use 500 × 10% for ten percent of 500.',
                    )}{' '}
                  </Text>
                </View>
              </Page>
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  width: '100%',
                  maxWidth: 460,
                  alignSelf: 'center',
                  borderTopWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Button title={t('Done')} onPress={close} />
              </View>
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>
      )}
    </>
  );
}
