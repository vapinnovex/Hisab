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
import { DaySummary } from './types';
import { money } from './money';
import { dateInZone, hasDifference, HishobCalendar, monthRange } from './calendar';

function DayCard({ day, open }: { day: DaySummary; open: () => void }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.heading}>{day.date}</Text>
        <Text style={[styles.eyebrow, { color: day.status === 'OPEN' ? '#A46C0B' : colors.green }]}>
          {day.status}
        </Text>
      </View>
      <Text style={styles.small}>
        Expected {money(day.expected_closing_cash)} · Actual {money(day.actual_closing_cash)}
      </Text>
      <Text style={[styles.heading, { color: hasDifference(day) ? colors.red : colors.green }]}>
        {day.status === 'OPEN'
          ? 'Ready for your next entry'
          : `Difference ${money(day.difference, true)}`}
      </Text>
      <Button title={`Open Hishob · ${day.date}`} secondary onPress={open} />
    </Card>
  );
}

export function HishobHistory({ navigation }: NativeStackScreenProps<Routes, 'HishobHistory'>) {
  const { selected } = useAuth();
  const today = dateInZone(selected!.shop.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'CALENDAR' | 'LIST'>('CALENDAR');
  const [from, setFrom] = useState(monthRange(month).from);
  const [to, setTo] = useState(monthRange(month).to);
  const [range, setRange] = useState({ from, to });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const dates = view === 'CALENDAR' ? monthRange(month) : range;
  const resource = useResource<DaySummary[]>(
    `/shops/${selected!.shop_id}/hishob/days?from_date=${encodeURIComponent(dates.from)}&to_date=${encodeURIComponent(dates.to)}`,
    true,
  );
  const allDays = resource.data || [];
  const days = allDays.filter((day) => status === 'ALL' || day.status === status);
  const date =
    selectedDate ||
    days.find((day) => day.date === today)?.date ||
    days[0]?.date ||
    (month === today.slice(0, 7) ? today : `${month}-01`);
  const day = allDays.find((item) => item.date === date);
  const changeMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(null);
  };
  return (
    <Page refresh={resource.refresh}>
      <Heading title="Hishob history" subtitle={`${selected!.shop.name} · Your cash, day by day`} />
      <FilterChips
        label="History view"
        value={view}
        onChange={setView}
        options={[
          { value: 'CALENDAR', label: 'Calendar' },
          { value: 'LIST', label: 'Date range' },
        ]}
      />
      {view === 'CALENDAR' ? (
        <>
          <MonthPicker month={month} setMonth={changeMonth} timezone={selected!.shop.timezone} />
          {month !== today.slice(0, 7) && (
            <Button
              title="Current month"
              secondary
              onPress={() => changeMonth(today.slice(0, 7))}
            />
          )}
        </>
      ) : (
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
      )}
      <FilterChips
        label="Hishob status"
        value={status}
        onChange={(next) => {
          setStatus(next);
          setSelectedDate(null);
        }}
        options={[
          { value: 'ALL', label: 'All days', count: allDays.length },
          {
            value: 'OPEN',
            label: 'Open',
            count: allDays.filter((day) => day.status === 'OPEN').length,
          },
          {
            value: 'CLOSED',
            label: 'Closed',
            count: allDays.filter((day) => day.status === 'CLOSED').length,
          },
        ]}
      />
      <ErrorText message={resource.error} />
      {resource.loading && <Loading />}
      {resource.data && (
        <>
          <Text style={styles.small}>
            {allDays.filter(hasDifference).length} closed{' '}
            {allDays.filter(hasDifference).length === 1 ? 'day has' : 'days have'} a cash difference
            in this {view === 'CALENDAR' ? 'month' : 'range'}.
          </Text>
          {view === 'CALENDAR' ? (
            <>
              <HishobCalendar
                month={month}
                today={today}
                days={allDays}
                selected={date}
                onSelect={setSelectedDate}
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
                      ? `${date} · ${day.status === 'OPEN' ? 'Open' : 'Closed'}`
                      : `${date} · Not started`
                  }
                  description={
                    day
                      ? 'Choose All days to see this day’s summary.'
                      : 'No cash register was started on this date.'
                  }
                />
              )}
              {!day && date === today && (
                <Button
                  title="Go to today’s Hishob"
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
              title="No Hishob days found"
              description="Try another month or filter, or start today’s Hishob."
            />
          )}
        </>
      )}
    </Page>
  );
}
