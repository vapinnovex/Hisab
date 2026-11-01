import React from 'react';
import { Text } from 'react-native';
import { t } from '../i18n';
import { moneyTones, MoneyTone } from './moneyTone';
export function MoneyFlow({ tone }: { tone: MoneyTone }) {
  const palette = moneyTones[tone];
  const label = {
    in: t('Shop money in'),
    out: t('Shop money out'),
    pending: t('Credit / pending — no money received'),
    transfer: t('Cash transfer — not an expense'),
    neutral: t('Reference only — no money movement'),
  }[tone];
  return (
    <Text
      style={{
        color: palette.ink,
        backgroundColor: palette.soft,
        borderRadius: 8,
        padding: 8,
        fontSize: 13,
        fontWeight: '600',
      }}
    >
      {palette.sign} {label}
    </Text>
  );
}
