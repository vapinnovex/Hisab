import { localeTag, t, useLocale } from './../i18n';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useUnsavedChanges } from '../pwa';
import { useAuth } from '../auth';
import { useAction, useResource } from '../hooks';
import {
  Button as PlainButton,
  colors,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Page,
  styles,
} from '../components/ui';
import { Routes } from '../types';
import { Calculator } from './Calculator';
import { dateInZone } from './calendar';
import { Breakdown, MoneyField } from './components';
import { FinancialHelp } from './help';
import { money, parseMoney, signedPaise } from './money';
import { Day, TodayHishob, transactionTypes, modeLabels } from './types';

export function NewDay({
  initial,
  refresh,
  changeMethod,
  onCreated,
  missed = false,
}: {
  onCreated?: (day: Day) => void;
  missed?: boolean;
  initial: TodayHishob;
  refresh: () => Promise<void>;
  changeMethod?: () => void;
}) {
  useLocale();
  const { api, selected } = useAuth();
  // Follow refreshed carry-forward cash until the owner explicitly edits it.
  const [openingDraft, setOpening] = useState<string | null>(null);
  const opening = openingDraft ?? initial.suggested_opening_cash ?? '';
  const [reason, setReason] = useState('');
  const action = useAction();
  useUnsavedChanges(opening !== (initial.suggested_opening_cash || '') || !!reason);
  const override =
    initial.suggested_opening_cash !== null &&
    parseMoney(opening) !== signedPaise(initial.suggested_opening_cash);
  return (
    <View style={hishobStyles.startCard}>
      <View style={hishobStyles.startHeader}>
        <View style={hishobStyles.startIcon}>
          <Ionicons name="wallet-outline" size={24} color="#F4CD72" />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={hishobStyles.startTitle}>
            {missed ? t('Start missed day') : t('Start your day')}
          </Text>
          {missed && <Text style={hishobStyles.balanceNote}>{initial.date}</Text>}
          <Text style={hishobStyles.balanceNote}>
            {missed
              ? t('Open this date so you or your manager can fill the missed entries.')
              : t('A fresh Hishob for today.')}
          </Text>
        </View>
      </View>
      <View style={hishobStyles.startForm}>
        <MoneyField label={t('Opening cash')} value={opening} onChange={setOpening} />
        {initial.suggested_opening_cash !== null && initial.previous_closed_date ? (
          <View style={hishobStyles.carryNote}>
            <Ionicons name="return-down-forward-outline" size={18} color={colors.green} />
            <Text style={[styles.small, { flex: 1, color: colors.green }]}>
              {money(initial.suggested_opening_cash)} {t('carried from')}{' '}
              {new Intl.DateTimeFormat(localeTag(), {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              }).format(new Date(`${initial.previous_closed_date}T12:00:00Z`))}{' '}
              {t('. Check this against the cash in your galla.')}{' '}
            </Text>
          </View>
        ) : (
          <Text style={styles.small}>
            {' '}
            {t('Enter the cash in your galla (₹). Starting with no cash? Enter 0.')}{' '}
          </Text>
        )}
        {(override || missed) && (
          <Field
            required
            minLength={2}
            label={missed ? t('Reason for opening missed day') : t('Opening change reason')}
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            placeholder={
              missed ? t('Why was this day missed?') : t('Why is the opening different?')
            }
          />
        )}
        {missed && (
          <Text style={styles.small}>
            {' '}
            {t(
              'Use the opening cash for this date. Entries keep their actual recording time. Existing later days will keep their saved opening balances; review those balances after closing this day.',
            )}{' '}
          </Text>
        )}
        <ErrorText message={action.error} />
        <PlainButton
          title={missed ? t('Start Hishob · {0}', [initial.date]) : t('Start today’s Hishob')}
          busy={action.busy}
          disabled={
            parseMoney(opening) === null || ((override || missed) && reason.trim().length < 2)
          }
          onPress={() =>
            void action.run(async () => {
              const created = await api<Day>(
                `/shops/${selected!.shop_id}/hishob/days`,
                { date: initial.date, opening_cash: opening.trim(), reason },
                'POST',
              );
              await refresh();
              onCreated?.(created);
            })
          }
        />
      </View>
      <View style={hishobStyles.methodRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.small}>{t('Sales method')}</Text>
          <Text style={hishobStyles.linkText}>
            {modeLabels[selected!.shop.settings.hishob_mode]}
          </Text>
        </View>
        {changeMethod && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Choose Hishob method')}
            onPress={changeMethod}
            style={({ pressed }) => [hishobStyles.textAction, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Text style={hishobStyles.linkText}>{t('Change')}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.green} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DailyBalance({ day }: { day: Day }) {
  useLocale();
  const open = day.status === 'OPEN';
  const unknown = open && day.expected_closing_cash === null;
  const balance = unknown
    ? t('Available at closing')
    : money(open ? day.expected_closing_cash : day.actual_closing_cash);
  return (
    <View style={hishobStyles.balanceCard}>
      <View style={styles.row}>
        <Text style={hishobStyles.balanceLabel}>
          {open ? t('CURRENT GALLA') : t('CASH KEPT IN GALLA')}
        </Text>
        <View style={hishobStyles.dayBadge}>
          <Ionicons
            name={open ? 'ellipse' : 'checkmark-circle'}
            size={open ? 7 : 13}
            color="#D9EDDE"
          />
          <Text style={{ color: '#EDF5EE', fontSize: 12, fontWeight: '600' }}>
            {open ? t('Day open') : t('Day closed')}
          </Text>
        </View>
      </View>
      <Text
        selectable
        accessibilityLabel={`${open ? t('Current galla') : t('Cash kept in galla')}: ${balance}`}
        style={[
          hishobStyles.balanceAmount,
          { fontSize: unknown ? 24 : balance.length > 12 ? 26 : 36 },
        ]}
      >
        {balance}
      </Text>
      <Text style={hishobStyles.balanceNote}>
        {open
          ? unknown
            ? day.mode === 'COUNTED'
              ? t('Record expenses now. Count cash at closing to estimate sales.')
              : t('Record expenses now. Enter billing totals at closing.')
            : t('Based on recorded cash movements. Count your cash before closing.')
          : t('Closing saved. This is the cash retained for the next day.')}
      </Text>
      {!open && (
        <View style={hishobStyles.closedCheck}>
          {day.expected_closing_cash !== null && (
            <Text style={hishobStyles.balanceNote}>
              {' '}
              {t('Expected cash ·')} {money(day.expected_closing_cash)}
            </Text>
          )}
          <Text style={{ color: '#F4CD72', fontSize: 14, lineHeight: 21, fontWeight: '600' }}>
            {day.difference === null
              ? day.mode === 'COUNTED'
                ? t('Cash sales are estimated; a cash difference cannot be independently checked.')
                : t('Cash difference unavailable without a payment breakdown.')
              : t('Difference {0}', [money(day.difference, true)])}
          </Text>
        </View>
      )}
    </View>
  );
}

export function HishobToday({ navigation }: NativeStackScreenProps<Routes, 'HishobToday'>) {
  useLocale();
  const { selected } = useAuth();
  const resource = useResource<TodayHishob>(`/shops/${selected!.shop_id}/hishob/today`, true);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const day = resource.data?.day;
  const date = resource.data?.date || dateInZone(selected!.shop.timezone);
  const largeTotals =
    day && Math.max(money(day.total_sales ?? null).length, money(day.expenses_total).length) > 11;
  const entries = [...(day?.transactions || [])]
    .filter((entry) => !entry.deleted)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const tools: {
    label: string;
    accessibilityLabel: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = [
    {
      label: t('History'),
      accessibilityLabel: t('Hishob history'),
      icon: 'calendar-outline',
      onPress: () => navigation.navigate('HishobHistory'),
    },
    {
      label: t('Search'),
      accessibilityLabel: t('Search transactions'),
      icon: 'search-outline',
      onPress: () => navigation.navigate('HishobSearch'),
    },
    {
      label: t('Customer dues'),
      accessibilityLabel: t('Customer dues'),
      icon: 'people-outline',
      onPress: () => navigation.navigate('CustomerDues'),
    },
  ];
  return (
    <Page refresh={resource.refresh}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.title}>{t('Hishob')}</Text>
          <Text style={styles.small}>
            {new Intl.DateTimeFormat(localeTag(), {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${date}T12:00:00Z`))}
          </Text>
        </View>
        <Calculator />
      </View>
      <ErrorText message={resource.error} />
      {!!resource.error && (
        <View style={{ gap: 8 }}>
          {day && <Text style={styles.small}>{t('Showing the last loaded totals.')}</Text>}
          <PlainButton
            title={t('Retry Hishob')}
            secondary
            onPress={() => void resource.refresh()}
          />
        </View>
      )}
      {resource.loading && <Loading />}
      {resource.data &&
        !day &&
        (selected!.permissions.add_hishob_transactions ? (
          <NewDay
            key={`${selected!.shop_id}:${resource.data.date}`}
            initial={resource.data}
            refresh={resource.refresh}
            changeMethod={
              selected!.permissions.manage_settings
                ? () => navigation.navigate('ShopSettings')
                : undefined
            }
          />
        ) : (
          <EmptyState
            title={t('Today’s Hishob hasn’t started')}
            description={t(
              'An authorised team member can start the day by recording opening cash.',
            )}
          />
        ))}
      {day && (
        <View style={{ gap: 12 }}>
          <DailyBalance day={day} />
          {day.status === 'OPEN' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {selected!.permissions.add_hishob_transactions && (
                <View style={{ flex: 1, minWidth: 148 }}>
                  <PlainButton
                    title={t('Add transaction')}
                    onPress={() => navigation.navigate('HishobTransaction', { dayId: day.id })}
                  />
                </View>
              )}
              {selected!.permissions.close_hishob && (
                <View
                  style={{
                    minWidth: 112,
                    flexGrow: selected!.permissions.add_hishob_transactions ? 0 : 1,
                  }}
                >
                  <PlainButton
                    title={t('Close day')}
                    secondary
                    onPress={() => navigation.navigate('HishobClose', { dayId: day.id })}
                  />
                </View>
              )}
            </View>
          ) : (
            <PlainButton
              title={t('Day details & audit')}
              onPress={() => navigation.navigate('HishobDetails', { dayId: day.id })}
            />
          )}
        </View>
      )}
      <View style={hishobStyles.tools}>
        {tools.map((tool) => (
          <Pressable
            key={tool.label}
            accessibilityRole="button"
            accessibilityLabel={tool.accessibilityLabel}
            onPress={tool.onPress}
            style={({ pressed }) => [hishobStyles.tool, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Ionicons name={tool.icon} size={22} color={colors.green} />
            <Text style={hishobStyles.toolLabel}>{tool.label}</Text>
          </Pressable>
        ))}
      </View>
      {day && (
        <>
          <View style={hishobStyles.summary}>
            <View style={{ flexDirection: largeTotals ? 'column' : 'row', gap: 16 }}>
              <View style={hishobStyles.metric}>
                <Text style={styles.small}>{t('Today’s sales')}</Text>
                <Text style={hishobStyles.metricValue}>
                  {day.total_sales == null ? t('At closing') : money(day.total_sales)}
                </Text>
                <Text style={hishobStyles.metricNote}>
                  {day.mode === 'COUNTED'
                    ? day.total_sales == null
                      ? t('Estimated at closing')
                      : t('Includes estimated cash sales')
                    : day.total_sales == null
                      ? t('From your billing totals')
                      : t('Cash, digital & unpaid sales')}
                </Text>
              </View>
              <View
                style={[
                  hishobStyles.metric,
                  largeTotals
                    ? { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 }
                    : { borderLeftWidth: 1, borderLeftColor: colors.line, paddingLeft: 16 },
                ]}
              >
                <Text style={styles.small}>{t('Expenses')}</Text>
                <Text style={hishobStyles.metricValue}>{money(day.expenses_total)}</Text>
                <Text style={hishobStyles.metricNote}>{t('Cash & digital expenses')}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Cash breakdown')}
              aria-expanded={breakdownOpen}
              onPress={() => setBreakdownOpen(!breakdownOpen)}
              style={({ pressed }) => [
                hishobStyles.breakdownToggle,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={hishobStyles.linkText}>{t('Cash breakdown')}</Text>
              <Ionicons
                name={breakdownOpen ? 'chevron-up' : 'chevron-down'}
                size={17}
                color={colors.green}
              />
            </Pressable>
          </View>
          {breakdownOpen && <Breakdown day={day} />}
          <View style={{ gap: 8 }}>
            <View style={styles.row}>
              <Text style={styles.heading}>{t('Recent entries')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('View transactions ({0})', [entries.length])}
                onPress={() => navigation.navigate('HishobTransactions', { dayId: day.id })}
                style={({ pressed }) => [hishobStyles.textAction, { opacity: pressed ? 0.65 : 1 }]}
              >
                <Text style={hishobStyles.linkText}>
                  {t('View all (')}
                  {entries.length})
                </Text>
                <Ionicons name="chevron-forward" size={15} color={colors.green} />
              </Pressable>
            </View>
            {entries.length ? (
              <View style={hishobStyles.entries}>
                {entries.slice(0, 3).map((entry, index) => (
                  <View
                    key={entry.id}
                    style={[
                      hishobStyles.entry,
                      index > 0 && { borderTopWidth: 1, borderTopColor: colors.line },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          flex: 1,
                          color: colors.ink,
                          fontSize: 14,
                          lineHeight: 20,
                          fontWeight: '600',
                        }}
                      >
                        {entry.description}
                      </Text>
                      <Text
                        style={{
                          color: colors.ink,
                          fontSize: 15,
                          lineHeight: 20,
                          fontWeight: '600',
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {money(entry.amount)}
                      </Text>
                    </View>
                    <Text style={styles.small}>
                      {transactionTypes.find((type) => type.type === entry.type)?.label}
                      {['EXPENSE', 'SUPPLIER_PAYMENT', 'DUE_COLLECTION'].includes(entry.type)
                        ? ` · ${entry.payment_method === 'DIGITAL' ? t('Digital') : t('Cash')}`
                        : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={hishobStyles.emptyEntries}>
                <Ionicons name="receipt-outline" size={24} color={colors.muted} />
                <Text style={styles.small}>{t('No transactions recorded yet.')}</Text>
              </View>
            )}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.small}>
              {t('Sales method ·')} {modeLabels[day.mode || 'ENTRIES']}
            </Text>
            {day.status === 'OPEN' && (
              <>
                <PlainButton
                  title={t('Day details & audit')}
                  secondary
                  onPress={() => navigation.navigate('HishobDetails', { dayId: day.id })}
                />
                <FinancialHelp topic={t('Add transaction')} />
                {selected!.permissions.close_hishob && <FinancialHelp topic={t('Close day')} />}
              </>
            )}
          </View>
        </>
      )}
    </Page>
  );
}

const hishobStyles = StyleSheet.create({
  startCard: {
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
  },
  startHeader: {
    backgroundColor: colors.green,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  startIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#2A7158',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTitle: { color: colors.white, fontSize: 22, fontWeight: '700' },
  startForm: { padding: 18, gap: 14 },
  carryNote: {
    backgroundColor: colors.mint,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: '#F5F7F2',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkText: { color: colors.green, fontSize: 13, fontWeight: '600' },
  balanceCard: { backgroundColor: colors.green, borderRadius: 22, padding: 20, gap: 12 },
  balanceLabel: { color: '#D5E5D9', fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  balanceAmount: { color: colors.white, fontWeight: '700', fontVariant: ['tabular-nums'] },
  balanceNote: { color: '#EDF5EE', fontSize: 13, lineHeight: 20 },
  dayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#2A7158',
  },
  closedCheck: { borderTopWidth: 1, borderTopColor: '#3E7963', paddingTop: 12, gap: 6 },
  tools: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  tool: {
    flex: 1,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  toolLabel: { color: colors.green, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  summary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  metric: { flex: 1, minWidth: 0, gap: 5 },
  metricValue: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricNote: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  breakdownToggle: {
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  entries: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  entry: { paddingVertical: 14, gap: 5 },
  emptyEntries: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
