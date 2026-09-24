export type Role = 'OWNER' | 'MANAGER' | 'WORKER';
export type ShopSettings = {
  attendance_mode: 'CHECK_IN_ONLY' | 'CHECK_IN_OUT';
  manager_can_manage_attendance: boolean;
  manager_can_mark_own_attendance: boolean;
  manager_can_add_workers: boolean;
  manager_can_edit_workers: boolean;
  workers_can_view_attendance: boolean;
  manager_can_access_hishob: boolean;
  manager_can_close_hishob: boolean;
};
export type Permissions = {
  view_hishob: boolean;
  add_hishob_transactions: boolean;
  edit_hishob_transactions: boolean;
  close_hishob: boolean;
  reopen_hishob: boolean;
  manage_attendance: boolean;
  mark_own_attendance: boolean;
  add_workers: boolean;
  edit_workers: boolean;
  manage_managers: boolean;
  manage_settings: boolean;
  view_own_attendance: boolean;
};

export type Status = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'NOT_MARKED';
export type Shop = { id: string; name: string; timezone: string; settings: ShopSettings };
export type Membership = {
  id: string;
  shop_id: string;
  role: Role;
  permissions: Permissions;
  shop: Shop;
  worker_name: string | null;
};
export type Session = {
  user: { id: string; mobile: string; name?: string };
  role: Role;
  memberships: Membership[];
};
export type Worker = {
  id: string;
  role: 'MANAGER' | 'WORKER';
  name: string;
  mobile: string;
  active: boolean;
  created_at: string;
};
export type Attendance = {
  id: string | null;
  worker_id: string;
  date: string;
  status: Status;
  check_in: string | null;
  check_out: string | null;
  source: Role | 'SELF' | null;
  attendance_mode?: 'CHECK_IN_ONLY' | 'CHECK_IN_OUT';
  note: string;
  is_open: boolean;
};
export type Today = {
  date: string;
  timezone: string;
  attendance: Attendance;
  active_shift: Attendance | null;
  settings: ShopSettings;
};
export type OwnerToday = {
  date: string;
  timezone: string;
  rows: {
    worker: Worker;
    attendance: Attendance;
    active_shift: Attendance | null;
    can_mark: boolean;
    can_edit: boolean;
  }[];
  settings: ShopSettings;
  permissions: Permissions;
};
export type History = {
  can_edit?: boolean;
  can_mark?: boolean;
  month: string;
  timezone: string;
  days: Attendance[];
  today: string;
  joined_on: string;
  summary: Record<Status, number>;
};
export type Challenge = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
  dev_otp?: string;
};
export type TabRoutes = {
  Dashboard: undefined;
  TodayAttendance: undefined;
  Workers: undefined;
  MyAttendance: undefined;
  Profile: undefined;
};
export type Routes = {
  MainTabs: undefined;
  HishobToday: undefined;
  HishobHistory: undefined;
  HishobDetails: { dayId: string };
  HishobTransaction: { dayId: string; entryId?: string };
  HishobTransactions: { dayId: string };
  HishobClose: { dayId: string };
  OwnerProfile: undefined;
  ChangeMobile: undefined;
  RoleSelection: undefined;
  MobileLogin: { role: Role };
  OTP: { mobile: string; role: Role; challenge: Challenge };
  ShopSetup: undefined;
  Dashboard: undefined;
  Workers: undefined;
  Managers: undefined;
  ShopSettings: undefined;
  WorkerForm: { worker?: Worker; kind?: 'WORKER' | 'MANAGER' } | undefined;
  TodayAttendance: undefined;
  WorkerHistory: { worker: Worker };
  MyAttendance: undefined;
  Profile: undefined;
};
