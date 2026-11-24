// Every direction is from the shop's perspective. Credit is not received money.
export type MoneyTone = 'in' | 'out' | 'pending' | 'transfer' | 'neutral';
export const moneyTones = {
  in: { ink: '#145C45', soft: '#E8F0E8', sign: '+' },
  out: { ink: '#A53535', soft: '#FAEAEA', sign: '−' },
  pending: { ink: '#795611', soft: '#FFF1D6', sign: '◷' },
  transfer: { ink: '#245A91', soft: '#EAF1FA', sign: '↔' },
  neutral: { ink: '#53615A', soft: '#EDF0EE', sign: '·' },
} as const;
export function transactionTone(type: string): MoneyTone {
  if (['CREDIT_SALE', 'PURCHASE'].includes(type)) return 'pending';
  if (type === 'BANK_DEPOSIT') return 'transfer';
  if (
    ['EXPENSE', 'SUPPLIER_PAYMENT', 'WITHDRAWAL', 'SALARY', 'ADVANCE', 'OTHER_GIVEN'].includes(type)
  )
    return 'out';
  if (
    [
      'CASH_SALE',
      'DIGITAL_SALE',
      'OTHER_CASH_IN',
      'DUE_COLLECTION',
      'RECEIVED',
      'PURCHASE_PAYMENT',
    ].includes(type)
  )
    return 'in';
  return 'neutral';
}
