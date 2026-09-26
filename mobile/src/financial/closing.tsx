import React, { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../auth';
import { useAction } from '../hooks';
import { useUnsavedChanges } from '../pwa';
import { Button, Card, ErrorText, Field, styles } from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { Breakdown, Galla, MoneyField } from './components';
import { decimal, money, parseMoney, signedPaise } from './money';
import { Day, modeLabels } from './types';

export function CloseForm({ initial: loaded, done }: { initial: Day; done: () => void }) {
  const [initial] = useState(loaded);
  const { api, selected } = useAuth();
  const mode = initial.mode || 'ENTRIES';
  const [actual, setActual] = useState(initial.counted_cash || '');
  const previousClosing = initial.closing_snapshots.at(-1);
  const [billingInput, setBillingInput] = useState<'SPLIT' | 'TOTAL'>(
    previousClosing?.billing_input || 'SPLIT',
  );
  const [total, setTotal] = useState(previousClosing?.total_sales || '');
  const [knowNonCash, setKnowNonCash] = useState(
    previousClosing?.billing_input === 'TOTAL' && previousClosing.cash_sales !== null,
  );
  const totalOnly = mode === 'BILLING' && billingInput === 'TOTAL';
  const [cash, setCash] = useState(previousClosing?.cash_sales || '');
  const [digital, setDigital] = useState(previousClosing?.digital_sales || '0');
  const [credit, setCredit] = useState(previousClosing?.credit_sales || '0');
  const [bank, setBank] = useState(initial.closing_bank_deposit || '0');
  const [home, setHome] = useState(initial.closing_withdrawal || '0');
  const [differenceNote, setDifferenceNote] = useState('');
  const [notes, setNotes] = useState(initial.notes);
  const action = useAction();
  const [review, setReview] = useState(false);
  useUnsavedChanges(
    !!actual ||
      !!total ||
      billingInput !== (previousClosing?.billing_input || 'SPLIT') ||
      !!cash ||
      digital !== '0' ||
      credit !== '0' ||
      bank !== '0' ||
      home !== '0' ||
      !!differenceNote ||
      notes !== initial.notes,
  );
  const counted = parseMoney(actual);
  const bankValue = parseMoney(bank),
    homeValue = parseMoney(home);
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
        ? totalOnly
          ? knowNonCash && totalValue !== null && digitalSales !== null && creditSales !== null
            ? totalValue - digitalSales - creditSales
            : null
          : parseMoney(cash)
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
  const invalidSplit = totalOnly && knowNonCash && (cashSales === null || cashSales < BigInt(0));
  const sales = totalOnly
    ? totalValue
    : cashSales !== null && digitalSales !== null && creditSales !== null
      ? cashSales + digitalSales + creditSales
      : null;
  if (initial.status !== 'OPEN')
    return <Text style={styles.subtitle}>This day is already closed.</Text>;
  return (
    <>
      <Card>
        <Text style={styles.heading}>{modeLabels[mode]}</Text>
        <Text style={styles.subtitle}>
          {mode === 'COUNTED'
            ? 'First record every expense and cash movement. We will estimate net cash sales from the money you count. A shortage cannot be checked without a separate sales record.'
            : mode === 'BILLING'
              ? 'Copy today’s sales after returns, including any tax charged. Your report can show a grand total or a payment breakdown. Do not use bank settlement amounts after fees.'
              : 'Check that all sales, expenses and cash movements are recorded before counting.'}
        </Text>
        {mode === 'BILLING' && (
          <>
            <FilterChips
              label="Billing report"
              value={billingInput}
              onChange={setBillingInput}
              options={[
                { value: 'SPLIT', label: 'Payment breakdown' },
                { value: 'TOTAL', label: 'Total sales only' },
              ]}
            />
            {totalOnly ? (
              <>
                <MoneyField label="Total sales from billing" value={total} onChange={setTotal} />
                <Text style={styles.label}>UPI/card and unpaid credit totals</Text>
                <FilterChips
                  label="Non-cash sales"
                  value={knowNonCash ? 'KNOWN' : 'UNKNOWN'}
                  onChange={(value) => {
                    setKnowNonCash(value === 'KNOWN');
                    if (value === 'KNOWN' && !knowNonCash) {
                      setDigital('');
                      setCredit('');
                    }
                  }}
                  options={[
                    { value: 'UNKNOWN', label: 'Not known' },
                    { value: 'KNOWN', label: 'I know the totals' },
                  ]}
                />
                <Text style={styles.small}>
                  If known, use UPI/card payments for today’s sales and today’s unpaid credit. Cash
                  sales = total sales − UPI/card − unpaid credit. Separate UPI and card amounts are
                  not required.
                </Text>
              </>
            ) : (
              <MoneyField label="Cash sales from billing" value={cash} onChange={setCash} />
            )}
          </>
        )}
        {mode !== 'ENTRIES' && (!totalOnly || knowNonCash) && (
          <>
            <MoneyField label="UPI / card sales" value={digital} onChange={setDigital} />
            <MoneyField label="Credit sales still unpaid" value={credit} onChange={setCredit} />
            <Text style={styles.small}>
              Enter 0 if none. These totals do not add cash to the galla. Exclude owner top-ups and
              collections of older dues from today’s sales.
            </Text>
          </>
        )}
        {totalOnly && knowNonCash && cashSales !== null && cashSales >= BigInt(0) && (
          <Text style={styles.heading}>Calculated cash sales · {money(decimal(cashSales))}</Text>
        )}
      </Card>
      <Button
        title={review ? 'Hide recorded totals' : 'Review recorded totals'}
        secondary
        onPress={() => setReview(!review)}
      />
      {review && <Breakdown day={initial} />}
      <Card>
        <Text style={styles.heading}>1. Count your cash</Text>
        <Text style={styles.small}>
          Count before the closing transfers below. Cash already removed during the day must have
          its own bank deposit or withdrawal entry.
        </Text>
        <MoneyField label="Actual cash in galla" value={actual} onChange={setActual} />
        {mode === 'COUNTED' ? (
          <>
            <Text style={styles.heading}>
              Estimated cash sales · {cashSales === null ? '—' : money(decimal(cashSales))}
            </Text>
            <Text style={styles.small}>
              Cash counted − opening − other cash in + cash expenses + supplier payments + cash
              already removed. This is an estimate, not a verified cash difference.
            </Text>
          </>
        ) : totalOnly && !knowNonCash ? (
          <Text style={styles.subtitle}>
            Your sales total and cash count will be saved. A cash shortage or surplus cannot be
            checked without knowing how much of your sales was cash.
          </Text>
        ) : (
          <Galla
            expected={expectedBefore === null ? null : decimal(expectedBefore)}
            difference={difference}
          />
        )}
        {sales !== null && (
          <Text style={styles.heading}>
            Day’s sales · {money(decimal(sales))}
            {mode === 'COUNTED' ? ' (includes estimate)' : ''}
          </Text>
        )}
      </Card>
      {needsNote && (
        <>
          <FilterChips
            label="Difference reason"
            options={['Cash shortage', 'Extra cash found', 'Entry missing', 'Other'].map(
              (label) => ({ value: label, label }),
            )}
            value={differenceNote}
            onChange={setDifferenceNote}
          />
          <Field
            label="Difference note"
            value={differenceNote}
            onChangeText={setDifferenceNote}
            maxLength={500}
          />
        </>
      )}
      <Card>
        <Text style={styles.heading}>2. Decide what stays in the galla</Text>
        <Text style={styles.small}>
          Only enter cash you are removing now. Leave 0 if it is just a plan for later. Do not
          repeat transfers already recorded above.
        </Text>
        <MoneyField label="Cash removed for bank at closing" value={bank} onChange={setBank} />
        <MoneyField label="Cash taken home at closing" value={home} onChange={setHome} />
        <Text style={styles.heading}>
          Cash kept for next day · {retained === null ? '—' : money(decimal(retained))}
        </Text>
        <Text style={styles.small}>
          These are transfers of cash, not expenses or reductions in sales.
        </Text>
      </Card>
      <Field
        label="Day notes (optional)"
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1000}
      />
      <ErrorText
        message={
          badEstimate
            ? 'The count implies negative cash sales. Review opening cash, expenses and cash movements.'
            : invalidSplit
              ? 'Enter both non-cash totals. Together they cannot exceed total sales.'
              : transferError
                ? 'You cannot remove more cash than you counted.'
                : action.error
        }
      />
      <Button
        title="Close today’s Hishob"
        busy={action.busy}
        disabled={
          counted === null ||
          retained === null ||
          sales === null ||
          badEstimate ||
          invalidSplit ||
          transferError ||
          (needsNote && differenceNote.trim().length < 2)
        }
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${initial.id}/close`,
              {
                revision: initial.revision,
                actual_closing_cash: actual.trim(),
                notes,
                difference_note: differenceNote,
                closing_bank_deposit: bank,
                closing_withdrawal: home,
                ...(mode !== 'ENTRIES' && (!totalOnly || knowNonCash)
                  ? { digital_sales: digital, credit_sales: credit }
                  : {}),
                ...(mode === 'BILLING'
                  ? totalOnly
                    ? { billing_input: 'TOTAL', total_sales: total }
                    : { billing_input: 'SPLIT', cash_sales: cash }
                  : {}),
              },
              'POST',
            );
            done();
          })
        }
      />
      <Text style={styles.small}>
        Closing preserves these totals and the cash kept for tomorrow. Only the owner can reopen a
        day, with a reason. Changes made elsewhere require a refresh before closing.
      </Text>
    </>
  );
}
