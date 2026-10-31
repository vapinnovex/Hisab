import React from 'react';
import { Text } from 'react-native';
import { t, useLocale } from '../i18n';
import { styles } from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { MoneyField } from '../financial/components';
import { parseMoney } from '../financial/money';
import { ReferenceSalary } from './types';
export const newSalary = (): ReferenceSalary => ({ amount: '', basis: 'MONTHLY' });
export const validSalary = (salary: ReferenceSalary) =>
  (parseMoney(salary.amount) ?? BigInt(0)) > BigInt(0);
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function SalaryFields({
  value,
  onChange,
}: {
  value: ReferenceSalary;
  onChange: (value: ReferenceSalary) => void;
}) {
  useLocale();
  return (
    <>
      <MoneyField
        label={t('Reference salary (₹)')}
        value={value.amount}
        onChange={(amount) => onChange({ ...value, amount })}
      />
      <FilterChips
        label={t('Salary basis')}
        value={value.basis}
        onChange={(basis) => onChange({ ...value, basis })}
        options={[
          { value: 'MONTHLY', label: t('Monthly') },
          { value: 'DAILY', label: t('Daily') },
        ]}
      />
      <Text style={styles.small}>
        {t('For reference only. Attendance does not calculate or deduct pay.')}
      </Text>
    </>
  );
}
