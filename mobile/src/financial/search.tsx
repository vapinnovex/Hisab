import { t, useLocale } from './../i18n';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useResource } from '../hooks';
import { Routes } from '../types';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Heading,
  Loading,
  Page,
  styles,
} from '../components/ui';
import { FilterChips, SearchField } from '../components/ListControls';
import { dateInZone, monthRange } from './calendar';
import { money } from './money';
import { EntryCard } from './screens';
import { Entry, TransactionType } from './types';
import { TransactionTypeFilter } from './components';

type Results = {
  items: { day_id: string; date: string; day_status: 'OPEN' | 'CLOSED'; entry: Entry }[];
  total: number;
  cash_in: string;
  cash_out: string;
  page: number;
  page_size: number;
  has_more: boolean;
};
function validRange(from: string, to: string) {
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return (
    validDate(from) &&
    validDate(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 366 * 86400000
  );
}
export function HishobSearch({ navigation }: NativeStackScreenProps<Routes, 'HishobSearch'>) {
  useLocale();
  const { selected } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<TransactionType | 'ALL'>('ALL');
  const [period, setPeriod] = useState<'ALL' | 'TODAY' | 'MONTH' | 'CUSTOM'>('ALL');
  const [entryStatus, setEntryStatus] = useState<'ACTIVE' | 'ALL' | 'DELETED'>('ACTIVE');
  const [filters, setFilters] = useState(false);
  const [range, setRange] = useState(monthRange(today.slice(0, 7)));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const dates =
    period === 'MONTH'
      ? monthRange(today.slice(0, 7))
      : period === 'TODAY'
        ? { from: today, to: today }
        : range;
  const params =
    `q=${encodeURIComponent(debounced)}&entry_status=${entryStatus}&page=${page}&page_size=30` +
    (type === 'ALL' ? '' : `&type=${type}`) +
    (period === 'ALL' ? '' : `&from_date=${dates.from}&to_date=${dates.to}`);
  const resource = useResource<Results>(
    `/shops/${selected!.shop_id}/hishob/transactions?${params}`,
  );
  const pending = query.trim() !== debounced || resource.loading;
  const result = pending ? null : resource.data;
  const reset = () => {
    setQuery('');
    setType('ALL');
    setPeriod('ALL');
    setEntryStatus('ACTIVE');
    setPage(1);
  };
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Find transactions')}
        subtitle={t('{0} · Search your cash records', [selected!.shop.name])}
      />
      <SearchField
        label={t('Search transactions')}
        placeholder={t('Description, category or recorded by')}
        value={query}
        onChange={(value) => {
          setQuery(value.slice(0, 100));
          setPage(1);
        }}
      />
      <TransactionTypeFilter
        value={type}
        onChange={(value) => {
          setType(value);
          setPage(1);
        }}
      />
      <FilterChips
        label={t('Search period')}
        value={period}
        onChange={(value) => {
          setPeriod(value);
          setPage(1);
        }}
        options={[
          { value: 'ALL', label: t('All dates') },
          { value: 'TODAY', label: t('Today') },
          { value: 'MONTH', label: t('This month') },
          { value: 'CUSTOM', label: t('Choose dates') },
        ]}
      />
      {period === 'CUSTOM' && (
        <Card>
          <Field
            label={t('Search from date')}
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
          <Field
            label={t('Search to date')}
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
          <Text style={styles.small}>
            {t('Choose up to one year. Use All dates for older records.')}
          </Text>
          <Button
            title={t('Apply search dates')}
            disabled={!validRange(from, to)}
            onPress={() => {
              setRange({ from, to });
              setPage(1);
            }}
          />
        </Card>
      )}
      <Button
        secondary
        title={filters ? t('Hide entry filters') : t('More filters')}
        onPress={() => setFilters(!filters)}
      />
      {filters && (
        <FilterChips
          label={t('Search entries')}
          value={entryStatus}
          onChange={(value) => {
            setEntryStatus(value);
            setPage(1);
          }}
          options={[
            { value: 'ACTIVE', label: t('Active entries') },
            { value: 'ALL', label: t('Include deleted') },
            { value: 'DELETED', label: t('Deleted only') },
          ]}
        />
      )}
      <Text style={styles.small}>
        {period === 'ALL' ? t('All dates') : t('{0} to {1}', [dates.from, dates.to])} ·{' '}
        {entryStatus === 'ACTIVE'
          ? t('Active entries')
          : entryStatus === 'ALL'
            ? t('Including deleted entries')
            : t('Deleted entries only')}{' '}
        {t('· Newest first')}{' '}
      </Text>
      <ErrorText message={resource.error} />
      {pending && <Loading />}
      {result && (
        <>
          <Card>
            <Text style={styles.heading}>
              {result.total === 1
                ? t('{0} matching transaction', [result.total])
                : t('{0} matching transactions', [result.total])}
            </Text>
            <View style={styles.row}>
              <View>
                <Text style={styles.small}>{t('Cash in')}</Text>
                <Text style={styles.heading}>{money(result.cash_in)}</Text>
              </View>
              <View>
                <Text style={styles.small}>{t('Cash out')}</Text>
                <Text style={styles.heading}>{money(result.cash_out)}</Text>
              </View>
            </View>
            <Text style={styles.small}>
              {' '}
              {t(
                'Cash totals cover matching active cash entries across every results page. Digital payments and credit sales do not affect the galla. Sales entered at closing and closing transfers appear in day details and monthly reports.',
              )}{' '}
            </Text>
          </Card>
          {result.items.length === 0 && (
            <EmptyState
              title={t('No matching transactions')}
              description={t('Try another description, category, type or date range.')}
            />
          )}
          {result.items.map(({ entry, day_id, date, day_status }) => (
            <View key={`${day_id}:${entry.id}`} style={{ gap: 8 }}>
              <Text style={styles.eyebrow}>
                {date} · {day_status === 'OPEN' ? t('Day open') : t('Day closed')}
              </Text>
              <EntryCard
                entry={entry}
                zone={selected!.shop.timezone}
                footer={
                  <Button
                    secondary
                    title={t('View day · {0}', [entry.description])}
                    onPress={() => navigation.navigate('HishobDetails', { dayId: day_id })}
                  />
                }
              />
            </View>
          ))}
          {result.total > 0 && (
            <Text style={styles.small}>
              {' '}
              {t('Showing {0}–{1} of {2}', [
                Math.min((page - 1) * result.page_size + 1, result.total),
                Math.min(page * result.page_size, result.total),
                result.total,
              ])}
            </Text>
          )}
          {(page > 1 || result.has_more) && (
            <View style={styles.row}>
              <Button
                secondary
                title={t('Previous results')}
                disabled={page === 1}
                onPress={() => setPage(page - 1)}
              />
              <Button
                secondary
                title={t('Next results')}
                disabled={!result.has_more}
                onPress={() => setPage(page + 1)}
              />
            </View>
          )}
        </>
      )}
      {(query || type !== 'ALL' || period !== 'ALL' || entryStatus !== 'ACTIVE' || page > 1) && (
        <Button secondary title={t('Reset transaction search')} onPress={reset} />
      )}
    </Page>
  );
}
