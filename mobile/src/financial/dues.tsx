import { t, useLocale } from './../i18n';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { useUnsavedChanges } from '../pwa';
import { Button, Card, ErrorText, Field, Heading, Loading, Page, styles } from '../components/ui';
import { FilterChips, SearchField } from '../components/ListControls';
import { InfoHelp } from '../components/InfoHelp';
import { MoneyField, timestamp } from './components';
import { money, parseMoney } from './money';
import { Entry, TodayHishob } from './types';
import { Routes } from '../types';

type Due = {
  source_day_id: string;
  entry_id: string;
  date: string;
  customer_name: string;
  description: string;
  amount: string;
  paid_amount: string;
  remaining_amount: string;
  payments: (Entry & { receipt_sequence: number; date: string })[];
};
type Register = {
  items: Due[];
  summary: { total: number; amount: string; paid_amount: string; remaining_amount: string };
  has_more: boolean;
};

function ReceivePayment({
  due,
  today,
  done,
  cancel,
}: {
  due: Due;
  today: TodayHishob;
  done: () => Promise<void>;
  cancel: () => void;
}) {
  useLocale();
  const { api, selected } = useAuth();
  const [amount, setAmount] = useState(due.remaining_amount);
  const [payment, setPayment] = useState<'CASH' | 'DIGITAL'>('CASH');
  const [note, setNote] = useState('');
  const [requestId] = useState(
    () => `receipt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const action = useAction();
  useUnsavedChanges(true);
  const value = parseMoney(amount);
  return (
    <Card>
      <Text style={styles.heading}>
        {t('Receive payment ·')} {due.customer_name || due.description}
      </Text>
      <Text style={styles.small}>
        {' '}
        {t('Remaining')} {money(due.remaining_amount)} {t('· Receipt date')} {today.date}
        {t(
          '. Record only money actually received. Partial payments leave the remaining balance open. Check the amount and method: saved receipts cannot be edited or deleted.',
        )}{' '}
      </Text>
      <MoneyField label={t('Payment received (₹)')} value={amount} onChange={setAmount} />
      <FilterChips
        label={t('Received by')}
        value={payment}
        onChange={setPayment}
        options={[
          { value: 'CASH', label: t('Cash') },
          { value: 'DIGITAL', label: t('UPI / card / bank') },
        ]}
      />
      <Field
        label={t('Payment note (optional)')}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        placeholder={t('e.g. UPI reference or receipt note')}
      />
      <Text style={styles.small}>
        {payment === 'CASH'
          ? t('Cash is added to today’s galla automatically. Do not add another cash-in entry.')
          : t('This is recorded as a digital receipt and does not change physical cash.')}{' '}
        {due.date === today.date
          ? t(
              'This reduces today’s unpaid sales. Include a digital payment in today’s UPI/card sales total at closing.',
            )
          : t(
              'This pays an older sale and does not increase today’s sales. Exclude it from today’s UPI/card sales total.',
            )}
      </Text>
      <ErrorText message={action.error} />
      <Button
        validationMessage={
          value !== null && value > (parseMoney(due.remaining_amount) ?? BigInt(0))
            ? t('Payment cannot exceed the remaining due.')
            : undefined
        }
        title={t('Confirm payment received')}
        busy={action.busy}
        disabled={
          !today.day ||
          today.day.status !== 'OPEN' ||
          value === null ||
          value <= BigInt(0) ||
          value > (parseMoney(due.remaining_amount) ?? BigInt(0))
        }
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${today.day!.id}/due-payments`,
              {
                revision: today.day!.revision,
                source_day_id: due.source_day_id,
                entry_id: due.entry_id,
                amount,
                payment_method: payment,
                note,
                request_id: requestId,
              },
              'POST',
            );
            await done();
          })
        }
      />
      <Button title={t('Cancel payment')} secondary disabled={action.busy} onPress={cancel} />
    </Card>
  );
}

export function CustomerDues({ navigation }: NativeStackScreenProps<Routes, 'CustomerDues'>) {
  useLocale();
  const { selected } = useAuth();
  const [status, setStatus] = useState<'OPEN' | 'PAID' | 'ALL'>('OPEN');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [collecting, setCollecting] = useState<Due | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const resource = useResource<Register>(
    `/shops/${selected!.shop_id}/hishob/dues?status=${status}&q=${encodeURIComponent(query.trim())}&page=${page}`,
    true,
  );
  const today = useResource<TodayHishob>(`/shops/${selected!.shop_id}/hishob/today`, true);
  const canAdd = selected!.permissions.add_hishob_transactions;
  const open = today.data?.day?.status === 'OPEN';
  const refresh = async () => {
    await Promise.all([resource.refresh(), today.refresh()]);
  };
  return (
    <Page refresh={refresh}>
      <Heading
        title={t('Customer dues')}
        subtitle={t('Unpaid sales, payments received and what is still owed.')}
      />
      <InfoHelp title={t('How customer dues work')}>
        {t(
          'Record each unpaid sale once, including the customer or bill reference. It remains open until fully paid. Receive partial or full payments by cash or UPI/card; every receipt is saved. Older manually entered closing totals have no customer detail and are not included in this register.',
        )}
      </InfoHelp>
      {canAdd &&
        (open ? (
          <Button
            title={t('Add unpaid sale')}
            onPress={() =>
              navigation.navigate('HishobTransaction', {
                dayId: today.data!.day!.id,
                initialType: 'CREDIT_SALE',
              })
            }
          />
        ) : (
          <Button
            secondary
            title={t('Open today’s Hishob to record payments')}
            onPress={() => navigation.navigate('HishobToday')}
          />
        ))}
      <Text style={styles.small}>
        {' '}
        {t(
          'To mark a due as paid, choose Receive payment on the customer’s card, enter the amount, choose Cash or UPI / card / bank, then confirm. Full payment moves it to Paid automatically.',
        )}{' '}
      </Text>
      <SearchField
        label={t('Search customer dues')}
        placeholder={t('Customer name or description')}
        value={query}
        onChange={(value) => {
          setQuery(value);
          setPage(1);
        }}
      />
      <FilterChips
        label={t('Customer dues status')}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        options={[
          { value: 'OPEN', label: t('Unpaid / partial') },
          { value: 'PAID', label: t('Paid') },
          { value: 'ALL', label: t('All') },
        ]}
      />
      <ErrorText message={resource.error || today.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <Card>
          <Text style={styles.heading}>
            {' '}
            {t('Remaining ·')} {money(resource.data.summary.remaining_amount)}
          </Text>
          <Text style={styles.small}>
            {resource.data.summary.total} {t('matching entries · Original')}{' '}
            {money(resource.data.summary.amount)} {t('· Received')}{' '}
            {money(resource.data.summary.paid_amount)}
          </Text>
        </Card>
      )}
      {collecting && today.data && (
        <ReceivePayment
          key={`${collecting.source_day_id}:${collecting.entry_id}`}
          due={collecting}
          today={today.data}
          cancel={() => setCollecting(null)}
          done={async () => {
            setCollecting(null);
            await refresh();
          }}
        />
      )}
      {resource.data?.items.map((due) => {
        const key = `${due.source_day_id}:${due.entry_id}`;
        const paid = parseMoney(due.remaining_amount) === BigInt(0);
        return (
          <Card key={key}>
            <View style={styles.row}>
              <Text style={styles.heading}>{due.customer_name || t('Customer / bill')}</Text>
              <Text style={styles.eyebrow}>
                {paid
                  ? 'PAID'
                  : parseMoney(due.paid_amount) === BigInt(0)
                    ? 'UNPAID'
                    : t('PART PAID')}
              </Text>
            </View>
            <Text style={styles.small}>
              {due.date} · {due.description}
            </Text>
            <Text style={styles.heading}>
              {t('Due')} {money(due.remaining_amount)}
            </Text>
            <Text style={styles.small}>
              {' '}
              {t('Sale')} {money(due.amount)} {t('· Received')} {money(due.paid_amount)}
            </Text>
            {canAdd && !paid && open && !collecting && (
              <Button
                title={t('Receive payment · {0}', [due.customer_name || due.description])}
                onPress={() => setCollecting(due)}
              />
            )}
            <Button
              secondary
              title={t('Payment history · {0}', [due.customer_name || due.description])}
              onPress={() => setExpanded(expanded === key ? null : key)}
            />
            {expanded === key &&
              (due.payments.length ? (
                [...due.payments]
                  .sort((a, b) => a.receipt_sequence - b.receipt_sequence)
                  .map((receipt) => (
                    <View key={receipt.id} style={{ gap: 4 }}>
                      <Text style={styles.label}>
                        {money(receipt.amount)} ·{' '}
                        {receipt.payment_method === 'CASH' ? t('Cash') : t('UPI / card / bank')}
                      </Text>
                      <Text style={styles.small}>
                        {timestamp(receipt.created_at, selected!.shop.timezone)} ·{' '}
                        {receipt.created_by.name}
                      </Text>
                      {!!receipt.note && <Text style={styles.small}>{receipt.note}</Text>}
                    </View>
                  ))
              ) : (
                <Text style={styles.small}>{t('No payments received yet.')}</Text>
              ))}
            <Button
              secondary
              title={t('View original day')}
              onPress={() => navigation.navigate('HishobDetails', { dayId: due.source_day_id })}
            />
          </Card>
        );
      })}
      {resource.data?.items.length === 0 && (
        <Text style={styles.subtitle}>{t('No customer dues match this filter.')}</Text>
      )}
      <View style={styles.row}>
        {page > 1 && (
          <Button secondary title={t('Previous dues')} onPress={() => setPage(page - 1)} />
        )}
        {resource.data?.has_more && (
          <Button secondary title={t('More dues')} onPress={() => setPage(page + 1)} />
        )}
      </View>
    </Page>
  );
}
