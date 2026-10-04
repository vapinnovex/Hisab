import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { t, useLocale, localeTag } from '../i18n';
import { useAuth } from '../auth';
import { useResource } from '../hooks';
import { SearchField, FilterChips } from '../components/ListControls';
import {
  Button,
  Card,
  ErrorText,
  Heading,
  Loading,
  MonthPicker,
  monthInZone,
  Page,
  styles,
  statusLabel,
} from '../components/ui';
import { Status } from '../types';

type Snapshot = {
  status: Status | null;
  check_in: string | null;
  check_out: string | null;
  note: string | null;
  source: string | null;
};
type Event = {
  id: string;
  employee_name: string;
  employee_mobile?: string;
  date: string;
  at: string;
  by: string;
  actor_name?: string;
  role?: string;
  action: string;
  note?: string;
  status?: Status;
  device_id?: string;
  legacy: boolean;
  before?: Snapshot;
  after?: Snapshot;
};
type Activity = { events: Event[]; has_more: boolean; timezone: string };
export function AttendanceActivityScreen() {
  useLocale();
  const { selected } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(monthInZone(selected!.shop.timezone));
  const [allDates, setAllDates] = useState(false);
  const [source, setSource] = useState<'ALL' | 'FACE' | 'MANUAL'>('ALL');
  const [offset, setOffset] = useState(0);
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const range = allDates ? '' : `&start=${month}-01&end=${month}-${lastDay}`;
  const resource = useResource<Activity>(
    `/shops/${selected!.shop_id}/attendance/activity?q=${encodeURIComponent(search)}&source=${source}&offset=${offset}&limit=30${range}`,
  );
  const stamp = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(localeTag(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: resource.data?.timezone || selected!.shop.timezone,
        }).format(new Date(value))
      : '—';
  const snapshot = (value: Snapshot) =>
    `${value.status ? statusLabel(value.status) : '—'} · ${t('IN')}: ${stamp(value.check_in)} · ${t('OUT')}: ${stamp(value.check_out)}`;
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Attendance activity')}
        subtitle={t(
          'Review face scans, manual entries and corrections. Dates follow the shop timezone.',
        )}
      />
      <SearchField
        label={t('Search attendance activity')}
        placeholder={t('Name, mobile, note or action')}
        value={query}
        onChange={setQuery}
      />
      <Button
        title={t('Search')}
        onPress={() => {
          setSearch(query.trim());
          setOffset(0);
        }}
      />
      <FilterChips
        label={t('Attendance source')}
        value={source}
        onChange={(value) => {
          setSource(value);
          setOffset(0);
        }}
        options={[
          { value: 'ALL', label: t('All') },
          { value: 'FACE', label: t('Face scans') },
          { value: 'MANUAL', label: t('Manual entries') },
        ]}
      />
      <FilterChips
        label={t('Date range')}
        value={allDates ? 'ALL' : 'MONTH'}
        onChange={(value) => {
          setAllDates(value === 'ALL');
          setOffset(0);
        }}
        options={[
          { value: 'MONTH', label: t('Selected month') },
          { value: 'ALL', label: t('All dates') },
        ]}
      />
      {!allDates && (
        <MonthPicker
          month={month}
          timezone={selected!.shop.timezone}
          setMonth={(value) => {
            setMonth(value);
            setOffset(0);
          }}
        />
      )}
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data?.events.length === 0 && (
        <Card>
          <Text style={styles.subtitle}>{t('No attendance activity matches these filters.')}</Text>
        </Card>
      )}
      {resource.data?.events.map((event) => (
        <Card key={event.id}>
          <Text style={styles.heading}>{event.employee_name}</Text>
          <Text style={styles.subtitle}>
            {event.action === 'CHECK_IN'
              ? t('Arrival recorded')
              : event.action === 'CHECK_OUT'
                ? t('Departure recorded')
                : t('Attendance corrected')}{' '}
            · {event.role === 'FACE' ? t('Face scan') : t('Manual entry')}
          </Text>
          <Text style={styles.small}>{t('Attendance date: {0}', [event.date])}</Text>
          <Text style={styles.small}>{t('Recorded: {0}', [stamp(event.at)])}</Text>
          <Text style={styles.small}>{t('Recorded by: {0}', [event.actor_name || event.by])}</Text>
          {event.device_id && (
            <Text style={styles.small}>{t('Station: {0}', [event.device_id])}</Text>
          )}
          {event.before && (
            <View style={{ gap: 6 }}>
              <Text style={styles.small}>{t('Before: {0}', [snapshot(event.before)])}</Text>
              {!!event.before.note && (
                <Text style={styles.small}>{t('Previous note: {0}', [event.before.note])}</Text>
              )}
            </View>
          )}
          {event.after && (
            <Text style={styles.small}>{t('After: {0}', [snapshot(event.after)])}</Text>
          )}
          {(event.after?.note || event.note) && (
            <Text style={styles.subtitle}>{event.after?.note || event.note}</Text>
          )}
          {event.legacy && (
            <Text style={styles.small}>
              {t('Older log: full change details were not recorded.')}
            </Text>
          )}
        </Card>
      ))}
      <View style={{ gap: 8 }}>
        {offset > 0 && (
          <Button
            title={t('Previous page')}
            secondary
            onPress={() => setOffset(Math.max(0, offset - 30))}
          />
        )}
        {resource.data?.has_more && (
          <Button title={t('Next page')} secondary onPress={() => setOffset(offset + 30)} />
        )}
      </View>
    </Page>
  );
}
