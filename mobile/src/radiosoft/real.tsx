import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { Routes, Worker } from '../types';
import { t, useLocale } from '../i18n';
import { Button, Card, ErrorText, Field, Heading, Page, styles } from '../components/ui';

type Scope = {
  source_id: string;
  generation: string;
  database: string;
  firm_codes: number[];
  invoice_types: number[];
  tracking_from: string;
  capture_from: string;
  capture_until: string;
};
type Status = {
  connection: string;
  can_map: boolean;
  can_view: boolean;
  scope: Scope;
  enabled: boolean;
  paired: boolean;
  manager_view: boolean;
  manager_map: boolean;
  last_contact: string | null;
  last_successful_sync: string | null;
  health: {
    pending_observations: number;
    status: string;
    last_successful_source_read: string | null;
  } | null;
  coverage: string;
};
type Person = {
  id: string;
  ref: string;
  name: string;
  worker_id: string | null;
  revision: number;
  not_used?: boolean;
};
type Directory = {
  people: Person[];
  workers: { id: string; name: string }[];
  history_policy: string;
};
type Bill = {
  id: string;
  key: { invoice_no: string };
  business_date: string;
  source_time_raw?: string;
  signed_source_payable: string | null;
  owed_to_customer: string | null;
  settlement_status: string;
  historical: boolean;
  source_changed: boolean;
  lines?: {
    raw: Record<string, string | number | null>;
    salesperson_ref: string | null;
    salesperson_name: string;
    attribution_status: string;
    worker_name?: string | null;
  }[];
};
type Report = {
  rows: {
    bill_id: string;
    line_index: number;
    item: string;
    source_item_net: string;
    salesperson_name: string;
  }[];
  policy: string;
};
const denied = (status?: number) => status === 401 || status === 403;
const entryTitle = 'RadioSoft bills (DEV)';

export function RealRadioSoftEntry() {
  useLocale();
  const { selected, session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const resource = useResource<{ enabled: boolean }>(
    `/shops/${selected?.shop_id ?? ''}/radiosoft-real/${session?.role === 'WORKER' ? 'availability' : 'status'}`,
    15000,
    !!selected,
  );
  if (!selected) return null;
  if (resource.loading || resource.error)
    return (
      <Card>
        <Text style={styles.heading}>{t(entryTitle)}</Text>
        <Text>
          {t(
            resource.loading
              ? 'Checking RadioSoft access…'
              : denied(resource.errorStatus)
                ? 'RadioSoft preview access was rejected. No preview data is shown.'
                : 'RadioSoft status is unavailable. Eligibility could not be checked.',
          )}
        </Text>
        <ErrorText message={resource.error} />
        {!!resource.error && (
          <Button
            title={t('Retry RadioSoft status')}
            busy={resource.refreshing}
            onPress={resource.refresh}
          />
        )}
      </Card>
    );
  if (!resource.data || (session?.role === 'WORKER' && !resource.data.enabled)) return null;
  return (
    <Button
      title={t(session?.role === 'WORKER' ? 'My attributed sales (DEV)' : entryTitle)}
      secondary
      onPress={() => navigation.navigate('RadioSoftReal')}
    />
  );
}

function shopDate(timezone: string, offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = ['year', 'month', 'day']
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join('-');
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function sourceSummary(status: Status) {
  if (!status.enabled) return t('DEV connector is disabled. Open Connection settings to resume.');
  if (!status.paired) return t('PC is unpaired. Open Connection settings to pair it.');
  if (status.connection === 'OFFLINE')
    return t('PC is disconnected. Check the shop PC and internet connection.');
  if (status.health?.status && status.health.status !== 'OK')
    return t('Source read failed or is incomplete. Open Connection settings for details.');
  const last = status.health?.last_successful_source_read;
  if (!last) return t('Waiting for the first successful source read.');
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(last)) / 60000));
  return t('Last source read {0} minutes ago. Imports may still be partial.', [minutes]);
}
export function RadioSoftReal() {
  const { selected, session } = useAuth();
  return <RealPreview key={`${selected?.shop_id}:${session?.role}`} />;
}
function RealPreview() {
  useLocale();
  const { selected, session } = useAuth();
  const base = `/shops/${selected!.shop_id}/radiosoft-real`;
  const worker = session?.role === 'WORKER';
  const status = useResource<Status>(base + '/status', 15000, !worker);
  const [section, setSection] = useState<'bills' | 'links' | 'connection' | 'report'>('bills');
  if (!worker && (!status.data || denied(status.errorStatus)))
    return (
      <Page>
        <Heading title={t(entryTitle)} />
        <Text>
          {t(
            status.loading
              ? 'Loading connection status…'
              : denied(status.errorStatus)
                ? 'RadioSoft preview access was rejected. No preview data is shown.'
                : 'Connection status is unavailable. Eligibility could not be checked.',
          )}
        </Text>
        <ErrorText message={status.error} />
        <Button
          title={t('Retry RadioSoft status')}
          busy={status.refreshing}
          onPress={status.refresh}
        />
      </Page>
    );
  return (
    <Page>
      <Heading
        title={t(worker ? 'My attributed sales (DEV)' : entryTitle)}
        subtitle={t('Real source preview. Financial actions are unavailable.')}
      />
      {!worker && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {status.data?.can_view && (
              <Button title={t('Bills')} secondary onPress={() => setSection('bills')} />
            )}
            {status.data?.can_map && (
              <Button title={t('Manage links')} secondary onPress={() => setSection('links')} />
            )}
            <Button
              title={t('Connection settings')}
              secondary
              onPress={() => setSection('connection')}
            />
          </View>
          {!!status.error && (
            <Text>
              {t(
                'Connection status could not refresh. Showing previously authorized data; it may be stale.',
              )}
            </Text>
          )}
          <ErrorText message={status.error} />
          {status.data && <Text>{sourceSummary(status.data)}</Text>}
        </>
      )}
      {!worker && section === 'bills' && status.data?.can_view && (
        <Bills
          base={base}
          status={status.data}
          refreshStatus={status.refresh}
          onLinks={() => setSection('links')}
        />
      )}
      {!worker && section === 'bills' && !status.data?.can_view && (
        <Text>
          {t('Bill viewing is not enabled for this account. Connection settings remain available.')}
        </Text>
      )}
      {!worker && section === 'links' && status.data?.can_map && <Links base={base} />}
      {!worker && section === 'connection' && status.data && (
        <Connection base={base} status={status.data} refresh={status.refresh} />
      )}
      {(worker || (section === 'report' && status.data?.can_view)) && <SalesReport base={base} />}
      {!worker && section === 'bills' && status.data?.can_view && (
        <Button title={t('Attributed item sales')} secondary onPress={() => setSection('report')} />
      )}
      <Text style={styles.small}>
        {t(
          'Separate from synthetic Bills & Collections. Imported amounts are not proof of payment or debt.',
        )}
      </Text>
    </Page>
  );
}
function Bills({
  base,
  status,
  refreshStatus,
  onLinks,
}: {
  base: string;
  status: Status;
  refreshStatus: () => Promise<void>;
  onLinks: () => void;
}) {
  const { selected } = useAuth();
  const timezone = selected!.shop.timezone;
  const [date, setDate] = useState(() => shopDate(timezone));
  const [draftDate, setDraftDate] = useState(date);
  const [search, setSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [after, setAfter] = useState('');
  const [billId, setBillId] = useState<string | null>(null);
  const bills = useResource<{ bills: Bill[]; next_cursor: string | null }>(
    `${base}/bills?business_date=${encodeURIComponent(date)}&search=${encodeURIComponent(search)}&after=${encodeURIComponent(after)}`,
    15000,
  );
  const directory = useResource<Directory>(base + '/salespeople', 15000, status.can_map);
  const applyDate = (value: string) => {
    setDate(value);
    setDraftDate(value);
    setAfter('');
  };
  const needs = directory.data?.people.filter(
    (p) => !p.not_used && !directory.data!.workers.some((w) => w.id === p.worker_id),
  ).length;
  return (
    <>
      <Button
        title={t('Refresh real preview')}
        secondary
        busy={bills.refreshing}
        onPress={async () => {
          await Promise.all([
            refreshStatus(),
            bills.refresh(),
            ...(status.can_map ? [directory.refresh()] : []),
          ]);
        }}
      />
      {status.can_map && needs !== undefined && (
        <Card>
          <Text>
            {t(
              needs
                ? '{0} salespeople need linking.'
                : 'All salespeople are linked or marked not used.',
              [needs],
            )}
          </Text>
          <Button title={t('Manage links')} secondary onPress={onLinks} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('Today')} secondary onPress={() => applyDate(shopDate(timezone))} />
        <Button
          title={t('Yesterday')}
          secondary
          onPress={() => applyDate(shopDate(timezone, -1))}
        />
      </View>
      <Field label={t('Bill date (YYYY-MM-DD)')} value={draftDate} onChangeText={setDraftDate} />
      <Field label={t('Search bill number')} value={draftSearch} onChangeText={setDraftSearch} />
      <Button
        title={t('Find bills')}
        disabled={!/^\d{4}-\d{2}-\d{2}$/.test(draftDate)}
        onPress={() => {
          applyDate(draftDate);
          setSearch(draftSearch.trim());
        }}
      />
      <Text style={styles.small}>
        {t('Imported bills only. This is not a complete daily sales total.')}
      </Text>
      <ErrorText message={bills.error} />
      {!!bills.error && bills.data && (
        <Text>{t('Could not refresh. These imported bills may be stale.')}</Text>
      )}
      {bills.loading && <Text>{t('Loading imported bills…')}</Text>}
      {bills.data?.bills.length === 0 && (
        <Card>
          <Text>
            {t(
              search
                ? 'No imported bills match this number and date.'
                : 'No imported bills for this date yet.',
            )}
          </Text>
          <Text>{sourceSummary(status)}</Text>
        </Card>
      )}
      {bills.data?.bills.map((bill) => (
        <Card key={bill.id}>
          <Text style={styles.heading}>{t('Bill {0}', [bill.key.invoice_no])}</Text>
          <Text>
            {bill.business_date}
            {bill.source_time_raw ? ` · ${bill.source_time_raw}` : ''}
          </Text>
          <BillAmount bill={bill} />
          <Text>{t(bill.historical ? 'Historical review' : 'Review only')}</Text>
          {bill.source_changed && <Text>{t('Source edited; review the updated amount.')}</Text>}
          <Button
            title={t('Open bill {0}', [bill.key.invoice_no])}
            secondary
            onPress={() => setBillId(bill.id)}
          />
        </Card>
      ))}
      {!!after && <Button title={t('First page')} secondary onPress={() => setAfter('')} />}
      {bills.data?.next_cursor && (
        <Button title={t('Next bills')} onPress={() => setAfter(bills.data!.next_cursor!)} />
      )}
      {billId && <BillDetail base={base} id={billId} close={() => setBillId(null)} />}
    </>
  );
}
function BillAmount({ bill }: { bill: Bill }) {
  return (
    <Text style={styles.heading}>
      {bill.signed_source_payable === null
        ? t('Source payable unknown')
        : Number(bill.signed_source_payable) < 0
          ? t('Amount owed to customer: ₹{0}', [bill.owed_to_customer])
          : t('Source payable: ₹{0}', [bill.signed_source_payable])}
    </Text>
  );
}
function BillDetail({ base, id, close }: { base: string; id: string; close: () => void }) {
  const detail = useResource<Bill>(`${base}/bills/${id}`, 15000);
  return (
    <Modal visible onRequestClose={close} animationType="slide">
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Button title={t('Close bill')} secondary onPress={close} />
        <ErrorText message={detail.error} />
        {detail.loading && <Text>{t('Loading imported bills…')}</Text>}
        {!!detail.error && detail.data && (
          <Text>{t('Could not refresh. These imported bills may be stale.')}</Text>
        )}
        <Button title={t('Refresh bill')} secondary onPress={detail.refresh} />
        {detail.data && (
          <>
            <Heading
              title={t('Bill {0}', [detail.data.key.invoice_no])}
              subtitle={detail.data.business_date}
            />
            <BillAmount bill={detail.data} />
            <Text>
              {t(
                'Review only. Source item amounts are provisional; discounts, rounding and exchanges remain unallocated.',
              )}
            </Text>
            {detail.data.lines?.map((line, i) => (
              <Card key={i}>
                <Text style={styles.heading}>{String(line.raw.ItemName ?? t('Item'))}</Text>
                <Text>
                  {t('Quantity: {0} · Source amount: ₹{1}', [
                    line.raw.Qty ?? t('Unknown'),
                    line.raw.NetAmt ?? t('Unknown'),
                  ])}
                </Text>
                <Text>
                  {t('RadioSoft salesperson: {0} · {1}', [
                    line.salesperson_ref ?? t('Unresolved'),
                    line.salesperson_name || t('Unresolved'),
                  ])}
                </Text>
                <Text>
                  {t('Attributed staff: {0}', [
                    line.worker_name || t('Not linked at first import'),
                  ])}
                </Text>
                <Text>
                  {t(
                    'Staff attribution was frozen at first import; later links do not change this bill.',
                  )}
                </Text>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Modal>
  );
}
function Links({ base }: { base: string }) {
  const directory = useResource<Directory>(base + '/salespeople', 15000);
  const [filter, setFilter] = useState('needs');
  const [editing, setEditing] = useState<Person | null>(null);
  const category = (p: Person) =>
    p.not_used
      ? 'unused'
      : directory.data?.workers.some((w) => w.id === p.worker_id)
        ? 'linked'
        : 'needs';
  return (
    <>
      <Heading
        title={t('Link salespeople to staff')}
        subtitle={t('Links affect future first-imported bills. Imported history stays unchanged.')}
      />
      <Button title={t('Refresh links')} secondary onPress={directory.refresh} />
      <ErrorText message={directory.error} />
      {directory.loading && <Text>{t('Loading salesperson directory…')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[
          ['needs', 'Needs linking'],
          ['linked', 'Linked'],
          ['unused', 'Not used'],
        ].map(([key, label]) => (
          <Button key={key} title={t(label)} secondary onPress={() => setFilter(key)} />
        ))}
      </View>
      {!denied(directory.errorStatus) && directory.data && (
        <>
          {directory.data.people.filter((p) => category(p) === filter).length === 0 && (
            <Text>
              {t(
                filter === 'needs'
                  ? 'No salespeople need linking. New source entries will appear here.'
                  : 'No salespeople in this list.',
              )}
            </Text>
          )}
          {directory.data.people
            .filter((p) => category(p) === filter)
            .map((person) => (
              <Card key={person.id}>
                <Text style={styles.heading}>
                  {person.ref} · {person.name || t('Unnamed salesperson')}
                </Text>
                <Text>
                  {directory.data!.workers.find((w) => w.id === person.worker_id)?.name ??
                    t(
                      person.not_used
                        ? 'Not used'
                        : person.worker_id
                          ? 'Linked worker is inactive. Choose an active worker.'
                          : 'Not linked',
                    )}
                </Text>
                <Button
                  title={t(person.worker_id || person.not_used ? 'Change link' : 'Link to staff')}
                  secondary
                  onPress={() => setEditing(person)}
                />
              </Card>
            ))}
          {editing && (
            <LinkEditor
              key={editing.id}
              person={editing}
              base={base}
              close={() => setEditing(null)}
              saved={async () => {
                setEditing(null);
                await directory.refresh();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
function LinkEditor({
  person,
  base,
  saved,
  close,
}: {
  person: Person;
  base: string;
  saved: () => Promise<void>;
  close: () => void;
}) {
  const { api, selected } = useAuth();
  const staff = useResource<Worker[]>(`/shops/${selected!.shop_id}/workers`);
  const action = useAction();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(person.worker_id);
  const [reason, setReason] = useState('');
  const [create, setCreate] = useState(false);
  const [name, setName] = useState(person.name);
  const [created, setCreated] = useState<Worker | null>(null);
  const [revision, setRevision] = useState(person.revision);
  const [current, setCurrent] = useState(person);
  const [conflict, setConflict] = useState(false);
  const established = !!current.worker_id || !!current.not_used;
  const save = (notUsed = false, unlink = false) =>
    action.run(async () => {
      let workerId = unlink || notUsed ? null : chosen;
      if (create && !notUsed && !unlink) {
        const worker =
          created ??
          (await api<Worker>(
            `/shops/${selected!.shop_id}/workers`,
            { name, request_id: `radiosoft:${person.id}:${person.revision}` },
            'POST',
          ));
        setCreated(worker);
        setChosen(worker.id);
        workerId = worker.id;
      }
      try {
        await api(
          `${base}/salespeople/${person.id}/mapping`,
          { revision, worker_id: workerId, not_used: notUsed, reason },
          'PUT',
        );
        await saved();
      } catch (error) {
        setConflict(true);
        throw error;
      }
    });
  return (
    <Modal visible onRequestClose={close} animationType="slide">
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Heading
          title={t('Link {0} · {1}', [person.ref, person.name])}
          subtitle={t(
            'Links affect future first-imported bills. Imported history stays unchanged.',
          )}
        />
        <Button title={t('Close linking')} secondary onPress={close} />
        <ErrorText message={action.error || staff.error} />
        {conflict && (
          <Button
            title={t('Refresh current link before retry')}
            secondary
            onPress={() =>
              void action.run(async () => {
                const latest = await api<Directory>(base + '/salespeople');
                const p = latest.people.find((p) => p.id === person.id);
                if (p) {
                  setRevision(p.revision);
                  setCurrent(p);
                  setConflict(false);
                }
              })
            }
          />
        )}
        {current.worker_id && (
          <Text>
            {t('Current link: {0}', [
              staff.data?.find((w) => w.id === current.worker_id)?.name ?? t('Inactive worker'),
            ])}
          </Text>
        )}
        {created && (
          <Text>
            {t('Staff created: {0}. Retry linking this same profile; do not create another.', [
              created.name,
            ])}
          </Text>
        )}
        {!create && (
          <>
            <Field label={t('Search staff')} value={query} onChangeText={setQuery} />
            <Text>
              {t(
                'Select the correct profile when names repeat. Search to narrow the first 20 matches.',
              )}
            </Text>
            {staff.data
              ?.filter(
                (w) =>
                  w.active && `${w.name} ${w.mobile}`.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 20)
              .map((w) => (
                <Pressable
                  key={w.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${w.name} · ${w.mobile || t('Login not enabled')}`}
                  accessibilityState={{ selected: chosen === w.id }}
                  onPress={() => setChosen(w.id)}
                  style={{
                    padding: 16,
                    borderWidth: 1,
                    borderRadius: 12,
                    backgroundColor: chosen === w.id ? '#E5F3EC' : '#FFFFFF',
                  }}
                >
                  <Text style={styles.heading}>
                    {chosen === w.id ? '✓ ' : ''}
                    {w.name}
                  </Text>
                  <Text>
                    {w.mobile || t('Login not enabled')} ·{' '}
                    {t('Staff profile {0}', [staff.data!.findIndex((p) => p.id === w.id) + 1])}
                  </Text>
                  <Text style={styles.small}>{w.created_at.slice(0, 16).replace('T', ' ')}</Text>
                </Pressable>
              ))}
          </>
        )}
        {selected!.permissions.add_workers && !created && (
          <Button
            title={t(create ? 'Choose existing staff' : 'Create a worker and link')}
            secondary
            onPress={() => setCreate(!create)}
          />
        )}
        {create && !created && (
          <Field label={t('Worker name')} value={name} onChangeText={setName} />
        )}
        {(established || conflict) && (
          <Field label={t('Reason for changing link')} value={reason} onChangeText={setReason} />
        )}
        <Button
          title={t('Save link')}
          busy={action.busy}
          disabled={
            conflict ||
            (established && reason.trim().length < 2) ||
            (create ? name.trim().length < 2 : !chosen)
          }
          onPress={() => void save()}
        />
        <Button
          title={t('Mark not used')}
          secondary
          busy={action.busy}
          disabled={conflict || (established && reason.trim().length < 2)}
          onPress={() => void save(true)}
        />
        {established && (
          <Button
            title={t('Remove link')}
            secondary
            busy={action.busy}
            disabled={conflict || reason.trim().length < 2}
            onPress={() => void save(false, true)}
          />
        )}
      </ScrollView>
    </Modal>
  );
}

function Connection({
  base,
  status,
  refresh,
}: {
  base: string;
  status: Status;
  refresh: () => Promise<void>;
}) {
  const { api, session } = useAuth();
  const action = useAction();
  const [setup, setSetup] = useState(!status.enabled);
  const [confirmed, setConfirmed] = useState(false);
  const [managerView, setManagerView] = useState(status.manager_view);
  const [managerMap, setManagerMap] = useState(status.manager_map);
  const [showBinding, setShowBinding] = useState(false);
  const [revoke, setRevoke] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = pairing
    ? Math.max(0, Math.ceil((Date.parse(pairing.expires_at) - now) / 1000))
    : 0;
  return (
    <>
      <Heading
        title={t('Connection settings')}
        subtitle={t('Real DEV preview. Use recovery controls only when needed.')}
      />
      <Button title={t('Refresh connection')} secondary onPress={refresh} />
      <ErrorText message={action.error} />
      <Card>
        <Text>{t('Connection: {0}', [status.connection])}</Text>
        <Text>
          {t('Last source read: {0}', [status.health?.last_successful_source_read ?? t('None')])}
        </Text>
        <Text>{t('Last server contact: {0}', [status.last_contact ?? t('None')])}</Text>
        <Text>{t('Last delivery: {0}', [status.last_successful_sync ?? t('None')])}</Text>
        <Text>
          {t('Source status: {0} · Pending: {1}', [
            status.health?.status ?? t('Not read'),
            status.health?.pending_observations ?? t('Unknown'),
          ])}
        </Text>
      </Card>
      {session?.role === 'OWNER' && (
        <>
          <Button
            title={t('Review setup and manager permissions')}
            secondary
            onPress={() => setSetup(!setup)}
          />
          {setup && (
            <Card>
              <Text>
                {t('Source: {0} / {1}', [status.scope.source_id, status.scope.generation])}
              </Text>
              <Text>{t('Tracking starts: {0}', [status.scope.tracking_from])}</Text>
              <Text>
                {t('Capture: {0} to {1} (exclusive)', [
                  status.scope.capture_from,
                  status.scope.capture_until,
                ])}
              </Text>
              <Text>
                {t('Firm codes: {0} · Invoice types: {1}', [
                  status.scope.firm_codes.join(', '),
                  status.scope.invoice_types.join(', '),
                ])}
              </Text>
              <Text>{t('Confirm this PC, database generation, scope and tracking date.')}</Text>
              <Switch
                accessibilityLabel={t('Confirm source scope and tracking date')}
                value={confirmed}
                onValueChange={setConfirmed}
              />
              <Text>{t('Allow managers to view')}</Text>
              <Switch
                accessibilityLabel={t('Manager view')}
                value={managerView}
                onValueChange={setManagerView}
              />
              <Text>{t('Allow managers to link salespeople')}</Text>
              <Switch
                accessibilityLabel={t('Manager mapping')}
                value={managerMap}
                onValueChange={setManagerMap}
              />
              <Button
                title={t('Confirm DEV setup')}
                disabled={!confirmed}
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await api(
                      base + '/setup',
                      {
                        scope: status.scope,
                        confirm_source_and_scope: true,
                        manager_view: managerView,
                        manager_map: managerMap,
                      },
                      'POST',
                    );
                    await refresh();
                    setSetup(false);
                  })
                }
              />
            </Card>
          )}
          <Button
            title={t('Show nonsecret PC binding')}
            secondary
            onPress={() => setShowBinding(!showBinding)}
          />
          {showBinding && (
            <Text selectable>
              {JSON.stringify(
                {
                  version: 2,
                  ...status.scope,
                  synthetic_only: false,
                  next_action: 'SEND_REAL_REVIEW_OBSERVATIONS',
                },
                null,
                2,
              )}
            </Text>
          )}
          <Text>
            {t(
              'Eight-digit codes require Windows connector 0.2.0 or later. Already paired PCs do not need to pair again.',
            )}
          </Text>
          {pairing && (
            <Card>
              {remaining > 0 ? (
                <>
                  <Text
                    selectable
                    accessibilityLabel={t('Pairing code')}
                    style={{
                      fontSize: 40,
                      fontWeight: '700',
                      letterSpacing: 4,
                      textAlign: 'center',
                    }}
                  >
                    {pairing.code.replace(/^(\d{4})(\d{4})$/, '$1 $2')}
                  </Text>
                  <Text>{t('Enter this code on your shop PC.')}</Text>
                  <Text>
                    {t('Valid for {0}:{1}', [
                      Math.floor(remaining / 60),
                      String(remaining % 60).padStart(2, '0'),
                    ])}
                  </Text>
                  <Button
                    title={t(copied ? 'Copied' : 'Copy code')}
                    secondary
                    onPress={() =>
                      void action.run(async () => {
                        await Clipboard.setStringAsync(pairing.code);
                        setCopied(true);
                      })
                    }
                  />
                </>
              ) : (
                <Text>
                  {t('Code expired. Create a replacement below, then enter it on the PC.')}
                </Text>
              )}
            </Card>
          )}
          <Button
            title={t(
              pairing ? 'Create replacement pairing code' : 'Create five-minute pairing code',
            )}
            disabled={!status.enabled}
            busy={action.busy}
            onPress={() =>
              void action.run(async () => {
                const result = await api<{ code: string; expires_at: string }>(
                  base + '/pairing',
                  {},
                  'POST',
                );
                setPairing(result);
                setNow(Date.now());
                setCopied(false);
              })
            }
          />
          <Button
            title={t('Stop and revoke DEV connector')}
            secondary
            onPress={() => setRevoke(true)}
          />
          {revoke && (
            <Card>
              <Text>
                {t(
                  'Revoke this PC connection? Imports will stop. Queued bills and history are preserved; pairing is required to reconnect.',
                )}
              </Text>
              <Button
                title={t('Confirm revoke')}
                danger
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await api(base + '/revoke', {}, 'POST');
                    setPairing(null);
                    setRevoke(false);
                    await refresh();
                  })
                }
              />
              <Button title={t('Cancel')} secondary onPress={() => setRevoke(false)} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
function SalesReport({ base }: { base: string }) {
  const { api } = useAuth();
  const action = useAction();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  return (
    <Card>
      <Heading
        title={t('Attributed item sales')}
        subtitle={t(
          'Item observations only, not exact worker net sales. Discounts, rounding and exchanges remain unallocated.',
        )}
      />
      <Field label={t('From (YYYY-MM-DD)')} value={start} onChangeText={setStart} />
      <Field label={t('Until, exclusive (YYYY-MM-DD)')} value={end} onChangeText={setEnd} />
      <ErrorText message={action.error} />
      <Button
        title={t('Load attributed sales')}
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            setReport(null);
            setReport(
              await api(
                `${base}/worker-sales?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
              ),
            );
          })
        }
      />
      {report?.rows.map((r) => (
        <Text key={`${r.bill_id}:${r.line_index}`}>
          {r.item || t('Item')} · {r.salesperson_name || t('Unresolved')} · ₹
          {r.source_item_net ?? t('Unknown')}
        </Text>
      ))}
    </Card>
  );
}
