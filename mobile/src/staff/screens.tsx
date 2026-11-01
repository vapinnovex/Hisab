import { moneyTones, transactionTone } from '../components/moneyTone';
import { MoneyFlow } from '../components/MoneyFlow';
import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { t, useLocale, localized } from '../i18n';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { useUnsavedChanges } from '../pwa';
import { Routes } from '../types';
import {
  Avatar,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorText,
  Field,
  Heading,
  Loading,
  Page,
  styles,
} from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { MoneyField } from '../financial/components';
import { money, parseMoney } from '../financial/money';
import { dateInZone } from '../financial/calendar';
import { SaveRecovery } from '../financial/SaveRecovery';
import { newSalary, SalaryFields, validDate, validSalary } from './fields';
import { PaymentKind, StaffDay, StaffEntry, StaffHistory, StaffProfile } from './types';

const labels: Record<StaffEntry['kind'], string> = localized(() => ({
  SALARY: t('Salary paid'),
  ADVANCE: t('Advance given'),
  OTHER_GIVEN: t('Other money given'),
  RECEIVED: t('Money received'),
  PURCHASE: t('Shop purchase · unpaid'),
  PURCHASE_PAYMENT: t('Purchase payment received'),
  NOTE: t('Dated note'),
}));
const requestId = () => `staff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function StaffDetailsScreen({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'StaffDetails'>) {
  useLocale();
  const { selected, api, session } = useAuth();
  const target = route.params?.staffId || 'me';
  const path = `/shops/${selected!.shop_id}/staff/${target}`;
  const profile = useResource<StaffProfile>(path, true);
  const [page, setPage] = useState(1);
  const permitted = !!(profile.data?.can_view_payments || profile.data?.can_add_note);
  const history = useResource<StaffHistory>(
    `${path}/history?page=${page}&payments=${!!profile.data?.can_view_payments}`,
    true,
    permitted,
  );
  const [cancelling, setCancelling] = useState<StaffEntry | null>(null);
  const [reason, setReason] = useState('');
  const action = useAction();
  const data = profile.data;
  if (!data)
    return (
      <Page>
        <ErrorText message={profile.error} />
        {profile.loading ? (
          <Loading />
        ) : (
          <Button title={t('Retry')} onPress={() => void profile.refresh()} />
        )}
      </Page>
    );
  const worker = data.worker;
  const self = selected!.id === worker.id;
  const owner = session!.role === 'OWNER';
  const manager = worker.role === 'MANAGER';
  const salary = data.reference?.salary;
  const canEdit =
    !self && (manager ? selected!.permissions.manage_managers : selected!.permissions.edit_workers);
  const shortcuts: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }[] =
    [];
  if (
    selected!.shop.settings.attendance_enabled &&
    (!self || selected!.permissions.view_own_attendance)
  )
    shortcuts.push({
      label: t('Attendance'),
      icon: 'calendar-outline',
      onPress: () =>
        self
          ? navigation.navigate('MyAttendance')
          : navigation.navigate('WorkerHistory', { worker }),
    });
  if (self)
    shortcuts.push({
      label: t('Password & security'),
      icon: 'key-outline',
      onPress: () => navigation.navigate('PasswordSecurity'),
    });
  else if (
    owner ||
    (!manager &&
      (selected!.permissions.reset_worker_passwords ||
        (!worker.password_ready && selected!.permissions.add_workers)))
  )
    shortcuts.push({
      label: t('Password access'),
      icon: 'key-outline',
      onPress: () => navigation.navigate('StaffPasswordAccess', { worker }),
    });
  if (canEdit)
    shortcuts.push({
      label: t('Edit profile'),
      icon: 'create-outline',
      onPress: () => navigation.navigate('WorkerForm', { worker, kind: worker.role }),
    });
  return (
    <Page
      refresh={async () => {
        await profile.refresh();
        if (permitted) await history.refresh();
      }}
    >
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar name={worker.name} manager={manager} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.title}>{worker.name}</Text>
            <Text style={styles.small}>
              {manager ? t('Manager') : t('Worker')} · {worker.active ? t('Active') : t('Inactive')}
            </Text>
            <Text style={styles.small}>{worker.mobile}</Text>
          </View>
        </View>
        {worker.password_reset_requested && (
          <Text style={styles.small}>{t('Password reset requested')}</Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {shortcuts.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={item.onPress}
              style={{
                minHeight: 48,
                flexGrow: 1,
                flexBasis: '30%',
                borderRadius: 12,
                backgroundColor: colors.mint,
                padding: 10,
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons name={item.icon} color={colors.green} size={20} />
              <Text style={[styles.small, { textAlign: 'center', color: colors.green }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <ErrorText message={profile.error} />
      {data.can_view_payments && (
        <Card>
          <Text style={styles.eyebrow}>{t('REFERENCE SALARY')}</Text>
          <Text style={styles.heading}>
            {salary
              ? `${money(salary.amount)} · ${salary.basis === 'MONTHLY' ? t('Monthly') : t('Daily')}`
              : t('Not set')}
          </Text>
          <Text style={styles.small}>
            {t('For reference only. Attendance does not calculate or deduct pay.')}
          </Text>
          {data.can_manage_reference && (
            <Button
              secondary
              title={t('Edit reference salary')}
              onPress={() => navigation.navigate('StaffReference', { staffId: worker.id })}
            />
          )}
        </Card>
      )}
      <Heading
        title={data.can_view_payments ? t('Payments & notes') : t('Dated notes')}
        subtitle={t('A shared record of what was given, received or noted.')}
      />
      {data.can_record_payment && (
        <Button
          title={t('Record payment')}
          onPress={() =>
            navigation.navigate('StaffPayment', { staffId: worker.id, name: worker.name })
          }
        />
      )}
      {data.can_manage_reference && !data.can_record_payment && (
        <Text style={styles.small}>
          {t('Hishob access is also needed to record payments. Ask the owner to enable it.')}
        </Text>
      )}
      {data.can_add_note && (
        <Button
          secondary
          title={t('Add dated note')}
          onPress={() =>
            navigation.navigate('StaffNote', { staffId: worker.id, name: worker.name })
          }
        />
      )}
      {!permitted && (
        <Text style={styles.small}>{t('The owner controls access to this payment book.')}</Text>
      )}
      <ErrorText message={history.error || action.error} />
      {!!history.error && (
        <Button secondary title={t('Retry')} onPress={() => void history.refresh()} />
      )}
      {permitted && history.loading && !history.data && <Loading />}
      {history.data?.items.length === 0 && (
        <EmptyState
          title={t('No records yet')}
          description={t('Payments and dated notes will appear here.')}
        />
      )}
      {history.data?.items
        .filter((entry) => data.can_view_payments || entry.kind === 'NOTE')
        .map((entry) => (
          <Card key={entry.id}>
            <View style={{ gap: 5 }}>
              <Text style={styles.small}>
                {entry.date} · {labels[entry.kind]}
              </Text>
              {entry.amount !== undefined && (
                <Text
                  style={[
                    styles.heading,
                    {
                      color:
                        moneyTones[entry.deleted ? 'neutral' : transactionTone(entry.kind)].ink,
                    },
                    entry.deleted && { textDecorationLine: 'line-through' },
                  ]}
                >
                  {moneyTones[transactionTone(entry.kind)].sign} {money(entry.amount)}
                </Text>
              )}
            </View>
            {!entry.deleted && <MoneyFlow tone={transactionTone(entry.kind)} />}
            <Text style={styles.subtitle}>{entry.note}</Text>
            <Text style={styles.small}>
              {t('Recorded by {0}', [entry.actor_name])}
              {entry.payment_method && entry.kind !== 'PURCHASE'
                ? ` · ${entry.payment_method === 'CASH' ? t('Cash') : t('UPI / bank')}`
                : ''}
            </Text>
            {entry.deleted ? (
              <Text style={{ color: colors.red }}>
                {t('Cancelled')}
                {entry.cancellation?.reason ? ` · ${entry.cancellation.reason}` : ''}
              </Text>
            ) : (
              entry.kind !== 'NOTE' && (
                <Text style={styles.small}>{t('Included in Hishob · {0}', [entry.date])}</Text>
              )
            )}
            {entry.remaining_amount !== undefined && !entry.deleted && (
              <Text style={styles.label}>
                {t('Purchase due: {0}', [money(entry.remaining_amount)])}
              </Text>
            )}
            {data.can_record_payment &&
              !entry.deleted &&
              entry.remaining_amount &&
              (parseMoney(entry.remaining_amount) ?? BigInt(0)) > BigInt(0) && (
                <Button
                  secondary
                  title={t('Receive purchase payment')}
                  onPress={() =>
                    navigation.navigate('StaffPayment', {
                      staffId: worker.id,
                      name: worker.name,
                      purchase: {
                        sourceDayId: entry.day_id!,
                        entryId: entry.id,
                        remaining: entry.remaining_amount!,
                      },
                    })
                  }
                />
              )}
            {data.can_correct &&
              !entry.deleted &&
              entry.kind !== 'PURCHASE_PAYMENT' &&
              (entry.kind !== 'PURCHASE' || entry.remaining_amount === entry.amount) && (
                <Button
                  secondary
                  title={t('Cancel record')}
                  onPress={() => {
                    setCancelling(entry);
                    setReason('');
                  }}
                />
              )}
            {cancelling?.id === entry.id && (
              <View style={{ gap: 10 }}>
                <Text style={styles.small}>
                  {entry.kind === 'NOTE'
                    ? t('The original note remains visible with its cancellation reason.')
                    : t(
                        'Cancelling updates Hishob too. The day must be open; purchases with payments cannot be cancelled.',
                      )}
                </Text>
                <Field
                  label={t('Correction reason')}
                  value={reason}
                  onChangeText={setReason}
                  required
                  minLength={2}
                  maxLength={300}
                />
                <Button
                  title={t('Confirm cancellation')}
                  busy={action.busy}
                  disabled={reason.trim().length < 2}
                  onPress={() =>
                    void action.run(async () => {
                      if (entry.kind === 'NOTE')
                        await api(
                          `${path}/notes/${entry.id}/cancel`,
                          { revision: 1, reason },
                          'POST',
                        );
                      else
                        await api(
                          `/shops/${selected!.shop_id}/hishob/days/${entry.day_id}/transactions/${entry.id}/delete`,
                          { revision: entry.day_revision, reason },
                          'POST',
                        );
                      setCancelling(null);
                      await history.refresh();
                    })
                  }
                />
                <Button title={t('Keep record')} secondary onPress={() => setCancelling(null)} />
              </View>
            )}
          </Card>
        ))}
      {permitted && (
        <View style={{ gap: 8 }}>
          {page > 1 && (
            <Button
              secondary
              title={t('Newer records')}
              onPress={() => {
                setCancelling(null);
                setPage(page - 1);
              }}
            />
          )}
          {history.data?.has_more && (
            <Button
              secondary
              title={t('Older records')}
              onPress={() => {
                setCancelling(null);
                setPage(page + 1);
              }}
            />
          )}
        </View>
      )}
      {data.can_view_payments && !!history.data?.legacy.length && (
        <Card>
          <Text style={styles.heading}>{t('Earlier salary records')}</Text>
          <Text style={styles.small}>
            {t(
              'Preserved from the old salary book. These records were not added to Hishob and are not added again automatically.',
            )}
          </Text>
          {history.data.legacy.map((entry) => (
            <View key={entry.id} style={{ gap: 4 }}>
              <Text style={styles.label}>
                {entry.date} · {money(entry.amount)}
                {entry.void ? ` · ${t('Cancelled')}` : ''}
              </Text>
              <Text style={styles.small}>{entry.note}</Text>
            </View>
          ))}
        </Card>
      )}
    </Page>
  );
}

export function StaffPaymentScreen({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'StaffPayment'>) {
  useLocale();
  const { selected } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const [date, setDate] = useState(today);
  const path = `/shops/${selected!.shop_id}/staff/${route.params.staffId}`;
  const valid =
    validDate(date) &&
    date <= today &&
    date >=
      (selected!.shop.created_at
        ? dateInZone(selected!.shop.timezone, new Date(selected!.shop.created_at))
        : '2000-01-01');
  const resource = useResource<{ day: StaffDay | null }>(
    `${path}/day?for_date=${date}`,
    false,
    valid,
  );
  return (
    <Page>
      <Heading
        title={route.params.purchase ? t('Receive purchase payment') : t('Record payment')}
        subtitle={route.params.name}
      />
      {!route.params.purchase && (
        <Field
          label={t('Entry date')}
          required
          value={date}
          onChangeText={setDate}
          maxLength={10}
          placeholder="YYYY-MM-DD"
        />
      )}
      <Text style={styles.small}>
        {t('Saved once in this payment book and in Hishob. Choose the actual payment date.')}
      </Text>
      {!valid && <ErrorText message={t('Choose a valid date on or before today.')} />}
      <ErrorText message={resource.error} />
      {valid && resource.loading && <Loading />}
      {!!resource.error && (
        <Button secondary title={t('Retry')} onPress={() => void resource.refresh()} />
      )}
      {resource.data?.day?.status === 'OPEN' ? (
        <PaymentEditor
          key={resource.data.day.id}
          day={resource.data.day}
          path={path}
          purchase={route.params.purchase}
          done={() => navigation.goBack()}
        />
      ) : (
        valid &&
        resource.data && (
          <Card>
            <Text style={styles.heading}>
              {resource.data.day ? t('This Hishob day is closed') : t('Open Hishob first')}
            </Text>
            <Text style={styles.small}>
              {t(
                'Open the selected day in Hishob before recording money. Only the owner can reopen a closed day. You can still add a dated note from the staff page.',
              )}
            </Text>
            <Button
              title={t('Open Hishob')}
              onPress={() =>
                navigation.navigate('Hishob', {
                  screen: date === today ? 'HishobToday' : 'HishobHistory',
                })
              }
            />
          </Card>
        )
      )}
    </Page>
  );
}
function PaymentEditor({
  day,
  path,
  purchase,
  done,
}: {
  day: StaffDay;
  path: string;
  purchase?: { sourceDayId: string; entryId: string; remaining: string };
  done: () => void;
}) {
  const { api } = useAuth();
  const [revision] = useState(day.revision);
  const [id] = useState(requestId);
  const [kind, setKind] = useState<PaymentKind>('SALARY');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'DIGITAL'>('CASH');
  const [note, setNote] = useState('');
  const pending = useRef<object | null>(null);
  const [attempted, setAttempted] = useState(false);
  const action = useAction();
  useUnsavedChanges(!!amount || !!note);
  const amountValue = parseMoney(amount);
  const ready =
    amountValue !== null &&
    amountValue > BigInt(0) &&
    note.trim().length >= 2 &&
    (!purchase || amountValue <= (parseMoney(purchase.remaining) ?? BigInt(0)));
  return (
    <View style={{ gap: 16 }}>
      {!purchase && (
        <FilterChips
          label={t('Entry type')}
          value={kind}
          onChange={setKind}
          options={(
            ['SALARY', 'ADVANCE', 'OTHER_GIVEN', 'RECEIVED', 'PURCHASE'] as PaymentKind[]
          ).map((value) => ({ value, label: labels[value], tone: transactionTone(value) }))}
        />
      )}
      {purchase && (
        <Text style={styles.label}>{t('Purchase due: {0}', [money(purchase.remaining)])}</Text>
      )}
      <MoneyFlow tone={transactionTone(purchase ? 'PURCHASE_PAYMENT' : kind)} />
      <MoneyField
        tone={transactionTone(purchase ? 'PURCHASE_PAYMENT' : kind)}
        label={t('Amount (₹)')}
        value={amount}
        onChange={setAmount}
      />
      {kind !== 'PURCHASE' && (
        <FilterChips
          label={t('Payment method')}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'CASH', label: t('Cash') },
            { value: 'DIGITAL', label: t('UPI / bank') },
          ]}
        />
      )}
      <Text style={styles.small}>
        {purchase
          ? t('This reduces the selected purchase due and records the receipt in Hishob.')
          : kind === 'PURCHASE'
            ? t(
                'Records an unpaid sale. No cash moves. Receive its payment from this purchase later.',
              )
            : kind === 'RECEIVED'
              ? t(
                  'Money returned by this person, such as an advance repayment. To settle a shop purchase, use Receive purchase payment on that purchase.',
                )
              : t(
                  'Records money actually given. No salary balance or automatic deduction is calculated.',
                )}
      </Text>
      <Field
        label={t('What was this for?')}
        required
        minLength={2}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        multiline
      />
      <Text style={styles.small}>{t('The worker can see this record and its note.')}</Text>
      <ErrorText message={action.error} />
      {attempted && !!action.error && (
        <>
          <Text style={styles.small}>
            {t(
              'Retry uses the original details. Check the saved result before leaving or starting another record.',
            )}
          </Text>
          <SaveRecovery
            check={async () => {
              const result = await api<{ saved: boolean }>(`${path}/receipts/${id}`);
              if (result.saved) done();
              return result.saved;
            }}
          />
        </>
      )}
      <Button
        tone={transactionTone(purchase ? 'PURCHASE_PAYMENT' : kind)}
        title={attempted && action.error ? t('Retry original save') : t('Save payment')}
        busy={action.busy}
        disabled={!attempted && !ready}
        onPress={() =>
          void action.run(async () => {
            if (!pending.current)
              pending.current = purchase
                ? {
                    revision,
                    request_id: id,
                    source_day_id: purchase.sourceDayId,
                    entry_id: purchase.entryId,
                    amount,
                    payment_method: method,
                    note,
                  }
                : {
                    day_id: day.id,
                    revision,
                    request_id: id,
                    kind,
                    amount,
                    payment_method: kind === 'PURCHASE' ? 'CASH' : method,
                    note,
                  };
            setAttempted(true);
            await api(
              purchase ? `${path}/days/${day.id}/purchase-payments` : `${path}/payments`,
              pending.current,
              'POST',
            );
            done();
          })
        }
      />
    </View>
  );
}

export function StaffNoteScreen({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'StaffNote'>) {
  useLocale();
  const { selected, api } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [id] = useState(requestId);
  const pending = useRef<object | null>(null);
  const [attempted, setAttempted] = useState(false);
  const action = useAction();
  const path = `/shops/${selected!.shop_id}/staff/${route.params.staffId}`;
  useUnsavedChanges(!!note);
  return (
    <Page>
      <Heading title={t('Add dated note')} subtitle={route.params.name} />
      <Text style={styles.small}>
        {t('Shared with the worker. This note does not change Hishob or move money.')}
      </Text>
      <Field
        label={t('Note date')}
        value={date}
        onChangeText={setDate}
        required
        maxLength={10}
        placeholder="YYYY-MM-DD"
      />
      <Field
        label={t('Note')}
        value={note}
        onChangeText={setNote}
        required
        multiline
        minLength={2}
        maxLength={1000}
      />
      <ErrorText message={action.error} />
      {!!action.error && (
        <SaveRecovery
          check={async () => {
            const result = await api<{ saved: boolean }>(`${path}/receipts/${id}`);
            if (result.saved) navigation.goBack();
            return result.saved;
          }}
        />
      )}
      <Button
        tone="neutral"
        title={attempted && action.error ? t('Retry original save') : t('Save note')}
        busy={action.busy}
        disabled={
          !attempted &&
          (!validDate(date) || date > today || date < '2000-01-01' || note.trim().length < 2)
        }
        onPress={() =>
          void action.run(async () => {
            setAttempted(true);
            pending.current ||= { date, note, request_id: id };
            await api(`${path}/notes`, pending.current, 'POST');
            navigation.goBack();
          })
        }
      />
    </Page>
  );
}

export function StaffReferenceScreen({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'StaffReference'>) {
  useLocale();
  const { selected } = useAuth();
  const path = `/shops/${selected!.shop_id}/staff/${route.params.staffId}`;
  const resource = useResource<StaffProfile>(path);
  return (
    <Page>
      <Heading title={t('Reference salary')} /> <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.error && <Button title={t('Retry')} onPress={() => void resource.refresh()} />}
      {resource.data?.reference && resource.data.can_manage_reference && (
        <ReferenceEditor
          initial={resource.data.reference}
          path={path}
          done={() => navigation.goBack()}
        />
      )}
    </Page>
  );
}
function ReferenceEditor({
  initial,
  path,
  done,
}: {
  initial: NonNullable<StaffProfile['reference']>;
  path: string;
  done: () => void;
}) {
  const { api } = useAuth();
  const [revision] = useState(initial.revision);
  const [value, setValue] = useState(initial.salary || newSalary());
  const [remove, setRemove] = useState(false);
  const [reason, setReason] = useState('');
  const [id] = useState(requestId);
  const pending = useRef<object | null>(null);
  const [attempted, setAttempted] = useState(false);
  const action = useAction();
  useUnsavedChanges(
    !!reason || remove || JSON.stringify(value) !== JSON.stringify(initial.salary || newSalary()),
  );
  return (
    <View style={{ gap: 16 }}>
      <FilterChips
        label={t('Reference salary')}
        value={remove ? 'NONE' : 'SET'}
        onChange={(v) => setRemove(v === 'NONE')}
        options={[
          { value: 'SET', label: t('Set amount') },
          { value: 'NONE', label: t('Not set') },
        ]}
      />
      {!remove && <SalaryFields value={value} onChange={setValue} />}
      <Field
        label={t('Reason for change')}
        value={reason}
        onChangeText={setReason}
        required
        minLength={2}
        maxLength={300}
      />
      <ErrorText message={action.error} />
      {!!action.error && (
        <SaveRecovery
          check={async () => {
            const profile = await api<StaffProfile>(path);
            const saved = !!profile.reference?.history.some((item) => item.id === id);
            if (saved) done();
            return saved;
          }}
        />
      )}
      <Button
        tone="neutral"
        title={attempted && action.error ? t('Retry original save') : t('Save reference salary')}
        busy={action.busy}
        disabled={!attempted && ((!remove && !validSalary(value)) || reason.trim().length < 2)}
        onPress={() =>
          void action.run(async () => {
            setAttempted(true);
            pending.current ||= { revision, request_id: id, salary: remove ? null : value, reason };
            await api(`${path}/reference`, pending.current, 'PUT');
            done();
          })
        }
      />
      {initial.history.length > 0 && (
        <Card>
          <Text style={styles.heading}>{t('Reference salary changes')}</Text>
          {[...initial.history].reverse().map((event) => (
            <View key={event.id}>
              <Text style={styles.label}>
                {event.at.slice(0, 10)} · {event.actor.name}
              </Text>
              <Text style={styles.small}>{event.payload.reason}</Text>
              <Text style={styles.small}>
                {event.payload.salary ? money(event.payload.salary.amount) : t('Not set')}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}
