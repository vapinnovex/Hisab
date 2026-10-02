import { t, useLocale } from './../i18n';
import { dateInZone } from './calendar';
import { Calculator } from './Calculator';
import { HelpButton as Button, FinancialHelp } from './help';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../auth';
import { useAction } from '../hooks';
import { useUnsavedChanges } from '../pwa';
import { Card, ErrorText, Field, styles } from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { Breakdown, Galla, MoneyField } from './components';
import { decimal, money, parseMoney, signedPaise } from './money';
import { Day, modeLabels } from './types';

export function CloseForm({ initial: loaded, done }: { initial: Day; done: () => void }) {
  useLocale();
  const [initial] = useState(loaded);
  const { api, selected } = useAuth();
  const isToday = initial.date === dateInZone(initial.timezone);
  const mode = initial.mode || 'ENTRIES';
  const [actual, setActual] = useState(initial.counted_cash || '');
  const previousClosing = initial.closing_snapshots.at(-1);
  const [total, setTotal] = useState(previousClosing?.total_sales || '');
  const [knowNonCash, setKnowNonCash] = useState(
    previousClosing ? previousClosing.digital_sales !== null : true,
  );
  const totalOnly = mode === 'BILLING';
  const [digital, setDigital] = useState(previousClosing?.digital_sales || '0');
  const entryCredit = initial.transactions.reduce((sum, entry) => {
    if (entry.deleted) return sum;
    if (entry.type === 'CREDIT_SALE') return sum + signedPaise(entry.amount);
    if (entry.type === 'DUE_COLLECTION' && entry.due_date === initial.date)
      return sum - signedPaise(entry.amount);
    return sum;
  }, BigInt(0));
  const legacyCredit = signedPaise(initial.legacy_credit_sales || '0');
  const credit = decimal(entryCredit + legacyCredit);
  const [bank, setBank] = useState(
    Number(initial.closing_bank_deposit) ? initial.closing_bank_deposit! : '',
  );
  const [home, setHome] = useState(
    Number(initial.closing_withdrawal) ? initial.closing_withdrawal! : '',
  );
  const [differenceNote, setDifferenceNote] = useState('');
  const [notes, setNotes] = useState(initial.notes);
  const action = useAction();
  const [review, setReview] = useState(false);
  useUnsavedChanges(
    !!actual ||
      !!total ||
      digital !== '0' ||
      !!bank ||
      !!home ||
      !!differenceNote ||
      notes !== initial.notes,
  );
  const counted = parseMoney(actual);
  const bankValue = parseMoney(bank || '0'),
    homeValue = parseMoney(home || '0');
  const expenses = signedPaise(initial.cash_expenses ?? initial.expenses_total);
  const suppliers = signedPaise(initial.cash_supplier_payments ?? initial.supplier_payments);
  const earlierTransfers =
    signedPaise(initial.bank_deposit) +
    signedPaise(initial.withdrawals) -
    signedPaise(initial.closing_bank_deposit || '0') -
    signedPaise(initial.closing_withdrawal || '0');
  const base =
    signedPaise(initial.opening_cash) +
    signedPaise(initial.other_cash_in) -
    expenses -
    suppliers -
    earlierTransfers;
  const totalValue = parseMoney(total);
  const digitalSales =
    mode === 'ENTRIES' ? signedPaise(initial.digital_sales || '0') : parseMoney(digital);
  const creditSales =
    mode === 'ENTRIES' ? signedPaise(initial.credit_sales || '0') : parseMoney(credit);
  const cashSales =
    mode === 'ENTRIES'
      ? signedPaise(initial.cash_sales || '0')
      : mode === 'BILLING'
        ? knowNonCash && totalValue !== null && digitalSales !== null && creditSales !== null
          ? totalValue - digitalSales - creditSales
          : null
        : counted === null
          ? null
          : counted - base;
  const expectedBefore = mode === 'COUNTED' || cashSales === null ? null : base + cashSales;
  const differenceValue =
    counted !== null && expectedBefore !== null ? counted - expectedBefore : null;
  const difference = differenceValue === null ? null : decimal(differenceValue);
  const retained =
    counted !== null && bankValue !== null && homeValue !== null
      ? counted - bankValue - homeValue
      : null;
  const needsNote = differenceValue !== null && differenceValue !== BigInt(0);
  const badEstimate = mode === 'COUNTED' && cashSales !== null && cashSales < BigInt(0);
  const transferError = retained !== null && retained < BigInt(0);
  const invalidSplit = totalOnly && knowNonCash && cashSales !== null && cashSales < BigInt(0);
  const sales = totalOnly
    ? totalValue
    : cashSales !== null && digitalSales !== null && creditSales !== null
      ? cashSales + digitalSales + creditSales
      : null;
  const closingIssues = [
    counted === null && t('Enter the actual cash counted. Enter 0 if the galla is empty.'),
    totalOnly &&
      totalValue === null &&
      t('Enter total sales from billing. Enter 0 if there were no sales.'),
    mode !== 'ENTRIES' &&
      (!totalOnly || knowNonCash) &&
      digitalSales === null &&
      t('Enter UPI / card sales. Enter 0 if there were none.'),
    bankValue === null && t('Enter a valid bank transfer amount or leave it blank.'),
    homeValue === null && t('Enter a valid take-home amount or leave it blank.'),
    badEstimate && t('Review the cash count and movements: estimated cash sales are negative.'),
    invalidSplit &&
      t('Check billing total and UPI/card sales: payments cannot exceed total sales.'),
    transferError && t('Reduce bank/home withdrawals: they exceed the cash counted.'),
    needsNote &&
      differenceNote.trim().length < 2 &&
      t('Choose a difference reason or write a note of at least 2 characters.'),
  ].filter((issue): issue is string => typeof issue === 'string');
  if (
    closingIssues.length === 0 &&
    (retained === null || sales === null || (totalOnly && knowNonCash && cashSales === null))
  ) {
    closingIssues.push(t('Review recorded totals before closing.'));
  }
  if (initial.status !== 'OPEN')
    return <Text style={styles.subtitle}>{t('This day is already closed.')}</Text>;
  return (
    <>
      <Calculator />
      <Card>
        <Text style={styles.heading}>{modeLabels[mode]}</Text>
        <Text style={styles.subtitle}>
          {mode === 'COUNTED'
            ? t(
                'First record every expense and cash movement. We will estimate net cash sales from the money you count. A shortage cannot be checked without a separate sales record.',
              )
            : mode === 'BILLING'
              ? t(
                  'Enter the billing machine’s grand total, including unpaid sales and tax charged, after returns. If your report gives separate payment amounts, add them to obtain this total.',
                )
              : t(
                  'Check that all sales, expenses and cash movements are recorded before counting.',
                )}
        </Text>
        {mode === 'BILLING' && (
          <>
            <MoneyField label={t('Total sales from billing')} value={total} onChange={setTotal} />
            <FinancialHelp topic={t('Non-cash sales')} />
            <FilterChips
              label={t('Non-cash sales')}
              value={knowNonCash ? 'KNOWN' : 'UNKNOWN'}
              onChange={(value) => setKnowNonCash(value === 'KNOWN')}
              options={[
                { value: 'KNOWN', label: t('I know the totals') },
                { value: 'UNKNOWN', label: t('Not known') },
              ]}
            />
            <Text style={styles.small}>
              {' '}
              {t(
                'Cash sales = billing total − UPI/card sales − this day’s remaining unpaid sales.',
              )}{' '}
            </Text>
          </>
        )}
        {mode !== 'ENTRIES' && (!totalOnly || knowNonCash) && (
          <>
            <MoneyField
              error={invalidSplit ? 'UPI/card and unpaid sales exceed the billing total.' : ''}
              label={t('UPI / card sales')}
              value={digital}
              onChange={setDigital}
            />
            <Text style={styles.small}>
              {' '}
              {t(
                'Include payments collected for this day’s sales. Exclude collections of older dues and owner transfers. Enter 0 if none.',
              )}{' '}
            </Text>
          </>
        )}
        <Text style={styles.heading}>
          {isToday ? t('Today’s unpaid sales') : t('This day’s unpaid sales')} · {money(credit)}
        </Text>
        <Text style={styles.small}>
          {' '}
          {t(
            'Calculated from unpaid-sale transactions, less payments collected for them on this date. Older customer dues are not part of this day’s sales. To add or correct an unpaid sale, return to the day before closing.',
          )}{' '}
        </Text>
        {legacyCredit > BigInt(0) && (
          <Text style={styles.small}>
            {' '}
            {t('Includes')} {money(decimal(legacyCredit))}{' '}
            {t(
              'from an older closing entered as a total. This amount is preserved but has no individual customer records in the dues register.',
            )}{' '}
          </Text>
        )}
        {totalOnly && knowNonCash && cashSales !== null && cashSales >= BigInt(0) && (
          <Text style={styles.heading}>
            {t('Calculated cash sales ·')} {money(decimal(cashSales))}
          </Text>
        )}
      </Card>
      <Button
        title={review ? t('Hide recorded totals') : t('Review recorded totals')}
        secondary
        onPress={() => setReview(!review)}
      />
      {review && <Breakdown day={initial} />}
      <Card>
        <Text style={styles.heading}>{t('1. Count your cash')}</Text>
        <Text style={styles.small}>
          {' '}
          {t(
            'Count before the closing transfers below. Cash already removed during the day must have its own bank deposit or withdrawal entry.',
          )}{' '}
        </Text>
        <MoneyField
          error={badEstimate ? t('Review this cash count and the recorded cash movements.') : ''}
          label={t('Actual cash in galla')}
          value={actual}
          onChange={setActual}
        />
        {mode === 'COUNTED' ? (
          <>
            <Text style={styles.heading}>
              {' '}
              {t('Estimated cash sales ·')} {cashSales === null ? '—' : money(decimal(cashSales))}
            </Text>
            <Text style={styles.small}>
              {' '}
              {t(
                'Cash counted − opening − other cash in + cash expenses + supplier payments + cash already removed. This is an estimate, not a verified cash difference.',
              )}{' '}
            </Text>
          </>
        ) : totalOnly && !knowNonCash ? (
          <Text style={styles.subtitle}>
            {' '}
            {t(
              'Your sales total and cash count will be saved. A cash shortage or surplus cannot be checked without knowing how much of your sales was cash.',
            )}{' '}
          </Text>
        ) : (
          <Galla
            expected={expectedBefore === null ? null : decimal(expectedBefore)}
            difference={difference}
          />
        )}
        {sales !== null && (
          <Text style={styles.heading}>
            {' '}
            {t('Day’s sales ·')} {money(decimal(sales))}
            {mode === 'COUNTED' ? t(' (includes estimate)') : ''}
          </Text>
        )}
      </Card>
      {needsNote && (
        <>
          <FilterChips
            label={t('Difference reason')}
            options={[
              t('Cash shortage'),
              t('Extra cash found'),
              t('Entry missing'),
              t('Other'),
            ].map((label) => ({ value: label, label }))}
            value={differenceNote}
            onChange={setDifferenceNote}
          />
          <Field
            required
            minLength={2}
            label={t('Difference note')}
            value={differenceNote}
            onChangeText={setDifferenceNote}
            maxLength={500}
          />
        </>
      )}
      <Card>
        <Text style={styles.heading}>{t('2. Decide what stays in the galla')}</Text>
        <Text style={styles.small}>
          {' '}
          {t(
            'Only enter cash you are removing now. Leave blank if you are not removing cash now. Do not repeat transfers already recorded above.',
          )}{' '}
        </Text>
        <MoneyField
          required={false}
          error={transferError ? t('Bank and home amounts cannot exceed the cash counted.') : ''}
          label={t('Cash removed for bank at closing')}
          value={bank}
          onChange={setBank}
        />
        <MoneyField
          required={false}
          label={t('Cash taken home at closing')}
          value={home}
          onChange={setHome}
        />
        <Text style={styles.heading}>
          {' '}
          {t('Cash kept for next day ·')} {retained === null ? '—' : money(decimal(retained))}
        </Text>
        <Text style={styles.small}>
          {' '}
          {t('These are transfers of cash, not expenses or reductions in sales.')}{' '}
        </Text>
      </Card>
      <Field
        label={t('Day notes (optional)')}
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1000}
      />
      {closingIssues.length > 0 && (
        <Card>
          <Text style={styles.heading}>{t('Before you close')}</Text>
          {closingIssues.map((issue) => (
            <Text key={issue} style={styles.subtitle}>
              • {issue}
            </Text>
          ))}
        </Card>
      )}
      <ErrorText message={action.error} />
      <Button
        title={isToday ? t('Close today’s Hishob') : t('Close Hishob · {0}', [initial.date])}
        busy={action.busy}
        validationMessage={closingIssues[0]}
        disabled={closingIssues.length > 0}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${initial.id}/close`,
              {
                revision: initial.revision,
                actual_closing_cash: actual.trim(),
                notes,
                difference_note: differenceNote,
                closing_bank_deposit: bank || '0',
                closing_withdrawal: home || '0',
                ...(mode !== 'ENTRIES' && (!totalOnly || knowNonCash)
                  ? { digital_sales: digital, credit_sales: credit }
                  : {}),
                ...(mode === 'BILLING' ? { billing_input: 'TOTAL', total_sales: total } : {}),
              },
              'POST',
            );
            done();
          })
        }
      />
      <Text style={styles.small}>
        {' '}
        {t(
          'Closing preserves these totals and the cash kept for tomorrow. Only the owner can reopen a day, with a reason. Changes made elsewhere require a refresh before closing.',
        )}{' '}
      </Text>
    </>
  );
}
