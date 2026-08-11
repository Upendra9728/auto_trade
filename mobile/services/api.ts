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
  Dashboard,
  Paginated,
  DateRangeFilter,
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
      msg = err.detail ?? msg;
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

  let file: File;
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
  adminBootstrap: (data: { admin_secret: string; email: string }) =>
    post<{ status: string; role: string }>('/api/auth/admin-bootstrap', data),
};

// ── User ─────────────────────────────────────────────────────────────────────

export const userApi = {
  getProfile: () => get<User>('/api/users/me'),
  updateProfile: (data: { name?: string; phone_number?: string }) =>
    put<User>('/api/users/me', data),
  updateFcmToken: (fcm_token: string) =>
    put<{ status: string }>('/api/users/me/fcm-token', { fcm_token }),
  clearFcmToken: () =>
    del<{ status: string }>('/api/users/me/fcm-token'),
  testPush: () =>
    post<{ status: string; token_suffix: string }>('/api/users/me/test-push'),
  getDhanCredential: () => get<DhanCredential | null>('/api/users/me/dhan'),
  saveDhanCredential: (data: { dhan_client_id: string; access_token: string }) =>
    post<DhanCredential>('/api/users/me/dhan', data),
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
  testIp: () => get<{ bound_ipv6: string | null; status: string }>('/api/users/test-ip'),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

// ── System ───────────────────────────────────────────────────────────────────

export const systemApi = {
  getAppVersion: () =>
    request<{ latest_version: string; apk_url: string; force_update: boolean }>(
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
  getSignals: (params: { page?: number; pageSize?: number } & DateRangeFilter = {}) =>
    get<Paginated<Signal>>(`/api/admin/signals${buildQuery({
      page: params.page,
      page_size: params.pageSize,
      date_from: params.date_from,
      date_to: params.date_to,
    })}`),
  getSignal: (id: number) => get<AdminSignalDetail>(`/api/admin/signals/${id}`),
  createSignal: (data: SignalCreatePayload) => post<Signal>('/api/admin/signals', data),
  cancelSignal: (id: number) => put<{ status: string }>(`/api/admin/signals/${id}/cancel`),
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
};
