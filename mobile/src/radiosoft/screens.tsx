import { moneyTones } from '../components/moneyTone';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, TextInputProps, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { t } from '../i18n';
import { Routes } from '../types';
import { useUnsavedChanges } from '../pwa';
import {
  Button,
  Card,
  colors,
  ErrorText,
  Field,
  Heading,
  Loading,
  Page,
  styles,
} from '../components/ui';

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
  waived_paise: number;
  credit: boolean;
  customer_name: string;
  notes?: { id: string; text: string; at: string }[];
  collections?: Receipt[];
  waivers?: { id: string; amount_paise: number; reason: string; reversed: boolean }[];
  snapshot?: {
    lines: {
      description: string;
      quantity: string;
      amount: string;
      salesperson_ref: string;
      salesperson_name: string;
    }[];
  };
};
type ActionBody = {
  request_id: string;
  revision: number;
  action:
    | 'RECEIVE'
    | 'MARK_PAID'
    | 'RECLASSIFY'
    | 'REVERSE'
    | 'WAIVE'
    | 'REVERSE_WAIVER'
    | 'SETTLE'
    | 'NOTE';
  remainder?: 'PENDING' | 'CREDIT' | 'DISCOUNT';
  customer_name?: string;
  note?: string;
  amount_paise?: number;
  adjustment_id?: string;
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
    OVERCOLLECTED: t('Excess / adjustment to review'),
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

function CounterField({
  label,
  searchIcon = false,
  trailing,
  ...props
}: TextInputProps & { label: string; searchIcon?: boolean; trailing?: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={[searchIcon && radioStyles.searchField, !!trailing && radioStyles.amountInput]}>
        {searchIcon && <Ionicons name="search-outline" size={20} color={colors.muted} />}
        <TextInput
          {...props}
          accessibilityLabel={label}
          style={[
            styles.input,
            searchIcon && radioStyles.searchInput,
            !!trailing && { flex: 1, minWidth: 0, borderWidth: 0, paddingVertical: 11 },
          ]}
          placeholderTextColor="#8D9A94"
        />
        {trailing}
      </View>
    </View>
  );
}

function CompactButton({
  title,
  onPress,
  disabled = false,
  expanded,
  selected,
  subtle = false,
  displayTitle,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  subtle?: boolean;
  displayTitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        radioStyles.compactButton,
        subtle && { backgroundColor: 'transparent', paddingHorizontal: 6, paddingVertical: 4 },
        selected && radioStyles.selectedButton,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[radioStyles.buttonText, selected && { color: colors.white }]}>
        {displayTitle || title}
      </Text>
    </Pressable>
  );
}

function FreshnessView({
  value,
  error,
  refresh,
  refreshing,
}: {
  value: Freshness;
  error?: string;
  refresh?: () => void;
  refreshing?: boolean;
}) {
  const [details, setDetails] = useState(false);
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
    <View style={radioStyles.syncPanel}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Connection details')}
          accessibilityState={{ expanded: details }}
          onPress={() => setDetails(!details)}
          style={[radioStyles.syncLabel, { minHeight: 44 }]}
        >
          <View
            style={[radioStyles.dot, { backgroundColor: stale ? colors.gold : colors.green }]}
          />
          <Text style={radioStyles.buttonText}>{label(value.connection)}</Text>
          <Text style={styles.small}>⌄</Text>
        </Pressable>
        {refresh && (
          <CompactButton title={t('Refresh bills')} onPress={refresh} disabled={refreshing} />
        )}
      </View>
      <Text style={styles.small}>
        {t('Last successful sync: {0}', [
          value.last_successful_sync
            ? new Date(value.last_successful_sync).toLocaleString()
            : t('Never'),
        ])}
      </Text>
      {stale && (
        <ErrorText
          message={t(
            'Stale data — source changes may be missing. Check the connector before collecting.',
          )}
        />
      )}
      {details && (
        <Text style={styles.small}>
          {t('Updates every 10 seconds while this page is open.')}{' '}
          {t(
            'The demo must stay running. No contact for 2 minutes means offline; page refresh cannot restart it.',
          )}
        </Text>
      )}
      {value.source_health && value.source_health.status !== 'OK' && (
        <ErrorText message={t('Source needs attention: {0}', [value.source_health.status])} />
      )}
    </View>
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
  const [showSettings, setShowSettings] = useState(false);
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
        title={t('RadioSoft connection')}
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
            <Text style={styles.heading}>{t('RadioSoft → Hishob')}</Text>
            <Text style={styles.small}>{t('Bills from RadioSoft. Collections in Hishob.')}</Text>
            {config.mode === 'OFF' && (
              <Button
                title={t('Enable synthetic preview')}
                busy={action.busy}
                onPress={() => update({ mode: 'PREVIEW' })}
              />
            )}
            {config.mode === 'PREVIEW' && (
              <Button
                title={t('Bills & Collections')}
                onPress={() => navigation.navigate('RadioSoftBills')}
              />
            )}
          </Card>
          {config.mode === 'PREVIEW' && (
            <>
              <FreshnessView value={config} error={resource.error} />
              <Card>
                <View style={styles.row}>
                  <Text style={styles.heading}>{t('Pair connector')}</Text>
                  <CompactButton
                    title={t('Create pairing code')}
                    disabled={action.busy}
                    onPress={() =>
                      void action.run(async () => {
                        setPair(await api(`${base}/pairing`, {}, 'POST'));
                        await resource.refresh();
                      })
                    }
                  />
                </View>
                {pair && (
                  <View style={radioStyles.pairing}>
                    <Text selectable style={radioStyles.pairingCode}>
                      {pair.code}
                    </Text>
                    <Text style={styles.small}>
                      {t('Pairing expires: {0}', [new Date(pair.expires_at).toLocaleTimeString()])}
                    </Text>
                  </View>
                )}
                <Text style={styles.small}>
                  {t('Test connector only. Live RadioSoft sync is not available yet.')}
                </Text>
              </Card>
              <CompactButton
                title={t('Connection settings')}
                expanded={showSettings}
                onPress={() => setShowSettings(!showSettings)}
              />
              {showSettings && (
                <>
                  <Card>
                    <Text>{t('Approved source: {0}', [config.source_id || ''])}</Text>
                    <Text>{t('Firm scope: {0}', [config.firm_codes.join(', ')])}</Text>
                    <Text>
                      {t('Collection tracking starts: {0}', [config.tracking_from || ''])}
                    </Text>
                    <Text style={styles.small}>
                      {t('Last connector contact: {0}', [
                        config.last_contact
                          ? new Date(config.last_contact).toLocaleString()
                          : t('Never'),
                      ])}
                    </Text>
                  </Card>
                  <Card>
                    {(['view', 'collect', 'correct'] as const).map((permission) => {
                      const title = {
                        view: t('Managers can view bills'),
                        collect: t('Managers can record collections'),
                        correct: t('Managers can correct collections and grant waivers'),
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
                    title={t('Disable preview and revoke connector')}
                    secondary
                    busy={action.busy}
                    onPress={() => update({ mode: 'OFF' })}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </Page>
  );
}

function BillEditor({
  base,
  summary,
  permissions,
  refresh,
  listError,
  protect,
}: {
  base: string;
  summary: Bill;
  permissions: Grants;
  refresh: () => Promise<void>;
  listError: string;
  protect: (bill: Bill, pending: boolean) => void;
}) {
  const { api } = useAuth();
  const billId = summary.id;
  const [expanded, setExpanded] = useState(false);
  const resource = useResource<Bill>(`${base}/bills/${billId}`, 10000, expanded);
  const action = useAction();
  const [amounts, setAmounts] = useState({ CASH: '', UPI: '', CARD: '' });
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<Method | 'SPLIT'>('CASH');
  const [remainder, setRemainder] = useState<'PENDING' | 'CREDIT' | 'DISCOUNT'>('PENDING');
  const [customer, setCustomer] = useState(summary.customer_name || '');
  const [note, setNote] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctionMethod, setCorrectionMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'SPLIT'>(
    'CASH',
  );
  const pending = useRef<ActionBody | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useUnsavedChanges(uncertain);
  const bill =
    resource.data && resource.data.revision >= summary.revision ? resource.data : summary;
  const allocations = () =>
    Object.entries(amounts)
      .filter(([, value]) => value !== '')
      .map(([method, value]) => ({ method: method as Method, amount_paise: parseAmount(value) }))
      .filter((a) => a.amount_paise > 0);
  const send = (kind?: ActionBody['action'], receipt?: Receipt, adjustmentId?: string) =>
    void action.run(async () => {
      if (!pending.current)
        pending.current = {
          request_id: requestId(),
          revision: bill.revision,
          action: kind!,
          allocations:
            kind === 'RECLASSIFY' && receipt && correctionMethod !== 'SPLIT'
              ? [
                  {
                    method: correctionMethod,
                    amount_paise: receipt.allocations.reduce(
                      (total, item) => total + item.amount_paise,
                      0,
                    ),
                  },
                ]
              : kind === 'SETTLE' || kind === 'RECEIVE' || kind === 'RECLASSIFY'
                ? allocations()
                : [],
          ...(receipt ? { collection_id: receipt.id, reason } : {}),
          ...(kind === 'SETTLE'
            ? {
                remainder: difference > 0 ? remainder : 'PENDING',
                customer_name: customer.trim(),
                note: note.trim(),
                ...(difference > 0 && remainder === 'DISCOUNT' ? { reason } : {}),
              }
            : {}),
          ...(kind === 'NOTE' ? { note: noteDraft.trim() } : {}),
          ...(kind === 'REVERSE_WAIVER' ? { adjustment_id: adjustmentId, reason } : {}),
        };
      protect(bill, true);
      setUncertain(true);
      try {
        await api(`${base}/bills/${billId}/collections`, pending.current, 'POST');
        pending.current = null;
        setUncertain(false);
        protect(bill, false);
        setRemainder('PENDING');
        setCorrecting(null);
        setNote('');
        setNoteDraft('');
        setShowNote(false);
        setAmounts({ CASH: '', UPI: '', CARD: '' });
        setReason('');
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          pending.current = null;
          setUncertain(false);
          protect(bill, false);
        }
        throw error;
      } finally {
        if (expanded) await resource.refresh();
        await refresh();
      }
    });
  const canReceive =
    permissions.collect && (bill.outstanding_paise ?? 0) > 0 && !bill.review_required;
  let entered = 0;
  let validAmount = true;
  try {
    entered = allocations().reduce((sum, item) => sum + item.amount_paise, 0);
  } catch {
    validAmount = false;
  }
  const difference = (bill.outstanding_paise ?? 0) - entered;
  const settlementDisabled =
    uncertain ||
    !validAmount ||
    (entered <= 0 && remainder === 'PENDING') ||
    !Object.values(amounts).some((value) => value !== '') ||
    (difference > 0 && remainder === 'CREDIT' && customer.trim().length < 2) ||
    (difference > 0 && remainder === 'DISCOUNT' && !permissions.correct) ||
    difference < 0 ||
    !!resource.error ||
    !!listError;
  return (
    <View style={{ gap: 10 }}>
      <ErrorText message={resource.error || action.error} />
      {canReceive && !correcting && (
        <>
          <View style={radioStyles.wrap}>
            {(['CASH', 'UPI', 'CARD', 'SPLIT'] as const).map((choice) => (
              <CompactButton
                key={choice}
                title={choice === 'SPLIT' ? t('Split payment') : label(choice)}
                displayTitle={choice === 'SPLIT' ? t('Split') : undefined}
                selected={method === choice}
                disabled={uncertain || action.busy}
                onPress={() => {
                  setMethod(choice);
                  setAmounts({ CASH: '', UPI: '', CARD: '' });
                }}
              />
            ))}
          </View>
          {method === 'SPLIT' ? (
            (['CASH', 'UPI', 'CARD'] as const).map((choice) => (
              <Field
                key={choice}
                label={t('{0} amount', [label(choice)])}
                value={amounts[choice]}
                keyboardType="decimal-pad"
                editable={!uncertain && !action.busy}
                onChangeText={(value) => setAmounts({ ...amounts, [choice]: value })}
              />
            ))
          ) : (
            <CounterField
              label={t('Receiving now')}
              trailing={
                <CompactButton
                  title={t('Use full balance')}
                  subtle
                  disabled={uncertain || action.busy}
                  onPress={() =>
                    setAmounts({
                      CASH: '',
                      UPI: '',
                      CARD: '',
                      [method]: (bill.outstanding_paise! / 100).toFixed(2),
                    })
                  }
                />
              }
              placeholder="0.00"
              value={amounts[method as 'CASH' | 'UPI' | 'CARD']}
              keyboardType="decimal-pad"
              editable={!uncertain && !action.busy}
              onChangeText={(value) => setAmounts({ CASH: '', UPI: '', CARD: '', [method]: value })}
            />
          )}
          {Object.values(amounts).some((value) => value !== '') && validAmount && (
            <Text style={styles.small}>
              {difference >= 0
                ? t('Remaining after this payment: {0}', [money(difference)])
                : t('Amount exceeds balance by {0}. Enter the amount retained, excluding change.', [
                    money(-difference),
                  ])}
            </Text>
          )}
          {Object.values(amounts).some((value) => value !== '') &&
            validAmount &&
            difference > 0 && (
              <View style={{ gap: 10 }}>
                <Text style={styles.label}>
                  {t('What happens to the remaining {0}?', [money(difference)])}
                </Text>
                <View style={radioStyles.wrap}>
                  {(
                    [
                      'PENDING',
                      'CREDIT',
                      ...(permissions.correct ? (['DISCOUNT'] as const) : []),
                    ] as const
                  ).map((value) => (
                    <CompactButton
                      key={value}
                      title={
                        value === 'PENDING'
                          ? t('Keep pending')
                          : value === 'CREDIT'
                            ? t('Customer credit')
                            : t('Discount remainder')
                      }
                      selected={remainder === value}
                      disabled={uncertain || action.busy}
                      onPress={() => setRemainder(value)}
                    />
                  ))}
                </View>
                {remainder === 'DISCOUNT' && (
                  <>
                    <Text style={[styles.small, { color: moneyTones.pending.ink }]}>
                      {t('Discount {0}; customer owes nothing after this payment.', [
                        money(difference),
                      ])}
                    </Text>
                    <Field
                      label={t('Discount reason (optional)')}
                      value={reason}
                      onChangeText={setReason}
                      editable={!uncertain && !action.busy}
                      maxLength={500}
                    />
                  </>
                )}
                {remainder === 'CREDIT' && (
                  <Field
                    label={t('Customer name / bill reference')}
                    required
                    minLength={2}
                    value={customer}
                    onChangeText={setCustomer}
                    editable={!uncertain && !action.busy}
                    maxLength={100}
                  />
                )}
              </View>
            )}
          {(showNote || remainder === 'CREDIT') && (
            <Field
              label={t('Payment note')}
              value={note}
              onChangeText={setNote}
              editable={!uncertain && !action.busy}
              multiline
              maxLength={500}
            />
          )}
          <Button
            title={
              entered === 0 && remainder === 'CREDIT'
                ? t('Save customer credit')
                : entered === 0 && remainder === 'DISCOUNT'
                  ? t('Confirm discount')
                  : t('Record payment')
            }
            tone={settlementDisabled ? 'neutral' : entered > 0 ? 'in' : 'pending'}
            busy={action.busy}
            disabled={settlementDisabled}
            onPress={() => send('SETTLE')}
          />
        </>
      )}
      <View style={radioStyles.wrap}>
        <CompactButton
          title={
            expanded
              ? t('Close bill {0}', [bill.key.invoice_no])
              : t('Open bill {0}', [bill.key.invoice_no])
          }
          expanded={expanded}
          onPress={() => setExpanded(!expanded)}
        />
        {canReceive && !correcting && remainder !== 'CREDIT' && (
          <CompactButton
            title={t('Add payment note')}
            subtle
            expanded={showNote}
            disabled={uncertain || action.busy}
            onPress={() => setShowNote(!showNote)}
          />
        )}
      </View>
      {uncertain && (
        <Button title={t('Retry the same request')} busy={action.busy} onPress={() => send()} />
      )}
      {expanded && (
        <View style={radioStyles.details}>
          <Text style={styles.heading}>{t('Collection details')}</Text>
          <Text style={styles.small}>
            {t('UPI and card entries are recorded methods, not bank-verified payments.')}
          </Text>
          <Text style={styles.small}>
            {bill.business_date} · {bill.key.fyear} ·{' '}
            {t('Series {0} · Firm {1}', [bill.key.invoice_type, bill.key.firm_code])}
          </Text>
          <Text style={styles.small}>
            {t('Salesperson: {0}', [bill.salespeople.join(', ') || t('Not supplied')])}
          </Text>
          {resource.loading && <Loading />}
          {bill.snapshot?.lines.map((line, index) => (
            <View key={index} style={radioStyles.itemLine}>
              <Text style={styles.small}>
                {line.description} · {line.quantity} · ₹{line.amount}
              </Text>
              <Text style={styles.small}>
                {t('Salesperson: {0}', [
                  line.salesperson_name || line.salesperson_ref || t('Not supplied'),
                ])}
              </Text>
            </View>
          ))}
          {canReceive && (
            <Button
              title={t('Mark paid without method')}
              secondary
              disabled={uncertain || !!resource.error || !!listError}
              busy={action.busy}
              onPress={() => send('MARK_PAID')}
            />
          )}
          {permissions.correct &&
            (!!bill.collections?.some((receipt) => !receipt.reversed) ||
              !!bill.waivers?.some((waiver) => !waiver.reversed)) && (
              <Field
                label={t('Correction reason')}
                value={reason}
                onChangeText={setReason}
                editable={!uncertain}
              />
            )}
          {(bill.notes ?? []).map((item) => (
            <View key={item.id}>
              <Text style={styles.small}>{new Date(item.at).toLocaleString()}</Text>
              <Text style={styles.subtitle}>{item.text}</Text>
            </View>
          ))}
          {permissions.collect && (
            <>
              <Field
                label={t('Bill note')}
                value={noteDraft}
                onChangeText={setNoteDraft}
                editable={!uncertain && !action.busy}
                multiline
                maxLength={500}
              />
              <Button
                title={t('Save bill note')}
                tone="neutral"
                secondary
                disabled={
                  uncertain || noteDraft.trim().length < 2 || !!resource.error || !!listError
                }
                busy={action.busy}
                onPress={() => send('NOTE')}
              />
            </>
          )}
          {bill.waivers?.map((waiver) => (
            <View key={waiver.id} style={{ gap: 8 }}>
              <Text>
                {t('Waived {0}', [money(waiver.amount_paise)])} · {waiver.reason}
              </Text>
              {waiver.reversed ? (
                <Text>{t('Waiver reversed')}</Text>
              ) : (
                permissions.correct && (
                  <Button
                    title={t('Reverse waiver')}
                    secondary
                    disabled={uncertain || !reason.trim() || !!resource.error || !!listError}
                    busy={action.busy}
                    onPress={() => send('REVERSE_WAIVER', undefined, waiver.id)}
                  />
                )
              )}
            </View>
          ))}
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
                      <>
                        <CompactButton
                          title={t('Assign payment method')}
                          expanded={correcting === receipt.id}
                          disabled={uncertain || action.busy}
                          onPress={() => {
                            setCorrecting(correcting === receipt.id ? null : receipt.id);
                            setAmounts({ CASH: '', UPI: '', CARD: '' });
                          }}
                        />
                        {correcting === receipt.id && (
                          <>
                            <View style={radioStyles.wrap}>
                              {(['CASH', 'UPI', 'CARD', 'SPLIT'] as const).map((choice) => (
                                <CompactButton
                                  key={choice}
                                  title={choice === 'SPLIT' ? t('Split payment') : label(choice)}
                                  displayTitle={choice === 'SPLIT' ? t('Split') : undefined}
                                  selected={correctionMethod === choice}
                                  disabled={uncertain || action.busy}
                                  onPress={() => setCorrectionMethod(choice)}
                                />
                              ))}
                            </View>
                            {correctionMethod === 'SPLIT' &&
                              (['CASH', 'UPI', 'CARD'] as const).map((choice) => (
                                <Field
                                  key={choice}
                                  label={t('{0} amount', [label(choice)])}
                                  value={amounts[choice]}
                                  onChangeText={(value) =>
                                    setAmounts({ ...amounts, [choice]: value })
                                  }
                                  keyboardType="decimal-pad"
                                  editable={!uncertain && !action.busy}
                                />
                              ))}
                            <Button
                              title={t('Assign entered methods to this receipt')}
                              secondary
                              disabled={
                                uncertain ||
                                reason.trim().length < 2 ||
                                !!resource.error ||
                                !!listError
                              }
                              busy={action.busy}
                              onPress={() => send('RECLASSIFY', receipt)}
                            />
                          </>
                        )}
                      </>
                    )}
                    <Button
                      title={t('Reverse incorrect receipt')}
                      secondary
                      disabled={uncertain || !reason.trim() || !!resource.error || !!listError}
                      busy={action.busy}
                      onPress={() => send('REVERSE', receipt)}
                    />
                  </>
                )
              )}
            </View>
          ))}
        </View>
      )}
    </View>
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

type Queue = 'PENDING' | 'CREDIT' | 'PAID' | 'REVIEW' | 'ALL';
type BillList = Freshness & {
  bills: Bill[];
  next_cursor: string | null;
  permissions: Grants;
  counts: Record<Queue, number>;
  workers: { ref: string; name: string }[];
  summary: {
    billed_paise: number;
    collected_paise: number;
    waived_paise: number;
    pending_paise: number;
    credit_paise: number;
    excess_paise: number;
    excluded_bills: number;
    excluded_collected_paise: number;
  };
};
export function RadioSoftBills() {
  const { selected } = useAuth();
  const base = `/shops/${selected!.shop.id}/radiosoft`;
  const [cursor, setCursor] = useState('');
  const [gridWidth, setGridWidth] = useState(0);
  const columns = gridWidth >= 1120 ? 3 : gridWidth >= 720 ? 2 : 1;
  const [queue, setQueue] = useState<Queue>('PENDING');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [dateDraft, setDateDraft] = useState('');
  const [worker, setWorker] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [protectedBills, setProtectedBills] = useState<Record<string, Bill>>({});
  const locked = Object.keys(protectedBills).length > 0;
  useEffect(() => {
    if (locked || search === query) return;
    const timer = setTimeout(() => {
      setQuery(search);
      setCursor('');
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, locked]);
  const resource = useResource<BillList>(
    `${base}/bills?after=${encodeURIComponent(cursor)}&status=${queue}&q=${encodeURIComponent(query)}&business_date=${day}&worker=${encodeURIComponent(worker)}`,
    10000,
  );
  const data = resource.data;
  // Keep an uncertain payment mounted even if polling moves it out of Pending.
  // The same request must remain retryable until its outcome is known.
  const visibleBills = data
    ? [
        ...data.bills,
        ...Object.values(protectedBills).filter(
          (bill) => !data.bills.some((row) => row.id === bill.id),
        ),
      ]
    : [];
  const changeQueue = (value: Queue) => {
    setQueue(value);
    setCursor('');
  };
  return (
    <Page wide refresh={resource.refresh}>
      <View style={{ gap: 12 }}>
        <Heading
          title={t('Bills & Collections')}
          subtitle={t('Bills from RadioSoft. Collections in Hishob.')}
        />
        <Text style={radioStyles.preview}>
          {t('Synthetic preview — excluded from galla, customer dues and accounting.')}
        </Text>
        <CounterField
          label={t('Search bills, customers or notes')}
          placeholder={t('Bill number, customer or note')}
          value={search}
          searchIcon
          maxLength={100}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          editable={!locked}
          onChangeText={setSearch}
        />
        <View style={radioStyles.wrap}>
          {(['PENDING', 'CREDIT', 'PAID', 'REVIEW', 'ALL'] as const).map((value) => (
            <CompactButton
              key={value}
              title={t('{0} ({1})', [
                value === 'PENDING'
                  ? t('Pending')
                  : value === 'CREDIT'
                    ? t('Customer credit')
                    : value === 'PAID'
                      ? t('Settled')
                      : value === 'REVIEW'
                        ? t('Needs review')
                        : t('All bills'),
                data?.counts[value] ?? '…',
              ])}
              selected={queue === value}
              disabled={locked}
              onPress={() => changeQueue(value)}
            />
          ))}
        </View>
        <CompactButton
          title={t('Date & worker filters')}
          expanded={showFilters}
          onPress={() => setShowFilters(!showFilters)}
        />
        {showFilters && (
          <View style={{ gap: 10 }}>
            <Text style={styles.small}>
              {t(
                'Totals cover all matching bills across tabs and pages. Collections follow bill dates, not receipt dates.',
              )}
            </Text>

            <Field
              label={t('Bill date (blank for all dates)')}
              placeholder="YYYY-MM-DD"
              value={dateDraft}
              maxLength={10}
              editable={!locked}
              onChangeText={(value) => {
                setDateDraft(value);
                if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                  setDay(value);
                  setCursor('');
                }
              }}
            />
            <View style={radioStyles.wrap}>
              <CompactButton
                title={t('All workers')}
                selected={!worker}
                disabled={locked}
                onPress={() => {
                  setWorker('');
                  setCursor('');
                }}
              />
              {data?.workers.map((item) => (
                <CompactButton
                  key={item.ref}
                  title={`${item.name} · ${item.ref}`}
                  selected={worker === item.ref}
                  disabled={locked}
                  onPress={() => {
                    setWorker(item.ref);
                    setCursor('');
                  }}
                />
              ))}
            </View>
            <Text style={styles.small}>
              {t(
                'Worker filters include the whole bill once. Item attribution appears in bill details.',
              )}
            </Text>
          </View>
        )}
        <ErrorText message={resource.error} />
        {resource.loading && <Loading />}
        {!!cursor && (
          <CompactButton title={t('First page')} disabled={locked} onPress={() => setCursor('')} />
        )}
        {!data && !resource.loading && (
          <Button title={t('Refresh bills')} secondary onPress={() => void resource.refresh()} />
        )}
        {data && (
          <>
            <View style={radioStyles.totals}>
              {[
                [t('RadioSoft bill total'), data.summary.billed_paise],
                [t('Collected on these bills'), data.summary.collected_paise],
                [t('Pending amount'), data.summary.pending_paise],
                [t('Discounts / waivers'), data.summary.waived_paise],
              ].map(([title, amount]) => (
                <View
                  key={title}
                  style={[radioStyles.totalCell, columns > 1 && { flexBasis: '20%' }]}
                >
                  <Text style={styles.small}>{title}</Text>
                  <Text
                    style={[
                      radioStyles.totalAmount,
                      {
                        color:
                          title === t('Collected on these bills')
                            ? moneyTones.in.ink
                            : title === t('Pending amount') || title === t('Discounts / waivers')
                              ? moneyTones.pending.ink
                              : moneyTones.neutral.ink,
                      },
                    ]}
                  >
                    {money(amount as number)}
                  </Text>
                </View>
              ))}
            </View>
            {data.summary.credit_paise > 0 && (
              <Text style={{ color: moneyTones.pending.ink }}>
                {t('Customer credit included in pending: {0}', [money(data.summary.credit_paise)])}
              </Text>
            )}
            {data.summary.excess_paise > 0 && (
              <ErrorText
                message={t('Excess / adjustments to review: {0}', [
                  money(data.summary.excess_paise),
                ])}
              />
            )}
            {data.summary.excluded_bills > 0 && (
              <Text style={styles.small}>
                {t(
                  '{0} cancelled, missing, historical or unmapped bills excluded from totals; retained collections: {1}.',
                  [data.summary.excluded_bills, money(data.summary.excluded_collected_paise)],
                )}
              </Text>
            )}
            <FreshnessView
              value={data}
              error={resource.error}
              refresh={() => void resource.refresh()}
              refreshing={resource.refreshing}
            />
            <View style={styles.row}>
              <Text style={styles.heading}>{t('Latest bills first')}</Text>
              <Text style={styles.small}>{t('{0} bills on this page', [data.bills.length])}</Text>
            </View>
            {!visibleBills.length && (
              <Card>
                <Text style={styles.heading}>
                  {queue === 'PENDING' ? t('No pending bills') : t('No matching bills')}
                </Text>
                <Text style={styles.small}>
                  {t(
                    'Try another tab, bill number, date or worker. New bills appear automatically after sync.',
                  )}
                </Text>
              </Card>
            )}
            <View
              style={radioStyles.billGrid}
              onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
            >
              {visibleBills.map((bill) => (
                <View
                  key={bill.id}
                  testID={`bill-card-${bill.key.invoice_no}`}
                  style={{
                    width: gridWidth ? (gridWidth - 12 * (columns - 1)) / columns : '100%',
                    minWidth: 0,
                  }}
                >
                  <View style={[styles.card, radioStyles.billCard]}>
                    <View style={styles.row}>
                      <View style={{ gap: 4, flexGrow: 1, flexBasis: 150 }}>
                        <Text style={styles.heading}>{t('Bill {0}', [bill.key.invoice_no])}</Text>
                      </View>
                      <Text
                        style={[
                          radioStyles.badge,
                          bill.review_required
                            ? radioStyles.reviewBadge
                            : bill.collection_status === 'PAID'
                              ? radioStyles.paidBadge
                              : radioStyles.dueBadge,
                        ]}
                      >
                        {bill.review_required
                          ? t('Needs review')
                          : bill.collection_status === 'PAID' && bill.waived_paise > 0
                            ? t('Settled with waiver')
                            : bill.credit
                              ? t('Customer credit')
                              : label(bill.collection_status)}
                      </Text>
                    </View>
                    <Text style={styles.small}>
                      {bill.business_date} · {bill.key.fyear} ·{' '}
                      {t('Series {0} · Firm {1}', [bill.key.invoice_type, bill.key.firm_code])}
                    </Text>
                    <Text style={styles.small}>
                      {t('Salesperson: {0}', [bill.salespeople.join(', ') || t('Not supplied')])}
                    </Text>
                    {!!bill.customer_name && (
                      <Text style={styles.heading}>{bill.customer_name}</Text>
                    )}
                    {!!bill.notes?.length && (
                      <Text numberOfLines={2} style={styles.small}>
                        {bill.notes[bill.notes.length - 1]?.text}
                      </Text>
                    )}
                    <View
                      accessibilityLabel={t('Payable {0} · Collected {1} · Outstanding {2}', [
                        money(bill.payable_paise),
                        money(bill.collected_paise),
                        money(bill.outstanding_paise),
                      ])}
                      style={radioStyles.amounts}
                    >
                      <View style={{ gap: 4 }}>
                        <Text style={styles.small}>
                          {(bill.outstanding_paise ?? 0) < 0
                            ? t('Excess / adjustment to review')
                            : t('Pending amount')}
                        </Text>
                        <Text
                          style={[
                            radioStyles.balance,
                            {
                              color:
                                (bill.outstanding_paise ?? 0) > 0
                                  ? moneyTones.pending.ink
                                  : (bill.outstanding_paise ?? 0) < 0
                                    ? moneyTones.out.ink
                                    : moneyTones.in.ink,
                            },
                          ]}
                        >
                          {money(
                            bill.outstanding_paise === null
                              ? null
                              : Math.abs(bill.outstanding_paise),
                          )}
                        </Text>
                      </View>
                      <View style={{ gap: 4 }}>
                        <Text style={styles.small}>
                          {t('Payable {0}', [money(bill.payable_paise)])}
                        </Text>
                        <Text style={styles.small}>
                          {t('Collected {0}', [money(bill.collected_paise)])}
                        </Text>
                      </View>
                    </View>
                    {bill.waived_paise > 0 && (
                      <Text style={styles.small}>
                        {t('Waived {0}', [money(bill.waived_paise)])}
                      </Text>
                    )}
                    {bill.source_status !== 'CURRENT' && (
                      <ErrorText message={label(bill.source_status)} />
                    )}
                    {bill.source_changed && (
                      <Text style={styles.small}>
                        {t('Source changed — collection history retained')}
                      </Text>
                    )}
                    {bill.review_required && (
                      <ErrorText message={t('Review required. No refund has been created.')} />
                    )}
                    <BillEditor
                      base={base}
                      summary={bill}
                      permissions={data.permissions}
                      refresh={resource.refresh}
                      listError={resource.error}
                      protect={(protectedBill, pending) =>
                        setProtectedBills((old) => {
                          const next = { ...old };
                          if (pending) next[protectedBill.id] = protectedBill;
                          else delete next[protectedBill.id];
                          return next;
                        })
                      }
                    />
                  </View>
                </View>
              ))}
            </View>

            {!!data.next_cursor && (
              <CompactButton
                title={t('Next page')}
                disabled={locked}
                onPress={() => setCursor(data.next_cursor!)}
              />
            )}
            <CompactButton
              title={t('Daily payment-app evidence')}
              expanded={showEvidence}
              onPress={() => setShowEvidence(!showEvidence)}
            />
            <View style={{ display: showEvidence ? 'flex' : 'none' }}>
              <DailyTotals base={base} canRecord={data.permissions.collect} />
            </View>
          </>
        )}
      </View>
    </Page>
  );
}

const radioStyles = StyleSheet.create({
  billGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  billCard: { padding: 14, gap: 8, borderRadius: 18 },
  amountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingRight: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingLeft: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingLeft: 0,
  },
  selectedButton: { backgroundColor: colors.green },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.mint,
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  totalCell: { flexGrow: 1, flexBasis: '40%', gap: 6 },
  totalAmount: { fontSize: 22, fontWeight: '700', color: colors.ink },
  itemLine: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 8, gap: 4 },
  compactButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: colors.mint,
  },
  buttonText: { fontSize: 13, fontWeight: '600', color: colors.green },
  syncPanel: { gap: 6, paddingVertical: 4 },
  syncLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pairing: { gap: 4, backgroundColor: colors.background, padding: 10, borderRadius: 10 },
  pairingCode: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  preview: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink,
    backgroundColor: colors.paleGold,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  amounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  balance: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, color: colors.ink },
  badge: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    overflow: 'hidden',
  },
  paidBadge: { backgroundColor: colors.mint, color: colors.green },
  dueBadge: { backgroundColor: colors.paleGold, color: '#795611' },
  reviewBadge: { backgroundColor: '#FAEAEA', color: colors.red },
  details: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 16,
    marginTop: 4,
  },
});
