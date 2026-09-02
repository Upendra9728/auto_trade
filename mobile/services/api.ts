import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getToken } from './auth';
import type {
  AuthResponse,
  User,
  DhanCredential,
  Signal,
  SignalNotification,
  SignalCreatePayload,
  AdminUser,
  AdminSignalDetail,
  AdminSignalNotificationsResponse,
  SignalOrderModifyPayload,
  OrderActionResult,
  Dashboard,
  Paginated,
  DateRangeFilter,
  AdminUserPnlRow,
  OrderEvent,
  UserPosition,
  UserGroup,
  UserGroupDetail,
} from '../types';

const BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ??
  'http://localhost:8000';

// Exposed so screens can display the resolved backend URL for on-device diagnostics.
export const API_BASE_URL = BASE_URL;

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (networkErr: any) {
    // Include the target URL so failures are diagnosable from the on-device alert alone.
    throw new Error(
      `Network error calling ${BASE_URL}${path}: ${networkErr?.message ?? String(networkErr)}`,
    );
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (Array.isArray(err.detail)){
        msg=err.detail.map((e: any) => e.msg ?? JSON.stringify(e)).join('; ');
      }
      else{
        msg = err.detail ?? msg;
      }
      
    } catch {}
    throw new Error(msg);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path, { method: 'GET' });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

/** Builds a query string, skipping null/undefined/empty values. */
function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') q.append(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Downloads a file from an authenticated backend endpoint and opens the native share sheet for it. */
async function downloadAndShareFile(path: string, filename: string): Promise<void> {
  const token = await getToken();
  const destination = new File(Paths.cache, filename);
  if (destination.exists) destination.delete();

  let file: any;
  try {
    file = await File.downloadFileAsync(`${BASE_URL}${path}`, destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (err: any) {
    throw new Error(`Download failed: ${err?.message ?? String(err)}`);
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME_TYPE, dialogTitle: filename });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (data: { name: string; email: string; phone_number: string; password: string }) =>
    post<User>('/api/auth/register', data),
  login: (data: { email: string; password: string }) =>
    post<AuthResponse>('/api/auth/login', data),
  logout: () => post<{ status: string }>('/api/auth/logout'),
  me: () => get<User>('/api/auth/me'),
  sendVerificationOtp: (data: { email: string }) =>
    post<{ status: string }>('/api/auth/send-verification-otp', data),
  verifyEmail: (data: { email: string; otp: string }) =>
    post<{ status: string }>('/api/auth/verify-email', data),
  requestPasswordReset: (data: { email: string }) =>
    post<{ status: string }>('/api/auth/request-password-reset', data),
  resetPassword: (data: { email: string; otp: string; new_password: string }) =>
    post<{ status: string }>('/api/auth/reset-password', data),
  adminBootstrap: (data: { admin_secret: string; email: string }) =>
    post<{ status: string; role: string }>('/api/auth/admin-bootstrap', data),
};

// ── User ─────────────────────────────────────────────────────────────────────

export const userApi = {
  getProfile: () => get<User>('/api/users/me'),
  acceptTerms: () => post<User>('/api/users/accept-terms'),
  updateProfile: (data: { name?: string; phone_number?: string }) =>
    put<User>('/api/users/me', data),
  updateFcmToken: (fcm_token: string) =>
    put<{ status: string }>('/api/users/me/fcm-token', { fcm_token }),
  updateAutoTrade: (data: { auto_trade_enabled: boolean; auto_trade_quantity: number | null }) =>
    put<User>('/api/users/me/auto-trade', data),
  clearFcmToken: () =>
    del<{ status: string }>('/api/users/me/fcm-token'),
  testPush: () =>
    post<{ status: string; token_suffix: string }>('/api/users/me/test-push'),
  getDhanCredential: () => get<DhanCredential | null>('/api/users/me/dhan'),
  saveDhanCredential: (data: { dhan_client_id: string; pin: string; totp_secret: string }) =>
    post<DhanCredential>('/api/users/me/dhan', data),
  refreshDhanToken: () =>
    post<{
      dhan_client_id: string;
      refreshed: 'success' | 'failure';
      reason?: string | null;
      refreshed_at?: string | null;
      ipv6?: string | null;
    }>('/api/users/me/dhan/refresh'),
  getNotifications: (params: { status?: string; page?: number; pageSize?: number } & DateRangeFilter = {}) =>
    get<Paginated<SignalNotification>>(`/api/users/me/notifications${buildQuery({
      status: params.status,
      page: params.page,
      page_size: params.pageSize,
      date_from: params.date_from,
      date_to: params.date_to,
    })}`),
  confirmNotification: (id: number, quantity?: number) =>
    post<SignalNotification>(`/api/users/me/notifications/${id}/confirm`, quantity != null ? { quantity } : undefined),
  rejectNotification: (id: number) =>
    post<SignalNotification>(`/api/users/me/notifications/${id}/reject`),
  getOrders: (params: { page?: number; pageSize?: number } & DateRangeFilter = {}) =>
    get<Paginated<SignalNotification>>(`/api/users/me/orders${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      date_from: params.date_from,
      date_to: params.date_to,
    })}`),
  getNotificationEvents: (notifId: number) =>
    get<OrderEvent[]>(`/api/users/me/notifications/${notifId}/events`),
  testIp: () => get<{ bound_ipv6: string | null; status: string }>('/api/users/test-ip'),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

// ── System ───────────────────────────────────────────────────────────────────

export const systemApi = {
  getAppVersion: () =>
    request<{ latest_version: string; apk_url: string; force_update: boolean; release_notes: string }>(
      '/api/app-version',
      { method: 'GET' },
    ),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminApi = {
  getDashboard: () => get<Dashboard>('/api/admin/dashboard'),
  getUsers: (params: { page?: number; pageSize?: number; search?: string; isActive?: boolean } & DateRangeFilter = {}) =>
    get<Paginated<AdminUser>>(`/api/admin/users${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      search: params.search,
      date_from: params.date_from,
      date_to: params.date_to,
      is_active: params.isActive,
    })}`),
  getUser: (id: number) => get<AdminUser>(`/api/admin/users/${id}`),
  updateUser: (id: number, data: { assigned_ipv6?: string | null; role?: string; is_active?: boolean }) =>
    put<AdminUser>(`/api/admin/users/${id}`, data),
  approveUser: (id: number) => post<AdminUser>(`/api/admin/users/${id}/approve`),
  deleteUser: (id: number) => del<{ status: string }>(`/api/admin/users/${id}`),
  addUserCredits: (id: number, amount: number) =>
    post<AdminUser>(`/api/admin/users/${id}/credits`, { amount }),
  addCreditsToAllUsers: (amount: number) =>
    post<{ updated: number }>(`/api/admin/users/credits/add-all`, { amount }),
  getUserDhanIp: (id: number) =>
    get<{
      assigned_ipv6: string | null;
      dhan_primary_ip: string | null;
      dhan_secondary_ip: string | null;
      dhan_modify_date_primary: string | null;
      dhan_modify_date_secondary: string | null;
      matches: boolean;
    }>(`/api/admin/users/${id}/dhan-ip`),
  registerUserDhanIp: (id: number) =>
    post<{
      action: 'already_correct' | 'set' | 'modified' | 'cooldown_blocked';
      assigned_ipv6: string;
      dhan_primary_ip?: string | null;
      dhan_primary_ip_before?: string | null;
      dhan_primary_ip_after?: string | null;
      modify_allowed_from?: string;
      detail?: string;
    }>(`/api/admin/users/${id}/dhan-ip/register`),
  getSignals: (params: { page?: number; pageSize?: number } & DateRangeFilter = {}) =>
    get<Paginated<Signal>>(`/api/admin/signals${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      date_from: params.date_from,
      date_to: params.date_to,
    })}`),
  getSignal: (id: number) => get<AdminSignalDetail>(`/api/admin/signals/${id}`),
  getSignalNotifications: (id: number, params: { page?: number; pageSize?: number; status?: string } & DateRangeFilter = {}) =>
    get<AdminSignalNotificationsResponse>(`/api/admin/signals/${id}/notifications${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      status: params.status,
      date_from: params.date_from,
      date_to: params.date_to,
    })}`),
  cancelSignalOrders: (id: number) =>
    post<OrderActionResult[]>(`/api/admin/signals/${id}/cancel-orders`),
  modifySignalOrders: (id: number, data: SignalOrderModifyPayload) =>
    post<OrderActionResult[]>(`/api/admin/signals/${id}/modify-orders`, data),
  cancelNotificationOrder: (notifId: number) =>
    post<OrderActionResult>(`/api/admin/notifications/${notifId}/cancel-order`),
  modifyNotificationOrder: (notifId: number, data: SignalOrderModifyPayload) =>
    post<OrderActionResult>(`/api/admin/notifications/${notifId}/modify-order`, data),
  createSignal: (data: SignalCreatePayload) => post<Signal>('/api/admin/signals', data),
  cancelSignal: (id: number) => put<{ status: string }>(`/api/admin/signals/${id}/cancel`),
  getNotificationEvents: (notifId: number, limit = 100) =>
    get<OrderEvent[]>(`/api/admin/notifications/${notifId}/events${buildQuery({ limit })}`),
  getUsersPnl: (params: { search?: string } = {}) =>
    get<AdminUserPnlRow[]>(`/api/admin/users/pnl${buildQuery({ search: params.search })}`),
  getPositions: (params: { userId?: number } = {}) =>
    get<UserPosition[]>(`/api/admin/positions${buildQuery({ user_id: params.userId })}`),
  exportUsers: (params: { search?: string } & DateRangeFilter = {}) =>
    downloadAndShareFile(
      `/api/admin/users/export${buildQuery({
        search: params.search,
        date_from: params.date_from,
        date_to: params.date_to,
      })}`,
      `users_${Date.now()}.xlsx`,
    ),
  exportOrders: (params: DateRangeFilter = {}) =>
    downloadAndShareFile(
      `/api/admin/orders/export${buildQuery({ date_from: params.date_from, date_to: params.date_to })}`,
      `orders_${Date.now()}.xlsx`,
    ),
  scripSearch: (params: { symbol: string; strike: number; option_type: string; expiry?: string; exchange?: string }) => {
    const q = new URLSearchParams({
      symbol: params.symbol,
      strike: String(params.strike),
      option_type: params.option_type,
      ...(params.expiry ? { expiry: params.expiry } : {}),
      ...(params.exchange ? { exchange: params.exchange } : {}),
    });
    return get<Array<{
      security_id: string;
      trading_symbol: string;
      exchange: string;
      exchange_segment: string;
      expiry_date: string;
      lot_size: number;
      strike_price: number;
      option_type: string;
    }>>(`/api/admin/scrip-search?${q.toString()}`);
  },
  scripSymbols: () => get<string[]>('/api/admin/scrip-symbols'),
  scripExpiries: (symbol: string) =>
    get<string[]>(`/api/admin/scrip-expiries${buildQuery({ symbol })}`),
  scripStrikes: (symbol: string, expiry: string) =>
    get<Array<{ strike: number; option_types: string[] }>>(
      `/api/admin/scrip-strikes${buildQuery({ symbol, expiry })}`,
    ),
  scripContracts: (query: string, limit = 30) =>
    get<Array<{ symbol: string; expiry_date: string; option_type: string }>>(
      `/api/admin/scrip-contracts${buildQuery({ query, limit })}`,
    ),

  // ── Groups ───────────────────────────────────────────────────────────────────────
  getGroups: () => get<UserGroup[]>('/api/admin/groups'),
  getGroup: (id: number) => get<UserGroupDetail>(`/api/admin/groups/${id}`),
  createGroup: (data: { name: string; description?: string | null }) =>
    post<UserGroup>('/api/admin/groups', data),
  updateGroup: (id: number, data: { name?: string; description?: string | null }) =>
    put<UserGroup>(`/api/admin/groups/${id}`, data),
  deleteGroup: (id: number) => del<{ status: string }>(`/api/admin/groups/${id}`),
  addGroupMembers: (groupId: number, userIds: number[]) =>
    post<UserGroup>(`/api/admin/groups/${groupId}/members`, { user_ids: userIds }),
  removeGroupMember: (groupId: number, userId: number) =>
    del<{ status: string }>(`/api/admin/groups/${groupId}/members/${userId}`),
};
