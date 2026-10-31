import { Worker } from '../types';
export type ReferenceSalary = { amount: string; basis: 'MONTHLY' | 'DAILY' };
export type StaffProfile = {
  worker: Worker;
  can_view_payments: boolean;
  can_manage_reference: boolean;
  can_record_payment: boolean;
  can_add_note: boolean;
  can_correct: boolean;
  reference: {
    revision: number;
    salary: ReferenceSalary | null;
    history: {
      id: string;
      at: string;
      actor: { name: string };
      payload: { salary: ReferenceSalary | null; reason: string };
    }[];
  } | null;
};
export type PaymentKind = 'SALARY' | 'ADVANCE' | 'OTHER_GIVEN' | 'RECEIVED' | 'PURCHASE';
export type StaffEntry = {
  id: string;
  date: string;
  kind: PaymentKind | 'PURCHASE_PAYMENT' | 'NOTE';
  amount?: string;
  payment_method?: 'CASH' | 'DIGITAL';
  note: string;
  actor_name: string;
  day_id?: string;
  day_revision?: number;
  day_status?: 'OPEN' | 'CLOSED';
  deleted: boolean;
  remaining_amount?: string;
  cancellation?: { reason: string };
};
export type StaffHistory = {
  items: StaffEntry[];
  has_more: boolean;
  legacy: {
    id: string;
    date: string;
    kind: string;
    amount: string;
    note: string;
    void: unknown;
  }[];
};
export type StaffDay = { id: string; revision: number; status: 'OPEN' | 'CLOSED'; date: string };
