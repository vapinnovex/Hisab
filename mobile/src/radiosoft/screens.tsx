import React, { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { t } from '../i18n';
import { Routes } from '../types';
import { useUnsavedChanges } from '../pwa';
import { Button, Card, ErrorText, Field, Heading, Loading, Page, styles } from '../components/ui';

type Grants = { view: boolean; collect: boolean; correct: boolean };
type Freshness = {
  connection: string;
  last_successful_sync: string | null;
  last_contact: string | null;
  stale: boolean;
  source_health?: { status: string; pending_observations: number };
};
type Status = Freshness & {
  eligible: boolean;
  mode: 'OFF' | 'PREVIEW';
  revision: number;
  permissions: Grants;
  source_id: string | null;
  firm_codes: number[];
  tracking_from: string | null;
  manager_view: boolean;
  manager_collect: boolean;
  manager_correct: boolean;
};
type Method = 'CASH' | 'UPI' | 'CARD' | 'UNSPECIFIED';
type Allocation = { method: Method; amount_paise: number };
type Receipt = { id: string; allocations: Allocation[]; reversed: boolean; business_date: string };
type Bill = {
  id: string;
  revision: number;
  key: { invoice_no: string; fyear: string; invoice_type: number; firm_code: number };
  business_date: string;
  source_status: string;
  source_changed: boolean;
  collection_status: string;
  payable_paise: number | null;
  collected_paise: number;
  outstanding_paise: number | null;
  review_required: boolean;
  salespeople: string[];
  collections?: Receipt[];
};
type ActionBody = {
  request_id: string;
  revision: number;
  action: 'RECEIVE' | 'MARK_PAID' | 'RECLASSIFY' | 'REVERSE';
  allocations: Allocation[];
  collection_id?: string;
  reason?: string;
};
const requestId = () => `pilot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const money = (value: number | null) =>
  value === null ? t('Needs amount review') : `₹${(value / 100).toFixed(2)}`;
const label = (value: string) =>
  ({
    CASH: t('Cash'),
    UPI: t('UPI'),
    CARD: t('Card'),
    UNSPECIFIED: t('Method not recorded'),
    CURRENT: t('Current source bill'),
    MISSING_REVIEW: t('Missing from source — review'),
    CANCELLED: t('Source cancelled — review'),
    AWAITING_COLLECTION: t('Awaiting collection'),
    PARTIAL: t('Partially paid'),
    PAID: t('Paid'),
    OVERCOLLECTED: t('Overcollected — review'),
    HISTORICAL_REVIEW: t('Historical bill — review'),
    MAPPING_REVIEW: t('Needs amount review'),
    UNPAIRED: t('Not paired'),
    CONNECTED: t('Connector connected'),
    OFFLINE: t('Connector offline'),
    DISABLED: t('Integration off'),
  })[value] || value;
function parseAmount(value: string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value))
    throw new Error(t('Enter a valid amount with up to two decimal places.'));
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function FreshnessView({ value, error }: { value: Freshness; error?: string }) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const stale =
    value.stale ||
    !!error ||
    !value.last_successful_sync ||
    clock - Date.parse(value.last_successful_sync) > 120000;
  return (
    <Card>
      <Text style={styles.heading}>{label(value.connection)}</Text>
      <Text>
        {t('Last successful sync: {0}', [
          value.last_successful_sync
            ? new Date(value.last_successful_sync).toLocaleString()
            : t('Never'),
        ])}
      </Text>
      <Text>
        {t('Last connector contact: {0}', [
          value.last_contact ? new Date(value.last_contact).toLocaleString() : t('Never'),
        ])}
      </Text>
      {stale && (
        <ErrorText
          message={t(
            'Stale data — source changes may be missing. Check the connector before collecting.',
          )}
        />
      )}
      {value.source_health && value.source_health.status !== 'OK' && (
        <ErrorText message={t('Source needs attention: {0}', [value.source_health.status])} />
      )}
      <Text style={styles.small}>
        {t(
          'Refreshes every 10 seconds while this page is active. Source polling may miss edits or deletions; coverage is not validated.',
        )}
      </Text>
    </Card>
  );
}

export function RadioSoftEntry() {
  const { selected, session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const resource = useResource<Status>(`/shops/${selected!.shop.id}/radiosoft/status`, 15000);
  if (resource.error || !resource.data?.eligible) return null;
  return (
    <View style={{ gap: 10 }}>
      {resource.data.mode === 'PREVIEW' && resource.data.permissions.view && (
        <Button
          title={t('Bills & Collections')}
          secondary
          onPress={() => navigation.navigate('RadioSoftBills')}
        />
      )}
      {session!.role === 'OWNER' && (
        <Button
          title={t('RadioSoft pilot setup')}
          secondary
          onPress={() => navigation.navigate('RadioSoftSetup')}
        />
      )}
    </View>
  );
}

export function RadioSoftSetup() {
  const { selected, api } = useAuth();
  const base = `/shops/${selected!.shop.id}/radiosoft`;
  const resource = useResource<Status>(`${base}/status`, 10000);
  const action = useAction();
  const [pair, setPair] = useState<{ code: string; expires_at: string } | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const config = resource.data;
  const update = (patch: Partial<Status>) =>
    void action.run(async () => {
      if (!config) return;
      await api(
        `${base}/settings`,
        {
          revision: config.revision,
          mode: config.mode,
          manager_view: config.manager_view,
          manager_collect: config.manager_collect,
          manager_correct: config.manager_correct,
          ...patch,
        },
        'PUT',
      );
      setPair(null);
      await resource.refresh();
    });
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('RadioSoft pilot setup')}
        subtitle={t('Synthetic preview only. Production accounting is disabled.')}
      />
      <ErrorText message={resource.error || action.error} />
      {resource.loading ? (
        <Loading />
      ) : !config?.eligible ? (
        <Text>{t('This shop is not approved for the synthetic pilot.')}</Text>
      ) : (
        <>
          <Card>
            <Text>{t('Approved source: {0}', [config.source_id || ''])}</Text>
            <Text>{t('Firm scope: {0}', [config.firm_codes.join(', ')])}</Text>
            <Text>{t('Collection tracking starts: {0}', [config.tracking_from || ''])}</Text>
            <Text style={styles.small}>
              {t(
                'RadioSoft owns bills. Hishob records collections. Preview never changes galla or customer dues.',
              )}
            </Text>
            <Button
              title={
                config.mode === 'OFF'
                  ? t('Enable synthetic preview')
                  : t('Disable preview and revoke connector')
              }
              busy={action.busy}
              onPress={() => update({ mode: config.mode === 'OFF' ? 'PREVIEW' : 'OFF' })}
            />
          </Card>
          {config.mode === 'PREVIEW' && (
            <>
              <FreshnessView value={config} error={resource.error} />
              <Card>
                {(['view', 'collect', 'correct'] as const).map((permission) => {
                  const title = {
                    view: t('Managers can view bills'),
                    collect: t('Managers can record collections'),
                    correct: t('Managers can correct collections'),
                  }[permission];
                  const key = `manager_${permission}` as const;
                  return (
                    <View style={styles.row} key={permission}>
                      <Text>{title}</Text>
                      <Switch
                        accessibilityLabel={title}
                        value={config[key]}
                        disabled={action.busy}
                        onValueChange={(value) => update({ [key]: value })}
                      />
                    </View>
                  );
                })}
                <Text style={styles.small}>
                  {t('Recording and correcting also require permission to view bills.')}
                </Text>
              </Card>
              <Button
                title={t('Create pairing code')}
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    setPair(await api(`${base}/pairing`, {}, 'POST'));
                    await resource.refresh();
                  })
                }
              />
              {pair && (
                <Card>
                  <Text selectable>{pair.code}</Text>
                  <Text>
                    {t('Pairing expires: {0}', [new Date(pair.expires_at).toLocaleString()])}
                  </Text>
                </Card>
              )}
              <Text style={styles.small}>
                {t(
                  'The Windows installer and setup application are the next task. This code currently pairs only a synthetic test client.',
                )}
              </Text>
              <Button
                title={t('Revoke connector')}
                secondary
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await api(`${base}/revoke`, {}, 'POST');
                    setPair(null);
                    await resource.refresh();
                  })
                }
              />
              <Button
                title={t('Bills & Collections')}
                onPress={() => navigation.navigate('RadioSoftBills')}
              />
            </>
          )}
        </>
      )}
    </Page>
  );
}

function BillEditor({
  base,
  billId,
  permissions,
  refresh,
}: {
  base: string;
  billId: string;
  permissions: Grants;
  refresh: () => Promise<void>;
}) {
  const { api } = useAuth();
  const resource = useResource<Bill>(`${base}/bills/${billId}`, 10000);
  const action = useAction();
  const [amounts, setAmounts] = useState({ CASH: '', UPI: '', CARD: '' });
  const [reason, setReason] = useState('');
  const pending = useRef<ActionBody | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useUnsavedChanges(uncertain);
  const bill = resource.data;
  const allocations = () =>
    Object.entries(amounts)
      .filter(([, value]) => value !== '')
      .map(([method, value]) => ({ method: method as Method, amount_paise: parseAmount(value) }))
      .filter((a) => a.amount_paise > 0);
  const send = (kind?: ActionBody['action'], receipt?: Receipt) =>
    void action.run(async () => {
      if (!bill) return;
      if (!pending.current)
        pending.current = {
          request_id: requestId(),
          revision: bill.revision,
          action: kind!,
          allocations: kind === 'RECEIVE' || kind === 'RECLASSIFY' ? allocations() : [],
          ...(receipt ? { collection_id: receipt.id, reason } : {}),
        };
      setUncertain(true);
      try {
        await api(`${base}/bills/${billId}/collections`, pending.current, 'POST');
        pending.current = null;
        setUncertain(false);
        setAmounts({ CASH: '', UPI: '', CARD: '' });
        setReason('');
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          pending.current = null;
          setUncertain(false);
        }
        throw error;
      } finally {
        await resource.refresh();
        await refresh();
      }
    });
  if (!bill) return <ErrorText message={resource.error || t('Loading bill…')} />;
  return (
    <Card>
      <Text style={styles.heading}>{t('Collection details')}</Text>
      <Text style={styles.small}>
        {t('UPI and card entries are recorded methods, not bank-verified payments.')}
      </Text>
      <ErrorText message={resource.error || action.error} />
      {uncertain && (
        <Button title={t('Retry the same request')} busy={action.busy} onPress={() => send()} />
      )}
      {(permissions.collect || permissions.correct) && (
        <>
          {(['CASH', 'UPI', 'CARD'] as const).map((method) => (
            <Field
              key={method}
              label={t('{0} amount', [label(method)])}
              value={amounts[method]}
              keyboardType="decimal-pad"
              editable={!uncertain && !action.busy}
              onChangeText={(value) => setAmounts({ ...amounts, [method]: value })}
            />
          ))}
          <Text style={styles.small}>
            {t(
              'Enter one method or split the payment across methods. Partial payments are supported.',
            )}
          </Text>
        </>
      )}
      {permissions.collect && (
        <>
          <Button
            title={t('Record payment')}
            busy={action.busy}
            disabled={
              uncertain || bill.review_required || !bill.outstanding_paise || !!resource.error
            }
            onPress={() => send('RECEIVE')}
          />
          <Button
            title={t('Mark paid without method')}
            secondary
            busy={action.busy}
            disabled={
              uncertain || bill.review_required || !bill.outstanding_paise || !!resource.error
            }
            onPress={() => send('MARK_PAID')}
          />
        </>
      )}
      {permissions.correct && (
        <Field
          label={t('Correction reason')}
          value={reason}
          onChangeText={setReason}
          editable={!uncertain}
        />
      )}
      {bill.collections?.map((receipt) => (
        <View key={receipt.id} style={{ gap: 8 }}>
          <Text>
            {receipt.business_date} ·{' '}
            {receipt.allocations
              .map((a) => `${label(a.method)} ${money(a.amount_paise)}`)
              .join(' + ')}
          </Text>
          {receipt.allocations.some((a) => a.method === 'UNSPECIFIED') && !receipt.reversed && (
            <Text>{t('Paid—method not recorded')}</Text>
          )}
          {receipt.reversed ? (
            <Text>{t('Receipt reversed (correction, not a cash refund)')}</Text>
          ) : (
            permissions.correct && (
              <>
                {receipt.allocations.some((a) => a.method === 'UNSPECIFIED') && (
                  <Button
                    title={t('Assign entered methods to this receipt')}
                    secondary
                    disabled={uncertain || !reason.trim() || !!resource.error}
                    busy={action.busy}
                    onPress={() => send('RECLASSIFY', receipt)}
                  />
                )}
                <Button
                  title={t('Reverse incorrect receipt')}
                  secondary
                  disabled={uncertain || !reason.trim() || !!resource.error}
                  busy={action.busy}
                  onPress={() => send('REVERSE', receipt)}
                />
              </>
            )
          )}
        </View>
      ))}
    </Card>
  );
}

function DailyTotals({ base, canRecord }: { base: string; canRecord: boolean }) {
  const { api } = useAuth();
  const [day, setDay] = useState('');
  const [source, setSource] = useState('');
  const [upi, setUpi] = useState('');
  const [card, setCard] = useState('');
  const resource = useResource<{
    recorded: Record<Method, number>;
    difference: Record<string, number> | null;
    explanation: string;
  }>(`${base}/daily-evidence/${day}`, 10000, /^\d{4}-\d{2}-\d{2}$/.test(day));
  const action = useAction();
  const pending = useRef<object | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useUnsavedChanges(uncertain);
  return (
    <Card>
      <Text style={styles.heading}>{t('Daily payment-app evidence')}</Text>
      <Text style={styles.small}>
        {t(
          'Totals are comparison evidence only, never another receipt or sale. Use totals covering all pilot collections for this date.',
        )}
      </Text>
      <Field
        label={t('Evidence date')}
        placeholder="YYYY-MM-DD"
        value={day}
        editable={!uncertain}
        onChangeText={setDay}
      />
      {canRecord && (
        <>
          <Field
            label={t('Evidence source')}
            value={source}
            editable={!uncertain}
            onChangeText={setSource}
          />
          <Field
            label={t('UPI total')}
            value={upi}
            editable={!uncertain}
            onChangeText={setUpi}
            keyboardType="decimal-pad"
          />
          <Field
            label={t('Card total')}
            value={card}
            editable={!uncertain}
            onChangeText={setCard}
            keyboardType="decimal-pad"
          />
          <Button
            title={uncertain ? t('Retry the same request') : t('Record comparison evidence')}
            busy={action.busy}
            onPress={() =>
              void action.run(async () => {
                if (!pending.current)
                  pending.current = {
                    request_id: requestId(),
                    date: day,
                    scope: 'ALL_PILOT_COLLECTIONS',
                    source,
                    upi_paise: parseAmount(upi),
                    card_paise: parseAmount(card),
                  };
                setUncertain(true);
                try {
                  await api(`${base}/daily-evidence`, pending.current, 'POST');
                  pending.current = null;
                  setUncertain(false);
                } catch (error) {
                  if (error instanceof ApiError && error.status < 500) {
                    pending.current = null;
                    setUncertain(false);
                  }
                  throw error;
                } finally {
                  await resource.refresh();
                }
              })
            }
          />
        </>
      )}
      <ErrorText message={action.error || resource.error} />
      {resource.data && (
        <>
          <Text>
            {t('Unspecified collections: {0}', [money(resource.data.recorded.UNSPECIFIED)])}
          </Text>
          {resource.data.difference && (
            <Text>
              {t('Difference · UPI: {0} · Card: {1}', [
                money(resource.data.difference.UPI),
                money(resource.data.difference.CARD),
              ])}
            </Text>
          )}
          <Text>
            {t(
              'Not fully reconciled. Methods, settlement timing and bank evidence still need review.',
            )}
          </Text>
        </>
      )}
    </Card>
  );
}

export function RadioSoftBills() {
  const { selected } = useAuth();
  const base = `/shops/${selected!.shop.id}/radiosoft`;
  const [cursor, setCursor] = useState('');
  const [billId, setBillId] = useState<string | null>(null);
  const resource = useResource<
    Freshness & { bills: Bill[]; next_cursor: string | null; permissions: Grants }
  >(`${base}/bills?after=${encodeURIComponent(cursor)}`, 10000);
  const data = resource.data;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Bills & Collections')}
        subtitle={t('Synthetic preview — excluded from galla, customer dues and accounting.')}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {data && (
        <>
          <FreshnessView value={data} error={resource.error} />
          <Button title={t('Refresh bills')} secondary onPress={() => void resource.refresh()} />
          {!data.bills.length && <Text>{t('No synthetic bills received yet.')}</Text>}
          {data.bills.map((bill) => (
            <View key={bill.id} style={{ gap: 12 }}>
              <Card>
                <Text style={styles.heading}>{t('Bill {0}', [bill.key.invoice_no])}</Text>
                <Text>
                  {bill.business_date} · {bill.key.fyear} ·{' '}
                  {t('Series {0} · Firm {1}', [bill.key.invoice_type, bill.key.firm_code])}
                </Text>
                <Text>
                  {t('Salesperson: {0}', [bill.salespeople.join(', ') || t('Not supplied')])}
                </Text>
                <Text>
                  {t('Payable {0} · Collected {1} · Outstanding {2}', [
                    money(bill.payable_paise),
                    money(bill.collected_paise),
                    money(bill.outstanding_paise),
                  ])}
                </Text>
                <Text>
                  {label(bill.source_status)} · {label(bill.collection_status)}
                </Text>
                {bill.source_changed && (
                  <Text>{t('Source changed — collection history retained')}</Text>
                )}
                {bill.review_required && (
                  <ErrorText message={t('Review required. No refund has been created.')} />
                )}
                <Button
                  title={t('Open bill {0}', [bill.key.invoice_no])}
                  secondary
                  onPress={() => setBillId(billId === bill.id ? null : bill.id)}
                />
              </Card>
              {billId === bill.id && (
                <BillEditor
                  key={bill.id}
                  base={base}
                  billId={bill.id}
                  permissions={data.permissions}
                  refresh={resource.refresh}
                />
              )}
            </View>
          ))}
          {!!cursor && (
            <Button
              title={t('First page')}
              secondary
              onPress={() => {
                setCursor('');
                setBillId(null);
              }}
            />
          )}
          {!!data.next_cursor && (
            <Button
              title={t('Next page')}
              secondary
              onPress={() => {
                setCursor(data.next_cursor!);
                setBillId(null);
              }}
            />
          )}
          <DailyTotals base={base} canRecord={data.permissions.collect} />
        </>
      )}
    </Page>
  );
}
