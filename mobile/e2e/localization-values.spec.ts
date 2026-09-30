import { expect, test } from '@playwright/test';
import { original, setLanguage, t } from '../src/i18n';
import { auditAction, auditValues } from '../src/financial/audit';
import { modeLabels, transactionTypes } from '../src/financial/types';

test('dynamic labels and audit values translate without altering user content or losing totals', () => {
  try {
    for (const language of ['en', 'hi', 'mr'] as const) {
      setLanguage(language);
      expect(modeLabels.BILLING).toBe(t('Use billing totals'));
      expect(transactionTypes.find((item) => item.type === 'CASH_SALE')?.label).toBe(
        t('Cash sales'),
      );
      expect(auditAction('DELETE_TRANSACTION')).toBe(t('Transaction deleted'));
      expect(original(t('Amount (₹)'))).toBe('Amount (₹)');
      const result = auditValues({
        reported_sales: {
          total_sales: '123.45',
          cash_sales: '100.45',
          digital_sales: '20.00',
          credit_sales: '3.00',
        },
        billing_input: 'SPLIT',
        description: 'Original user description',
        type: 'CASH_SALE',
      });
      for (const value of [
        '123.45',
        '100.45',
        '20.00',
        '3.00',
        'Original user description',
        t('Split totals'),
        t('Cash sales'),
      ]) {
        expect(result).toContain(value);
      }
      expect(result).not.toContain('CASH_SALE');
      expect(result).not.toContain('SPLIT');
    }
  } finally {
    setLanguage('en');
  }
});
