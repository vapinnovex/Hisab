import React, { useState } from 'react';
import { Text, View, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import { Routes } from '../types';
import { Button, Card, ErrorText, Field, Heading, Page } from '../components/ui';

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
  audit: { actor_id: string; reason: string; at: string; worker_id: string | null }[];
};
type Directory = {
  people: Person[];
  workers: { id: string; name: string }[];
  history_policy: string;
};
type Bill = {
  id: string;
  key: { invoice_no: string };
  signed_source_payable: string | null;
  owed_to_customer: string | null;
  settlement_status: string;
  historical: boolean;
  source_changed: boolean;
};
type Report = {
  rows: {
    bill_id: string;
    line_index: number;
    item: string;
    source_item_net: string;
    salesperson_name: string;
    worker_id: string | null;
  }[];
  policy: string;
  bill_adjustments: {
    bill_id: string;
    unallocated: Record<string, string | number | null>;
    allocation_status: string;
  }[];
};

export function RealRadioSoftEntry() {
  const { selected, session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<Routes>>();
  const status = useResource<{ enabled: boolean }>(
    `/shops/${selected?.shop_id ?? ''}/radiosoft-real/${session?.role === 'WORKER' ? 'availability' : 'status'}`,
    false,
    !!selected,
  );
  if (!status.data || (session?.role === 'WORKER' && !status.data.enabled)) return null;
  return (
    <Button
      title={
        session?.role === 'WORKER' ? 'My attributed sales (DEV)' : 'RadioSoft real DEV preview'
      }
      secondary
      onPress={() => navigation.navigate('RadioSoftReal')}
    />
  );
}

export function RadioSoftReal() {
  const { selected, session, api } = useAuth();
  const base = `/shops/${selected!.shop_id}/radiosoft-real`;
  const worker = session?.role === 'WORKER';
  const owner = session?.role === 'OWNER';
  const status = useResource<Status>(base + '/status', 15000, !worker);
  const directory = useResource<Directory>(
    base + '/salespeople',
    false,
    !worker && !!status.data?.can_map,
  );
  const [after, setAfter] = useState('');
  const bills = useResource<{ bills: Bill[]; next_cursor: string | null }>(
    base + '/bills?after=' + after,
    false,
    !worker && !!status.data?.can_view,
  );
  const action = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const [managerView, setManagerView] = useState(false);
  const [managerMap, setManagerMap] = useState(false);
  const [code, setCode] = useState('');
  const [showBinding, setShowBinding] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reportResult, setReport] = useState<{ base: string; data: Report } | null>(null);
  const report = reportResult?.base === base ? reportResult.data : null;
  return (
    <Page>
      <Heading
        title="RadioSoft DEV review"
        subtitle="Display only. Financial actions are unavailable."
      />
      <ErrorText message={action.error || status.error} />
      {!worker && status.data && (
        <Card>
          <Text>
            Source: {status.data.scope.source_id} / {status.data.scope.generation}
          </Text>
          <Text>
            Firm codes: {status.data.scope.firm_codes.join(', ')} · Invoice types:{' '}
            {status.data.scope.invoice_types.join(', ')}
          </Text>
          <Text>Tracking starts: {status.data.scope.tracking_from}</Text>
          <Text>
            Capture: {status.data.scope.capture_from} to {status.data.scope.capture_until}{' '}
            (exclusive)
          </Text>
          <Text>
            Older bills remain historical review. Invoice type does not establish payment.
          </Text>
          <Text>
            Connection:{' '}
            {status.data.connection.charAt(0) + status.data.connection.slice(1).toLowerCase()}
          </Text>
          <Text>
            Queue: {status.data.health?.pending_observations ?? 'Unknown'} · Source:{' '}
            {status.data.health?.status ?? 'Not read'}
          </Text>
          <Text>Last source read: {status.data.health?.last_successful_source_read ?? 'None'}</Text>
          <Text>Last delivery: {status.data.last_successful_sync ?? 'None'}</Text>
          <Text>{status.data.coverage}</Text>
          {owner && (
            <>
              <Button
                title="Show nonsecret PC binding"
                secondary
                onPress={() => setShowBinding(!showBinding)}
              />
              {showBinding && (
                <Text selectable>
                  {JSON.stringify(
                    {
                      version: 2,
                      ...status.data.scope,
                      synthetic_only: false,
                      next_action: 'SEND_REAL_REVIEW_OBSERVATIONS',
                    },
                    null,
                    2,
                  )}
                </Text>
              )}

              <Text>
                I confirm this shop PC installation, database generation, firm/type scope and
                tracking date.
              </Text>
              <Switch
                accessibilityLabel="Confirm source scope and tracking date"
                value={confirmed}
                onValueChange={setConfirmed}
              />
              <Text>Allow managers to view</Text>
              <Switch
                accessibilityLabel="Manager view"
                value={managerView}
                onValueChange={setManagerView}
              />
              <Text>Allow managers to map salespeople</Text>
              <Switch
                accessibilityLabel="Manager mapping"
                value={managerMap}
                onValueChange={setManagerMap}
              />
              <Button
                title="Confirm DEV setup"
                disabled={!confirmed}
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    await api(
                      base + '/setup',
                      {
                        scope: status.data!.scope,
                        confirm_source_and_scope: true,
                        manager_view: managerView,
                        manager_map: managerMap,
                      },
                      'POST',
                    );
                    await status.refresh();
                  })
                }
              />
              <Button
                title="Create five-minute pairing code"
                disabled={!status.data.enabled}
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    const response = await api<{ code: string }>(base + '/pairing', {}, 'POST');
                    setCode(response.code);
                  })
                }
              />
              {!!code && <Text selectable>Pairing code: {code}</Text>}
              <Button
                title="Stop and revoke DEV connector"
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    await api(base + '/revoke', {}, 'POST');
                    setCode('');
                    await status.refresh();
                  })
                }
              />
            </>
          )}
        </Card>
      )}
      {!worker && directory.data && (
        <Card>
          <Text>Source salesperson mapping</Text>
          <Text>{directory.data.history_policy}</Text>
          {directory.data.people.map((person) => (
            <PersonMapping
              key={person.id}
              person={person}
              directory={directory.data!}
              base={base}
              refresh={directory.refresh}
            />
          ))}
        </Card>
      )}
      {!worker && status.data?.can_view && (
        <>
          <ErrorText message={directory.error || bills.error} />
          {bills.data?.bills.map((b) => (
            <Card key={b.id}>
              <Text>
                Bill {b.key.invoice_no} · {b.historical ? 'Historical review' : 'Review only'}
              </Text>
              <Text>Signed source payable: ₹{b.signed_source_payable ?? 'Unknown'}</Text>
              <Text>
                Owed to customer: ₹{b.owed_to_customer ?? 'Unknown'} · {b.settlement_status}
              </Text>
              {b.source_changed && <Text>Source edited; review the updated amount.</Text>}
            </Card>
          ))}
          <Button title="First page" secondary onPress={() => setAfter('')} />
          {bills.data?.next_cursor && (
            <Button title="Next bills" onPress={() => setAfter(bills.data!.next_cursor!)} />
          )}
        </>
      )}
      {(worker || status.data?.can_view) && (
        <Card>
          <Text>Attributed item sales</Text>
          <Text>
            Up to 31 days. Source item amounts are provisional; bill discounts, rounding and
            exchanges remain unallocated. Collections are separate.
          </Text>
          <Field label="From (YYYY-MM-DD)" value={start} onChangeText={setStart} />
          <Field label="Until, exclusive (YYYY-MM-DD)" value={end} onChangeText={setEnd} />
          <Button
            title="Load attributed sales"
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                setReport(null);
                setReport({
                  base,
                  data: await api<Report>(
                    base +
                      `/worker-sales?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
                  ),
                });
              })
            }
          />
          {report && <Text>{report.policy}</Text>}
          {report?.bill_adjustments?.map((a) => (
            <View key={a.bill_id}>
              <Text>
                Unallocated bill adjustments ({a.allocation_status}):{' '}
                {Object.entries(a.unallocated)
                  .map(([name, value]) => `${name}: ${value ?? 'Unknown'}`)
                  .join(' · ')}
              </Text>
            </View>
          ))}
          {report?.rows.map((r) => (
            <View key={`${r.bill_id}-${r.line_index}`}>
              <Text>
                {r.item || 'Item'} · {r.salesperson_name || 'Unresolved'} · ₹
                {r.source_item_net ?? 'Unknown'} (source item amount)
              </Text>
            </View>
          ))}
        </Card>
      )}
    </Page>
  );
}

function PersonMapping({
  person,
  directory,
  base,
  refresh,
}: {
  person: Person;
  directory: Directory;
  base: string;
  refresh: () => Promise<void>;
}) {
  const { api } = useAuth();
  const action = useAction();
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const current = directory.workers.find((w) => w.id === person.worker_id);
  const map = (worker_id: string | null) =>
    action.run(async () => {
      await api(
        `${base}/salespeople/${person.id}/mapping`,
        { revision: person.revision, worker_id, reason },
        'PUT',
      );
      await refresh();
      setExpanded(false);
    });
  return (
    <Card>
      <Text>
        {person.ref} · {person.name} →{' '}
        {current?.name ?? (person.worker_id ? 'Inactive worker' : 'Unmapped')}
      </Text>
      <Button
        title={expanded ? 'Close mapping' : 'Change mapping'}
        secondary
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <>
          <Field label="Audit reason" value={reason} onChangeText={setReason} />
          <ErrorText message={action.error} />
          <Button
            title="Leave unmapped"
            disabled={reason.trim().length < 2}
            busy={action.busy}
            onPress={() => map(null)}
          />
          {directory.workers.map((w) => (
            <Button
              key={w.id}
              title={`Link to ${w.name}`}
              disabled={reason.trim().length < 2}
              busy={action.busy}
              onPress={() => map(w.id)}
            />
          ))}
          {person.audit.map((a, i) => (
            <Text key={i}>
              {a.at} · {a.actor_id} · {a.reason}
            </Text>
          ))}
        </>
      )}
    </Card>
  );
}
