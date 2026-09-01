// ── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  role: 'user' | 'admin';
  assigned_ipv6: string | null;
  is_active: boolean;
  email_verified: boolean;
  terms_accepted: boolean;
  terms_accepted_at?: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

// ── Dhan ─────────────────────────────────────────────────────────────────────

export interface DhanCredential {
  dhan_client_id: string;
  is_active: boolean;
  updated_at: string;
  token_expires_at?: string | null;
  totp_configured: boolean;
}

// ── Signals ──────────────────────────────────────────────────────────────────

export interface Signal {
  id: number;
  title: string;
  exchange_segment: string;
  security_id: string;
  transaction_type: 'BUY' | 'SELL';
  product_type: string;
  order_type: string;
  quantity: number;
  lot_size: number | null;
  price: number;
  target_price: number;
  stop_loss_price: number;
  trailing_jump: number;
  status: 'active' | 'cancelled';
  created_by_id: number;
  created_at: string;
  expires_at: string | null;
  // Summary counts (admin list view)
  total_notified?: number;
  confirmed?: number;
  placed?: number;
  rejected?: number;
  failed?: number;
  // Of the 'placed' ones, how many are really confirmed at the exchange
  exchange_confirmed?: number;
  exchange_rejected?: number;
  awaiting_confirmation?: number;
  // How many 'placed' notifications are still actually cancellable/modifiable at the exchange
  cancellable_count?: number;
  // Group IDs this signal was targeted to (undefined/null = all eligible users)
  target_group_ids?: number[] | null;
}

export interface SignalNotification {
  id: number;
  signal_id: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'placed' | 'failed';
  signal: Signal;
  error_message: string | null;
  dhan_order_id: string | null;
  confirmed_at: string | null;
  placed_at: string | null;
  created_at: string;
  // Real-time exchange status from Dhan's Live Order Update feed.
  // null = no live update received yet.
  live_status: LiveOrderStatus | null;
  exchange_order_no: string | null;
  traded_qty: number | null;
  traded_price: number | null;
  reason_description: string | null;
  live_updated_at: string | null;
  ordered_quantity?: number | null;
  exit_leg?: string | null;
  exit_price?: number | null;
  exit_time?: string | null;
  realized_pnl?: number | null;
}

export interface OrderEvent {
  id: number;
  notification_id: number;
  source: string;
  event_type: string;
  leg: string | null;
  status: string;
  price: number | null;
  quantity: number | null;
  reason_description: string | null;
  exchange_order_no: string | null;
  created_at: string;
}

export type LiveOrderStatus = 'TRANSIT' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'TRADED' | 'EXPIRED';

export interface SignalCreatePayload {
  title: string;
  exchange_segment: string;
  security_id: string;
  transaction_type: 'BUY' | 'SELL';
  product_type: string;
  order_type: string;
  quantity: number;
  lot_size?: number | null;
  price: number;
  target_price: number;
  stop_loss_price: number;
  trailing_jump: number;
  group_ids?: number[];
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  role: 'user' | 'admin';
  assigned_ipv6: string | null;
  is_active: boolean;
  has_dhan_credential: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSignalNotificationRow {
  notification_id: number;
  user_id: number;
  user_email: string;
  user_name: string;
  assigned_ipv6: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'placed' | 'failed' | 'cancelled';
  dhan_order_id: string | null;
  error_message: string | null;
  confirmed_at: string | null;
  placed_at: string | null;
  created_at: string;
  ordered_quantity: number | null;
  live_status: LiveOrderStatus | null;
  exchange_order_no: string | null;
  traded_qty: number | null;
  traded_price: number | null;
  reason_description: string | null;
  live_updated_at: string | null;
  exit_leg: 'TARGET_LEG' | 'STOP_LOSS_LEG' | null;
  exit_price: number | null;
  exit_time: string | null;
  realized_pnl?: number | null;
}

export interface UserPosition {
  id: number;
  user_id: number;
  user_name?: string | null;
  user_email?: string | null;
  trading_symbol: string;
  security_id: string;
  position_type: string;
  exchange_segment: string;
  product_type: string;
  buy_avg: number;
  buy_qty: number;
  cost_price: number;
  sell_avg: number;
  sell_qty: number;
  net_qty: number;
  realized_profit: number;
  unrealized_profit: number;
  updated_at: string;
}

export interface AdminUserPnlRow {
  user_id: number;
  user_name: string;
  user_email: string;
  assigned_ipv6: string | null;
  total_orders: number;
  closed_orders: number;
  win_count: number;
  loss_count: number;
  total_realized_pnl: number;
  dhan_realized_profit: number;
  dhan_unrealized_profit: number;
}

export interface AdminSignalDetail {
  signal: Signal;
  notifications: AdminSignalNotificationRow[];
}

export interface AdminSignalNotificationsResponse extends Paginated<AdminSignalNotificationRow> {}

export interface SignalOrderModifyPayload {
  price?: number | null;
  target_price?: number | null;
  stop_loss_price?: number | null;
  trailing_jump?: number | null;
}

export interface OrderActionResult {
  notification_id: number;
  user_id: number;
  user_email: string;
  dhan_order_id: string | null;
  success: boolean;
  reason: string | null;
}

export interface Dashboard {
  users: {
    total: number;
    active: number;
    with_ipv6_assigned: number;
    with_dhan_credential: number;
  };
  signals: {
    total: number;
    active: number;
  };
  orders: {
    // Really confirmed at the exchange (TRANSIT/PENDING/TRADED) — trust this
    // number, not just "API accepted", as the count of orders really placed in Dhan.
    placed: number;
    awaiting_confirmation: number;
    exchange_rejected: number;
    failed: number;
    pending: number;
    total_realized_pnl?: number;
    total_unrealized_pnl?: number;
  };
  pending_approvals: number;
  recent_signals: {
    id: number;
    title: string;
    status: 'active' | 'cancelled';
    created_at: string;
    total_notified: number;
    placed: number;
  }[];
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface DateRangeFilter {
  // YYYY-MM-DD, IST calendar date, inclusive on both ends
  date_from?: string | null;
  date_to?: string | null;
}

// ── User Groups ───────────────────────────────────────────────────────────────

export interface UserGroup {
  id: number;
  name: string;
  description?: string | null;
  member_count: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
}

export interface UserGroupDetail {
  id: number;
  name: string;
  description?: string | null;
  members: AdminUser[];
  created_by_id: number;
  created_at: string;
  updated_at: string;
}
}
