import { t, useLocale, localeTag } from './../i18n';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth';
import { useResource } from '../hooks';
import { Routes } from '../types';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorText,
  Field,
  Heading,
  Loading,
  MonthPicker,
  Page,
  styles,
} from '../components/ui';
import { FilterChips } from '../components/ListControls';
import { DaySummary, MonthlySummary, TodayHishob } from './types';
import { NewDay } from './today';
import { money } from './money';
import { dateInZone, hasDifference, HishobCalendar, monthRange } from './calendar';

function MissedDay({ date, onCreated }: { date: string; onCreated: (id: string) => void }) {
  useLocale();
  const { selected } = useAuth();
  const resource = useResource<TodayHishob>(
    `/shops/${selected!.shop_id}/hishob/day-context?for_date=${date}`,
    true,
  );
  return (
    <>
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data &&
        (resource.data.day ? (
          <Button
            title={t('Open Hishob · {0}', [date])}
            onPress={() => onCreated(resource.data!.day!.id)}
          />
        ) : (
          <NewDay
            initial={resource.data}
            missed
            refresh={resource.refresh}
            onCreated={(day) => onCreated(day.id)}
          />
        ))}
    </>
  );
}

function DayCard({ day, open }: { day: DaySummary; open: () => void }) {
  useLocale();
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.heading, { flex: 1 }]}>
          {new Intl.DateTimeFormat(localeTag(), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${day.date}T12:00:00Z`))}
        </Text>
        <Text style={[styles.eyebrow, { color: day.status === 'OPEN' ? '#A46C0B' : colors.green }]}>
          {day.status === 'OPEN' ? t('Open') : t('Closed')}
        </Text>
      </View>
      <Text style={styles.small}>
        {day.status === 'OPEN' ? t('Current Galla') : t('Expected')}{' '}
        {money(day.expected_closing_cash)}
        {day.status === 'CLOSED' ? t(' · Cash kept {0}', [money(day.actual_closing_cash)]) : ''}
      </Text>
      <Text style={[styles.heading, { color: hasDifference(day) ? colors.red : colors.green }]}>
        {day.status === 'OPEN'
          ? t('This day is still open. Review entries and close when ready.')
          : day.mode === 'COUNTED'
            ? t('Estimated sales · cash difference not measured')
            : day.difference === null
              ? t('Payment breakdown unknown · cash difference unavailable')
              : t('Difference {0}', [money(day.difference, true)])}
      </Text>
      <Button title={t('Open Hishob · {0}', [day.date])} secondary onPress={open} />
    </Card>
  );
}

export function HishobHistory({ navigation }: NativeStackScreenProps<Routes, 'HishobHistory'>) {
  useLocale();
  const { selected } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const earliest = selected!.shop.created_at
    ? dateInZone(selected!.shop.timezone, new Date(selected!.shop.created_at!))
    : undefined;
  const [showSummary, setShowSummary] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'CALENDAR' | 'LIST'>('CALENDAR');
  const [from, setFrom] = useState(monthRange(month).from);
  const [to, setTo] = useState(monthRange(month).to);
  const [range, setRange] = useState({ from, to });
  const [startingDate, setStartingDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const dates = view === 'CALENDAR' ? monthRange(month) : range;
  const resource = useResource<DaySummary[]>(
    `/shops/${selected!.shop_id}/hishob/days?from_date=${encodeURIComponent(dates.from)}&to_date=${encodeURIComponent(dates.to)}`,
    true,
  );
  const monthly = useResource<MonthlySummary>(
    `/shops/${selected!.shop_id}/hishob/monthly-summary?month=${month}`,
    true,
  );
  const allDays = [...(resource.data || [])].sort((a, b) => b.date.localeCompare(a.date));
  const days = allDays.filter((day) => status === 'ALL' || day.status === status);
  const date =
    selectedDate ||
    days.find((day) => day.date === today)?.date ||
    days[0]?.date ||
    (month === today.slice(0, 7) ? today : `${month}-01`);
  const day = allDays.find((item) => item.date === date);
  const changeMonth = (next: string) => {
    setStartingDate(null);
    setShowSummary(false);
    setMonth(next);
    setSelectedDate(null);
  };
  return (
    <Page refresh={resource.refresh}>
      <Heading
        title={t('Hishob history')}
        subtitle={t('{0} · Your cash, day by day', [selected!.shop.name])}
      />
      <FilterChips
        label={t('History view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'CALENDAR', label: t('Calendar') },
          { value: 'LIST', label: t('Date range') },
        ]}
      />
      {view === 'CALENDAR' ? (
        <>
          <MonthPicker month={month} setMonth={changeMonth} timezone={selected!.shop.timezone} />
          {month !== today.slice(0, 7) && (
            <Button
              title={t('Current month')}
              secondary
              onPress={() => changeMonth(today.slice(0, 7))}
            />
          )}
        </>
      ) : (
        <Card>
          <Field
            label={t('From date')}
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
          <Field
            label={t('To date')}
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
          <Button
            title={t('Apply dates')}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)}
            onPress={() => setRange({ from, to })}
          />
        </Card>
      )}
      <FilterChips
        label={t('Hishob status')}
        value={status}
        onChange={(next) => {
          setStatus(next);
          setSelectedDate(null);
        }}
        options={[
          { value: 'ALL', label: t('All days'), count: allDays.length },
          {
            value: 'OPEN',
            label: t('Open'),
            count: allDays.filter((day) => day.status === 'OPEN').length,
          },
          {
            value: 'CLOSED',
            label: t('Closed'),
            count: allDays.filter((day) => day.status === 'CLOSED').length,
          },
        ]}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <>
          <Text style={styles.small}>
            {t('Cash differences: {0} closed days in the selected period.', [
              allDays.filter(hasDifference).length,
            ])}
          </Text>
          {view === 'CALENDAR' ? (
            <>
              <HishobCalendar
                month={month}
                today={today}
                earliest={earliest}
                days={allDays}
                selected={date}
                onSelect={(next) => {
                  setSelectedDate(next);
                  setStartingDate(null);
                }}
                status={status}
              />
              {day && (status === 'ALL' || day.status === status) ? (
                <DayCard
                  day={day}
                  open={() => navigation.navigate('HishobDetails', { dayId: day.id })}
                />
              ) : (
                <EmptyState
                  title={
                    day
                      ? `${date} · ${day.status === 'OPEN' ? t('Open') : t('Closed')}`
                      : t('{0} · Not started', [date])
                  }
                  description={
                    day
                      ? t('Choose All days to see this day’s summary.')
                      : earliest && date < earliest
                        ? t('This date is before this shop was created.')
                        : t('No cash register was started on this date.')
                  }
                />
              )}
              {!day &&
                date < today &&
                (!earliest || date >= earliest) &&
                (selected!.permissions.reopen_hishob ? (
                  startingDate === date ? (
                    <MissedDay
                      key={`${selected!.shop_id}:${date}`}
                      date={date}
                      onCreated={(dayId) => {
                        setStartingDate(null);
                        navigation.navigate('HishobDetails', { dayId });
                      }}
                    />
                  ) : (
                    <Button
                      title={t('Start missed day · {0}', [date])}
                      onPress={() => setStartingDate(date)}
                    />
                  )
                ) : (
                  <Text style={styles.small}>
                    {' '}
                    {t(
                      'Ask your owner to open this missed day. You can then add entries with Hishob access.',
                    )}{' '}
                  </Text>
                ))}
              {!day && date === today && (
                <Button
                  title={t('Go to today’s Hishob')}
                  onPress={() => navigation.navigate('HishobToday')}
                />
              )}
            </>
          ) : (
            days.map((day) => (
              <DayCard
                key={day.id}
                day={day}
                open={() => navigation.navigate('HishobDetails', { dayId: day.id })}
              />
            ))
          )}
          {days.length === 0 && (
            <EmptyState
              title={t('No Hishob days found')}
              description={t('Try another month or filter, or start today’s Hishob.')}
            />
          )}
        </>
      )}
      {view === 'CALENDAR' && (
        <>
          <ErrorText message={monthly.error} />
          {monthly.data && (
            <Card>
              <Text style={styles.heading}>
                {t('Monthly sales ·')} {money(monthly.data.total_sales)}
              </Text>
              <Text style={styles.small}>
                {t(
                  'Closed days included: {0} · Open: {1} · Not started: {2} (may include shop holidays)',
                  [monthly.data.closed_days, monthly.data.open_days, monthly.data.not_started_days],
                )}
              </Text>
              <Text style={styles.small}>
                {t('Closed days only.')}{' '}
                {t('Sales are not profit. Opening cash and transfers are not sales.')}
              </Text>
              <Button
                secondary
                title={showSummary ? t('Hide monthly breakdown') : t('View monthly breakdown')}
                onPress={() => setShowSummary(!showSummary)}
              />
              {showSummary && (
                <>
                  <Text style={styles.subtitle}>
                    {' '}
                    {t('Recorded sales')} {money(monthly.data.recorded_sales)}{' '}
                    {t('· Estimated cash sales')} {money(monthly.data.estimated_sales)}
                  </Text>
                  <Text style={styles.small}>
                    {' '}
                    {t('Known breakdown · Cash')} {money(monthly.data.cash_sales)}{' '}
                    {t('· UPI / card')} {money(monthly.data.digital_sales)} {t('· Unpaid credit')}{' '}
                    {money(monthly.data.credit_sales)}
                  </Text>
                  {monthly.data.unallocated_days > 0 && (
                    <Text style={styles.small}>
                      {' '}
                      {t(
                        'Sales without payment breakdown · {0} across {1} closed day(s). Included in monthly sales above; cash differences could not be checked for these days.',
                        [money(monthly.data.unallocated_sales), monthly.data.unallocated_days],
                      )}
                    </Text>
                  )}
                  <Text style={styles.small}>
                    {' '}
                    {t('Expenses')} {money(monthly.data.expenses_total)} {t('· Supplier payments')}{' '}
                    {money(monthly.data.supplier_payments)}
                  </Text>
                  <Text style={styles.small}>
                    {' '}
                    {t('Bank transfers')} {money(monthly.data.bank_deposit)}{' '}
                    {t('· Take-home / withdrawals')} {money(monthly.data.withdrawals)}
                  </Text>
                  <Text style={styles.small}>
                    {' '}
                    {t('Closed days only.')} {monthly.data.estimated_days}{' '}
                    {monthly.data.estimated_days === 1
                      ? t('cash-count day includes estimates.')
                      : t('cash-count days include estimates.')}{' '}
                    {t('Sales are not profit. Opening cash and transfers are not sales.')}{' '}
                  </Text>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
