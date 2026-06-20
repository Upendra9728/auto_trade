import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface BrokerTokenSummary {
  broker: string;
  client_id: string;
  consent: boolean;
  updated_at: string;
}

export interface TokenUpsertRequest {
  client_id: string;
  access_token: string;
  consent: boolean;
}

export interface TokenResponse {
  client_id: string;
  broker: string;
  consent: boolean;
  updated_at: string;
}

export interface TokenAdminUpdateRequest {
  access_token?: string;
  consent?: boolean;
}

export interface AdminUserResponse {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  primary_broker: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  broker_tokens: BrokerTokenSummary[];
}

export interface AdminDashboardResponse {
  total_users: number;
  active_users: number;
  tokens_by_broker: Record<string, number>;
  consented_by_broker: Record<string, number>;
  recent_batches: number;
}

export interface UserTokenStatusResponse {
  has_token: boolean;
  token: TokenResponse | null;
}

export interface AllBrokerTokensResponse {
  tokens: BrokerTokenSummary[];
}

export interface UserUpstoxAppStatusResponse {
  has_app: boolean;
  client_id: string | null;
  updated_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class TokenService {
  constructor(private readonly http: HttpClient) {}

  // ── Admin ──────────────────────────────────────────────────────────────────

  getDashboard(adminSecret: string): Observable<AdminDashboardResponse> {
    return this.http.get<AdminDashboardResponse>('/api/admin/dashboard', {
      headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }),
    });
  }

  listTokensAdmin(adminSecret: string): Observable<TokenResponse[]> {
    return this.http.get<TokenResponse[]>('/api/tokens', {
      headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }),
    });
  }

  listUsersAdmin(adminSecret: string): Observable<AdminUserResponse[]> {
    return this.http.get<AdminUserResponse[]>('/api/users', {
      headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }),
    });
  }

  updateTokenAdmin(
    adminSecret: string,
    clientId: string,
    req: TokenAdminUpdateRequest
  ): Observable<TokenResponse> {
    return this.http.patch<TokenResponse>(`/api/tokens/${encodeURIComponent(clientId)}`, req, {
      headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }),
    });
  }

  deleteTokenAdmin(adminSecret: string, clientId: string): Observable<{ status: string; client_id: string }> {
    return this.http.delete<{ status: string; client_id: string }>(
      `/api/tokens/${encodeURIComponent(clientId)}`,
      { headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }) }
    );
  }

  deleteUserAdmin(adminSecret: string, userEmail: string): Observable<{ status: string; user_email: string }> {
    return this.http.delete<{ status: string; user_email: string }>(
      `/api/users/${encodeURIComponent(userEmail)}`,
      { headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }) }
    );
  }

  toggleUserActive(adminSecret: string, userEmail: string): Observable<{ status: string }> {
    return this.http.patch<{ status: string }>(
      `/api/users/${encodeURIComponent(userEmail)}/toggle-active`,
      {},
      { headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }) }
    );
  }

  upsertTokenAdmin(adminSecret: string, req: TokenUpsertRequest): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/api/tokens', req, {
      headers: new HttpHeaders({ 'X-Admin-Secret': adminSecret }),
    });
  }

  // ── User broker tokens ─────────────────────────────────────────────────────

  getAllBrokerTokens(): Observable<AllBrokerTokensResponse> {
    return this.http.get<AllBrokerTokensResponse>('/api/user/broker-tokens');
  }

  upsertBrokerToken(broker: string, req: TokenUpsertRequest): Observable<TokenResponse> {
    return this.http.put<TokenResponse>(`/api/user/broker-token/${broker}`, req);
  }

  // ── Upstox-specific ────────────────────────────────────────────────────────

  getUserTokenStatus(): Observable<UserTokenStatusResponse> {
    return this.http.get<UserTokenStatusResponse>('/api/user/token');
  }

  getUpstoxAuthUrl(): Observable<{ url: string }> {
    return this.http.get<{ url: string }>('/api/upstox/auth-url');
  }

  getUserUpstoxApp(): Observable<UserUpstoxAppStatusResponse> {
    return this.http.get<UserUpstoxAppStatusResponse>('/api/user/upstox-app');
  }

  upsertUserUpstoxApp(req: { client_id: string; client_secret: string }): Observable<UserUpstoxAppStatusResponse> {
    return this.http.put<UserUpstoxAppStatusResponse>('/api/user/upstox-app', req);
  }

  upsertUserToken(req: { client_id: string; access_token: string; consent: boolean }): Observable<TokenResponse> {
    return this.http.put<TokenResponse>('/api/user/token', req);
  }
}


