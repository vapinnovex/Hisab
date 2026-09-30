import { t, useLocale, localized, original } from './../i18n';
import React from 'react';
import { View } from 'react-native';
import { Button } from '../components/ui';
import { InfoHelp } from '../components/InfoHelp';
import { TransactionType } from './types';

export const transactionHelp: Record<TransactionType, string> = localized(() => ({
  DUE_COLLECTION: t(
    'A payment against an unpaid sale, recorded through Customer dues. Cash enters the galla; UPI/card does not. Older dues never increase today’s sales. Receipts are preserved and cannot be edited or deleted.',
  ),
  CASH_SALE: t(
    'Use when a customer pays cash for today’s sale. Example: a ₹500 cash bill adds ₹500 to sales and to the galla. Enter individual bills OR one daily total, never both. In billing mode, enter sales at closing instead.',
  ),
  DIGITAL_SALE: t(
    'Use for today’s sales paid by UPI or card. Example: a ₹500 UPI bill adds ₹500 to sales but no cash to the galla. Do not enter the machine’s grand total here. Exclude old dues, owner transfers and bank settlements.',
  ),
  CREDIT_SALE: t(
    'Use for a sale made today that the customer has not paid for yet. Example: ₹500 sold on credit adds to sales, but not to cash or UPI. Record collections in Customer dues, by cash or UPI/card. Partial payments are allowed; the entry closes when fully paid.',
  ),
  OTHER_CASH_IN: t(
    'Cash received that is not today’s sales: owner top-ups, loans or old customer dues. Example: the owner adds ₹1,000 change; the galla increases by ₹1,000, but sales do not. For a sale already in Customer dues, record its payment there instead so the balance is cleared. Do not enter UPI receipts here.',
  ),
  EXPENSE: t(
    'Use for running costs such as tea, transport, rent or supplies. Example: ₹100 for tea paid from the drawer reduces cash by ₹100. Select the correct Paid from option. Use Supplier payment for money paid to a stock supplier. Record each payment once.',
  ),
  SUPPLIER_PAYMENT: t(
    'Use when paying a supplier for goods or an old supplier bill. Example: ₹2,000 paid from the drawer reduces cash by ₹2,000. Choose UPI / bank / card for a digital payment. Do not also enter the same payment as an expense.',
  ),
  BANK_DEPOSIT: t(
    'Use when cash is actually removed from the galla for the bank during the day. Example: taking ₹3,000 out reduces drawer cash, not sales. Do not record UPI settlements here. Do not repeat this amount in the closing bank field.',
  ),
  WITHDRAWAL: t(
    'Use when the owner actually takes cash home or removes it for personal use during the day. This reduces drawer cash, not sales. Do not also record it as an expense or repeat it in the closing take-home field.',
  ),
}));
export const financialHelp: Record<string, string> = localized(() => ({
  'Opening cash': t(
    'Count the cash already in the drawer before today’s sales. Normally this is the cash kept after the previous closing. Example: yesterday you kept ₹1,500, so today opens with ₹1,500. A past shortage is not deducted a second time. Give a reason only if you change the carried amount.',
  ),
  'Updated opening cash': t(
    'Correct the cash that was in the drawer at the start of this day, with a reason. This is not a way to add money received later; use Other cash in for that. Later days’ opening amounts are not changed automatically.',
  ),
  'Amount (₹)': t(
    'Enter the amount for this one transaction. Choose its type and payment method first. For a bill paid partly in cash and partly digitally, record each part separately so the drawer balance stays correct.',
  ),
  'Category (optional)': t(
    'An optional label to help you find similar entries later, such as Tea, Transport, Rent or Stock. The transaction type and Paid from selection control the calculation; this label does not. Use consistent names for easier searches.',
  ),
  'Paid from': t(
    'Choose Cash from galla only if physical money left the drawer. Choose UPI / bank / card if you paid digitally; it is recorded but does not reduce drawer cash.',
  ),
  'Billing report': t(
    'Enter the billing grand total. If the machine gives separate amounts, add them together first. Example: total ₹10,000 minus UPI/card ₹4,000 and unpaid credit ₹0 gives cash sales ₹6,000.',
  ),
  'Non-cash sales': t(
    'Choose I know the totals when you can confirm UPI/card receipts for today’s sales, including zero. Unpaid sales are calculated from transactions. The app can then calculate cash sales and check the drawer. Choose Not known to save total sales without claiming a cash shortage or surplus.',
  ),
  'Total sales from billing': t(
    'Copy the billing machine’s total sales for this day, after returns and including tax charged. This total includes cash, UPI/card and unpaid sales already recorded as credit transactions. Do not enter it again as a transaction. Example: enter ₹10,000 for a ₹10,000 grand total.',
  ),
  'Cash sales from billing': t(
    'Enter only today’s sales paid in cash, from the billing report. Exclude opening cash, owner top-ups and old dues. If you only know the grand total, enter it as Total sales from billing.',
  ),
  'UPI / card sales': t(
    'Add UPI and card payments for today’s sales. Example: PhonePe ₹4,000 plus card ₹1,000 means ₹5,000 here. Exclude old dues and owner transfers. Use customer payment totals, not bank settlements after fees.',
  ),
  'Credit sales still unpaid': t(
    'Today’s sales for which no payment has been received yet. Enter 0 if all customers paid. Do not include older unpaid bills or count the same sale as cash/UPI too.',
  ),
  'Actual cash in galla': t(
    'Physically count all notes and coins in the drawer, including opening cash. Count BEFORE taking the bank/home amounts entered below. Do not subtract opening cash yourself; the app handles it.',
  ),
  'Cash removed for bank at closing': t(
    'Enter only cash you are taking out for the bank now, after counting. Leave 0 if you will take it later. Do not repeat bank removals already recorded as transactions.',
  ),
  'Cash taken home at closing': t(
    'Enter only cash you are taking home now, after counting. Leave 0 if none. Do not repeat earlier withdrawals. Cash counted minus these closing removals is kept for the next day.',
  ),
  Difference: t(
    'Difference = cash counted minus expected cash. A negative amount is a shortage; a positive amount is extra cash. Check missing expenses, receipts and wrong payment types first. If unresolved, add an honest note; do not invent a sale or expense to make it zero.',
  ),
  'Choose Hishob method': t(
    'Use billing totals: sales come from a billing machine at closing. Count cash: estimate cash sales from counted cash and expenses, without an independent shortage check. Enter sales: record cash, digital and credit sales as transactions. The setting applies to new days; existing days keep their method.',
  ),
  'Start today’s Hishob': t(
    'Start once at the beginning of the day, after checking opening cash. Record expenses and cash movements as they happen. Finish with Close day after counting the drawer.',
  ),
  'Add transaction': t(
    'Record an expense, supplier payment, other cash received or cash removed. In Enter sales mode you also record sales here. In billing mode, enter the machine’s sales at closing instead.',
  ),
  'Close day': t(
    'At the end of the day, review entries, enter sales if needed, count cash, check any difference, then enter cash taken to the bank or home. Closing saves a snapshot and locks the day.',
  ),
  'Close today’s Hishob': t(
    'Save the closing totals and cash kept for tomorrow. Review differences and cash removals before confirming. Only the owner can reopen a closed day, with a reason.',
  ),
  'Change opening cash': t(
    'Use only to correct the starting cash for this day. Give a reason so the correction can be traced. For money added during the day, use Other cash in instead.',
  ),
  'Reopen day': t(
    'Owner only: reopen to correct a closed day, with a reason. The previous closing stays in history. Close the day again after correcting it. Later days’ opening balances do not change automatically.',
  ),
  'View audit trail': t(
    'See who created, changed, deleted or closed entries, with reasons and timestamps. Use this to understand a correction; it does not change any amounts.',
  ),
  'Review recorded totals': t(
    'Check recorded expenses, sales and cash movements before closing. If something is wrong, return to the day and correct the relevant transaction first.',
  ),
}));
export function FinancialHelp({ topic }: { topic: string }) {
  useLocale();
  const help = financialHelp[original(topic)];
  return help ? <InfoHelp title={topic}>{help}</InfoHelp> : null;
}
export function HelpButton(props: React.ComponentProps<typeof Button>) {
  useLocale();
  return (
    <View>
      <Button {...props} />
      <FinancialHelp topic={props.title} />
    </View>
  );
}
