import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import {
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
  monthInZone,
} from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { Routes } from '../types';
import { Breakdown, Galla, MoneyField, timestamp } from './components';
import { decimal, money, parseMoney, signedPaise } from './money';
import { Day, Entry, TodayHishob, TransactionType, transactionTypes } from './types';

function NewDay({ initial, refresh }: { initial: TodayHishob; refresh: () => Promise<void> }) {
  const { api, selected } = useAuth();
  const [opening, setOpening] = useState(initial.suggested_opening_cash || '');
  const [reason, setReason] = useState('');
  const action = useAction();
  const override =
    initial.suggested_opening_cash !== null &&
    parseMoney(opening) !== signedPaise(initial.suggested_opening_cash);
  return (
    <>
      <Card>
        <Text style={styles.heading}>Start with the cash in your galla</Text>
        <Text style={styles.subtitle}>
          {initial.previous_closed_date
            ? `Carried from the actual closing cash on ${initial.previous_closed_date}.`
            : 'This is your first day. Count the cash you are starting with.'}
        </Text>
        <MoneyField label="Opening cash" value={opening} onChange={setOpening} />
        {override && (
          <Field
            label="Opening change reason"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            placeholder="Why is the opening different?"
          />
        )}
      </Card>
      <ErrorText message={action.error} />
      <Button
        title="Start today’s Hishob"
        busy={action.busy}
        disabled={parseMoney(opening) === null || (override && reason.trim().length < 2)}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days`,
              { opening_cash: opening.trim(), reason },
              'POST',
            );
            await refresh();
          })
        }
      />
    </>
  );
}

export function HishobToday({ navigation }: NativeStackScreenProps<Routes, 'HishobToday'>) {
  const { selected } = useAuth();
  const resource = useResource<TodayHishob>(`/shops/${selected!.shop_id}/hishob/today`, true);
  const day = resource.data?.day;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title="Today’s Hishob"
        subtitle={`${selected!.shop.name} · ${resource.data?.date || 'Your daily cash register'}`}
      />
      <Button
        title="Hishob history"
        secondary
        onPress={() => navigation.navigate('HishobHistory')}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && !day && (
        <NewDay key={resource.data.date} initial={resource.data} refresh={resource.refresh} />
      )}
      {day && (
        <>
          <Text style={styles.eyebrow}>{day.status === 'CLOSED' ? 'DAY CLOSED' : 'DAY OPEN'}</Text>
          <Galla
            expected={day.expected_closing_cash}
            {...(day.status === 'CLOSED'
              ? { actual: day.actual_closing_cash, difference: day.difference }
              : {})}
          />
          {day.status === 'OPEN' && (
            <Button
              title="Add transaction"
              onPress={() => navigation.navigate('HishobTransaction', { dayId: day.id })}
            />
          )}
          <Breakdown day={day} />
          <Button
            title={`View transactions (${day.transactions.filter((entry) => !entry.deleted).length})`}
            secondary
            onPress={() => navigation.navigate('HishobTransactions', { dayId: day.id })}
          />
          {day.status === 'OPEN' && selected!.permissions.close_hishob && (
            <Button
              title="Close day"
              onPress={() => navigation.navigate('HishobClose', { dayId: day.id })}
            />
          )}
          <Button
            title="Day details & audit"
            secondary
            onPress={() => navigation.navigate('HishobDetails', { dayId: day.id })}
          />
        </>
      )}
    </Page>
  );
}

function TransactionForm({
  initial: loaded,
  entryId,
  done,
}: {
  initial: Day;
  entryId?: string;
  done: () => void;
}) {
  const [initial] = useState(loaded);
  const { api, selected } = useAuth();
  const entry = initial.transactions.find((item) => item.id === entryId);
  const [type, setType] = useState<TransactionType>(entry?.type || 'CASH_SALE');
  const [amount, setAmount] = useState(entry?.amount || '');
  const [description, setDescription] = useState(entry?.description || '');
  const [category, setCategory] = useState(entry?.category || '');
  const [reason, setReason] = useState('');
  const [requestId] = useState(
    () => `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const action = useAction();
  if (initial.status !== 'OPEN' || (entryId && (!entry || entry.deleted)))
    return <ErrorText message="This entry is no longer editable. Go back and refresh the day." />;
  return (
    <>
      <FilterChips
        label="Transaction type"
        options={transactionTypes.map((item) => ({ value: item.type, label: item.label }))}
        value={type}
        onChange={setType}
      />
      <Card>
        <MoneyField label="Amount (₹)" value={amount} onChange={setAmount} />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Tea, transport, cash sales"
          maxLength={300}
        />
        <Field
          label="Category (optional)"
          value={category}
          onChangeText={setCategory}
          placeholder="e.g. Shop expenses"
          maxLength={80}
        />
        {entryId && (
          <Field
            label="Correction reason"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
        )}
      </Card>
      <ErrorText message={action.error} />
      <Button
        title={entryId ? 'Save correction' : 'Save transaction'}
        busy={action.busy}
        disabled={
          parseMoney(amount) === null ||
          parseMoney(amount) === BigInt(0) ||
          !description.trim() ||
          (!!entryId && reason.trim().length < 2)
        }
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${initial.id}/transactions${entryId ? '/' + entryId : ''}`,
              {
                revision: initial.revision,
                type,
                amount: amount.trim(),
                description,
                category,
                ...(entryId ? { reason } : { request_id: requestId }),
              },
              entryId ? 'PATCH' : 'POST',
            );
            done();
          })
        }
      />
      <Text style={styles.small}>
        If the day changes on another device, go back and refresh before saving again.
      </Text>
    </>
  );
}
export function HishobTransaction({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'HishobTransaction'>) {
  const { selected } = useAuth();
  const resource = useResource<Day>(
    `/shops/${selected!.shop_id}/hishob/days/${route.params.dayId}`,
  );
  return (
    <Page>
      <Heading
        title={route.params.entryId ? 'Correct transaction' : 'Add transaction'}
        subtitle="One amount. One clear entry."
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <TransactionForm
          initial={resource.data}
          entryId={route.params.entryId}
          done={() => navigation.goBack()}
        />
      )}
    </Page>
  );
}

function EntryCard({ entry, zone, edit }: { entry: Entry; zone: string; edit?: () => void }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.heading, { flex: 1 }]}>{entry.description}</Text>
        <Text style={styles.heading}>{money(entry.amount)}</Text>
      </View>
      <Text style={styles.small}>
        {transactionTypes.find((type) => type.type === entry.type)?.label}
        {entry.category ? ` · ${entry.category}` : ''}
        {entry.deleted ? ' · Deleted' : ''}
      </Text>
      <Text style={styles.small}>
        Added by {entry.created_by.name} · {timestamp(entry.created_at, zone)}
      </Text>
      {entry.updated_by && (
        <Text style={styles.small}>
          Changed by {entry.updated_by.name} · {timestamp(entry.updated_at, zone)}
        </Text>
      )}
      {entry.deleted_by && <Text style={styles.small}>Deleted by {entry.deleted_by.name}</Text>}
      {edit && <Button title={`Edit · ${entry.description}`} secondary onPress={edit} />}
    </Card>
  );
}
export function HishobTransactions({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'HishobTransactions'>) {
  const { selected, api } = useAuth();
  const resource = useResource<Day>(
    `/shops/${selected!.shop_id}/hishob/days/${route.params.dayId}`,
    true,
  );
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [deleting, setDeleting] = useState<{ entry: Entry; revision: number } | null>(null);
  const [reason, setReason] = useState('');
  const action = useAction();
  const editable =
    selected!.permissions.edit_hishob_transactions && resource.data?.status === 'OPEN';
  const entries =
    resource.data?.transactions.filter((entry) => filter === 'ALL' || !entry.deleted) || [];
  return (
    <Page refresh={resource.refresh}>
      <Heading title="Transactions" subtitle={resource.data?.date} />
      {resource.data?.status === 'OPEN' && (
        <Button
          title="Add transaction"
          onPress={() => navigation.navigate('HishobTransaction', { dayId: route.params.dayId })}
        />
      )}
      <FilterChips
        label="Entries"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ACTIVE', label: 'Active entries' },
          { value: 'ALL', label: 'Include deleted' },
        ]}
      />
      <ErrorText message={resource.error || action.error} />
      {resource.loading && <Loading />}
      {deleting && (
        <Card>
          <Text style={styles.heading}>Delete {deleting.entry.description}?</Text>
          <Text style={styles.small}>
            The entry remains in the audit trail but is removed from totals.
          </Text>
          <Field label="Deletion reason" value={reason} onChangeText={setReason} maxLength={500} />
          <Button
            title="Confirm deletion"
            danger
            busy={action.busy}
            disabled={reason.trim().length < 2}
            onPress={() =>
              void action.run(async () => {
                await api(
                  `/shops/${selected!.shop_id}/hishob/days/${route.params.dayId}/transactions/${deleting.entry.id}/delete`,
                  { revision: deleting.revision, reason },
                  'POST',
                );
                setDeleting(null);
                setReason('');
                await resource.refresh();
              })
            }
          />
          <Button
            title="Cancel deletion"
            secondary
            disabled={action.busy}
            onPress={() => setDeleting(null)}
          />
        </Card>
      )}
      {resource.data && entries.length === 0 && (
        <EmptyState
          title="No entries yet"
          description="Add a sale, expense or another cash movement."
        />
      )}
      {entries.map((entry) => (
        <View key={entry.id} style={{ gap: 8 }}>
          <EntryCard
            entry={entry}
            zone={selected!.shop.timezone}
            edit={
              editable && !entry.deleted
                ? () =>
                    navigation.navigate('HishobTransaction', {
                      dayId: route.params.dayId,
                      entryId: entry.id,
                    })
                : undefined
            }
          />
          {editable && !entry.deleted && (
            <Button
              title={`Delete · ${entry.description}`}
              secondary
              onPress={() => {
                setDeleting({ entry, revision: resource.data!.revision });
                setReason('');
              }}
            />
          )}
        </View>
      ))}
    </Page>
  );
}

function CloseForm({ initial: loaded, done }: { initial: Day; done: () => void }) {
  const [initial] = useState(loaded);
  const { api, selected } = useAuth();
  const [actual, setActual] = useState('');
  const [differenceNote, setDifferenceNote] = useState('');
  const [notes, setNotes] = useState(initial.notes);
  const action = useAction();
  const value = parseMoney(actual);
  const difference =
    value === null ? null : decimal(value - signedPaise(initial.expected_closing_cash));
  const needsNote = difference !== null && signedPaise(difference) !== BigInt(0);
  if (initial.status !== 'OPEN')
    return <Text style={styles.subtitle}>This day is already closed.</Text>;
  return (
    <>
      <Breakdown day={initial} />
      <Galla
        expected={initial.expected_closing_cash}
        actual={value === null ? null : actual.trim()}
        difference={difference}
      />
      <MoneyField label="Actual cash in galla" value={actual} onChange={setActual} />
      {needsNote && (
        <>
          <Text style={styles.small}>
            A difference is okay. Record why so you can review it later.
          </Text>
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
      <Field
        label="Day notes (optional)"
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1000}
      />
      <ErrorText message={action.error} />
      <Button
        title="Close today’s Hishob"
        busy={action.busy}
        disabled={value === null || (needsNote && differenceNote.trim().length < 2)}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${initial.id}/close`,
              {
                revision: initial.revision,
                actual_closing_cash: actual.trim(),
                difference_note: differenceNote,
                notes,
              },
              'POST',
            );
            done();
          })
        }
      />
      <Text style={styles.small}>
        Closing preserves this breakdown. Only the owner can reopen it, with a recorded reason. If
        another entry arrives before you close, refresh and review the updated total.
      </Text>
    </>
  );
}
export function HishobClose({ route, navigation }: NativeStackScreenProps<Routes, 'HishobClose'>) {
  const { selected } = useAuth();
  const resource = useResource<Day>(
    `/shops/${selected!.shop_id}/hishob/days/${route.params.dayId}`,
  );
  return (
    <Page>
      <Heading title="Close the day" subtitle={resource.data?.date} />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <CloseForm
          initial={resource.data}
          done={() => navigation.replace('HishobDetails', { dayId: route.params.dayId })}
        />
      )}
    </Page>
  );
}

export function HishobHistory({ navigation }: NativeStackScreenProps<Routes, 'HishobHistory'>) {
  const { selected } = useAuth();
  const month = monthInZone(selected!.shop.timezone);
  const [from, setFrom] = useState(month + '-01');
  const [to, setTo] = useState(
    month + '-' + new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate(),
  );
  const [range, setRange] = useState({ from, to });
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const resource = useResource<Day[]>(
    `/shops/${selected!.shop_id}/hishob/days?from_date=${encodeURIComponent(range.from)}&to_date=${encodeURIComponent(range.to)}`,
    true,
  );
  const days = resource.data?.filter((day) => status === 'ALL' || day.status === status);
  return (
    <Page refresh={resource.refresh}>
      <Heading title="Hishob history" subtitle={selected!.shop.name} />
      <Card>
        <Field
          label="From date"
          value={from}
          onChangeText={setFrom}
          placeholder="YYYY-MM-DD"
          maxLength={10}
        />
        <Field
          label="To date"
          value={to}
          onChangeText={setTo}
          placeholder="YYYY-MM-DD"
          maxLength={10}
        />
        <Button
          title="Apply dates"
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)}
          onPress={() => setRange({ from, to })}
        />
      </Card>
      <FilterChips
        label="Hishob status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'ALL', label: 'All days' },
          { value: 'OPEN', label: 'Open' },
          { value: 'CLOSED', label: 'Closed' },
        ]}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {days?.length === 0 && (
        <EmptyState
          title="No Hishob days found"
          description="Try another date range, or start today’s Hishob."
        />
      )}
      {days?.map((day) => (
        <Card key={day.id}>
          <View style={styles.row}>
            <Text style={styles.heading}>{day.date}</Text>
            <Text style={styles.eyebrow}>{day.status}</Text>
          </View>
          <Text style={styles.small}>
            Expected {money(day.expected_closing_cash)} · Actual {money(day.actual_closing_cash)}
          </Text>
          <Text
            style={[
              styles.heading,
              { color: day.difference?.startsWith('-') ? colors.red : colors.green },
            ]}
          >
            Difference {money(day.difference, true)}
          </Text>
          <Button
            title={`Open Hishob · ${day.date}`}
            secondary
            onPress={() => navigation.navigate('HishobDetails', { dayId: day.id })}
          />
        </Card>
      ))}
    </Page>
  );
}

function ChangeOpening({ initial: loaded, done }: { initial: Day; done: () => Promise<void> }) {
  const [initial] = useState(loaded);
  const { api, selected } = useAuth();
  const [opening, setOpening] = useState(initial.opening_cash);
  const [reason, setReason] = useState('');
  const action = useAction();
  return (
    <Card>
      <MoneyField label="Updated opening cash" value={opening} onChange={setOpening} />
      <Field
        label="Opening correction reason"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
      />
      <ErrorText message={action.error} />
      <Button
        title="Save opening cash"
        busy={action.busy}
        disabled={parseMoney(opening) === null || reason.trim().length < 2}
        onPress={() =>
          void action.run(async () => {
            await api(
              `/shops/${selected!.shop_id}/hishob/days/${initial.id}/opening`,
              { revision: initial.revision, opening_cash: opening.trim(), reason },
              'PATCH',
            );
            await done();
          })
        }
      />
    </Card>
  );
}
function AuditValues({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <Text style={styles.small}>—</Text>;
  return (
    <Text style={styles.small}>
      {Object.entries(value)
        .filter(([key]) =>
          [
            'type',
            'amount',
            'description',
            'category',
            'deleted',
            'opening_cash',
            'actual_closing_cash',
            'expected_closing_cash',
            'difference',
            'status',
          ].includes(key),
        )
        .map(([key, entry]) => `${key.replaceAll('_', ' ')}: ${entry ?? '—'}`)
        .join(' · ') || 'Day created'}
    </Text>
  );
}
export function HishobDetails({
  route,
  navigation,
}: NativeStackScreenProps<Routes, 'HishobDetails'>) {
  const { selected, api } = useAuth();
  const resource = useResource<Day>(
    `/shops/${selected!.shop_id}/hishob/days/${route.params.dayId}`,
    true,
  );
  const [opening, setOpening] = useState<Day | null>(null);
  const [reopenRevision, setReopenRevision] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const action = useAction();
  const day = resource.data;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title="Hishob day details"
        subtitle={day ? `${day.date} · ${day.status}` : selected!.shop.name}
      />
      <ErrorText message={resource.error || action.error} />
      {resource.loading && <Loading />}
      {day && (
        <>
          <Galla
            expected={day.expected_closing_cash}
            actual={day.actual_closing_cash}
            difference={day.difference}
          />
          <Breakdown day={day} />
          {day.opening_source && (
            <Text style={styles.small}>
              Opening carried from {day.opening_source.date}:{' '}
              {money(day.opening_source.actual_closing_cash)}. Later corrections do not change this
              day’s opening automatically.
            </Text>
          )}
          {day.closed_by && (
            <Text style={styles.small}>
              Closed by {day.closed_by.name} · {timestamp(day.closed_at!, day.timezone)}
            </Text>
          )}
          {day.difference_note ? (
            <Text style={styles.subtitle}>Difference note: {day.difference_note}</Text>
          ) : null}
          {day.notes ? <Text style={styles.subtitle}>Notes: {day.notes}</Text> : null}
          <Button
            title={`View transactions (${day.transactions.filter((entry) => !entry.deleted).length})`}
            secondary
            onPress={() => navigation.navigate('HishobTransactions', { dayId: day.id })}
          />
          {day.status === 'OPEN' && (
            <>
              <Button
                title="Add transaction"
                onPress={() => navigation.navigate('HishobTransaction', { dayId: day.id })}
              />
              <Button title="Change opening cash" secondary onPress={() => setOpening(day)} />
              {selected!.permissions.close_hishob && (
                <Button
                  title="Close day"
                  onPress={() => navigation.navigate('HishobClose', { dayId: day.id })}
                />
              )}
            </>
          )}
          {opening && day.status === 'OPEN' && (
            <>
              <ChangeOpening
                initial={opening}
                done={async () => {
                  setOpening(null);
                  await resource.refresh();
                }}
              />
              <Button title="Cancel opening change" secondary onPress={() => setOpening(null)} />
            </>
          )}
          {day.status === 'CLOSED' && selected!.permissions.reopen_hishob && (
            <Button title="Reopen day" secondary onPress={() => setReopenRevision(day.revision)} />
          )}
          {reopenRevision !== null && day.status === 'CLOSED' && (
            <Card>
              <Text style={styles.subtitle}>
                The original closing is kept. Changes will be recorded in the audit trail and
                carried openings on other days remain unchanged.
              </Text>
              <Field
                label="Reopening reason"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
              />
              <Button
                title="Confirm reopening"
                busy={action.busy}
                disabled={reason.trim().length < 2}
                onPress={() =>
                  void action.run(async () => {
                    await api(
                      `/shops/${selected!.shop_id}/hishob/days/${day.id}/reopen`,
                      { revision: reopenRevision, reason },
                      'POST',
                    );
                    setReopenRevision(null);
                    setReason('');
                    await resource.refresh();
                  })
                }
              />
              <Button
                title="Cancel reopening"
                secondary
                disabled={action.busy}
                onPress={() => setReopenRevision(null)}
              />
            </Card>
          )}
          {day.closing_snapshots.length > 0 && (
            <Text style={styles.heading}>Preserved closings</Text>
          )}
          {day.closing_snapshots.map((item, index) => (
            <Card key={item.snapshot_id}>
              <Text style={styles.heading}>
                Closing {index + 1} · {money(item.difference, true)}
              </Text>
              <Text style={styles.small}>
                {item.closed_by.name} · {timestamp(item.closed_at, day.timezone)}
              </Text>
              <Button
                title={`View closing ${index + 1}`}
                secondary
                onPress={() => setSnapshot(snapshot === item.snapshot_id ? null : item.snapshot_id)}
              />
              {snapshot === item.snapshot_id && (
                <>
                  <Breakdown day={item} />
                  <Galla
                    expected={item.expected_closing_cash}
                    actual={item.actual_closing_cash}
                    difference={item.difference}
                  />
                  <Text style={styles.small}>
                    {item.difference_note} {item.notes}
                  </Text>
                  {item.transactions.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} zone={day.timezone} />
                  ))}
                </>
              )}
            </Card>
          ))}
          <Button
            title={showAudit ? 'Hide audit trail' : 'View audit trail'}
            secondary
            onPress={() => setShowAudit(!showAudit)}
          />
          {showAudit &&
            [...day.audit].reverse().map((event) => (
              <Card key={event.id}>
                <Text style={styles.heading}>{event.action.replaceAll('_', ' ')}</Text>
                <Text style={styles.small}>
                  {event.actor.name} ({event.actor.role}) · {timestamp(event.at, day.timezone)}
                </Text>
                <Text style={styles.label}>Before</Text>
                <AuditValues value={event.previous} />
                <Text style={styles.label}>After</Text>
                <AuditValues value={event.new} />
                {event.reason ? <Text style={styles.subtitle}>{event.reason}</Text> : null}
              </Card>
            ))}
        </>
      )}
    </Page>
  );
}
