import Constants from 'expo-constants';
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
} from '../types';

const BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ??
  'http://localhost:8000';

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

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
  getDhanCredential: () => get<DhanCredential | null>('/api/users/me/dhan'),
  saveDhanCredential: (data: { dhan_client_id: string; access_token: string }) =>
    post<DhanCredential>('/api/users/me/dhan', data),
  getNotifications: (status?: string) =>
    get<SignalNotification[]>(`/api/users/me/notifications${status ? `?status=${status}` : ''}`),
  confirmNotification: (id: number) =>
    post<SignalNotification>(`/api/users/me/notifications/${id}/confirm`),
  rejectNotification: (id: number) =>
    post<SignalNotification>(`/api/users/me/notifications/${id}/reject`),
  getOrders: (limit = 50) =>
    get<SignalNotification[]>(`/api/users/me/orders?limit=${limit}`),
  testIp: () => get<{ ip: string }>('/api/users/test-ip'),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminApi = {
  getDashboard: () => get<Dashboard>('/api/admin/dashboard'),
  getUsers: () => get<AdminUser[]>('/api/admin/users'),
  getUser: (id: number) => get<AdminUser>(`/api/admin/users/${id}`),
  updateUser: (id: number, data: { assigned_ipv6?: string | null; role?: string; is_active?: boolean }) =>
    put<AdminUser>(`/api/admin/users/${id}`, data),
  deleteUser: (id: number) => del<{ status: string }>(`/api/admin/users/${id}`),
  getSignals: (limit = 50) => get<Signal[]>(`/api/admin/signals?limit=${limit}`),
  getSignal: (id: number) => get<AdminSignalDetail>(`/api/admin/signals/${id}`),
  createSignal: (data: SignalCreatePayload) => post<Signal>('/api/admin/signals', data),
  cancelSignal: (id: number) => put<{ status: string }>(`/api/admin/signals/${id}/cancel`),
};
