import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface UserProfile {
  name: string;
  email: string;
  phone_number: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: UserProfile;
}

const AUTH_TOKEN_KEY = 'automateTrading.authToken';
const AUTH_USER_KEY = 'automateTrading.authUser';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSubject = new BehaviorSubject<UserProfile | null>(this.loadUserFromStorage());
  readonly user$ = this.userSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  register(req: {
    name: string;
    email: string;
    phone_number: string;
    password: string;
  }): Observable<UserProfile> {
    return this.http.post<UserProfile>('/api/auth/register', req);
  }

  login(req: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>('/api/auth/login', req).pipe(
      tap((res) => {
        this.setToken(res.access_token);
        this.setUser(res.user);
      })
    );
  }

  requestPasswordReset(email: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>('/api/auth/request-password-reset', { email });
  }

  verifyPasswordReset(req: { email: string; otp: string; new_password: string }): Observable<{ status: string }> {
    return this.http.post<{ status: string }>('/api/auth/verify-password-reset', req);
  }

  me(): Observable<UserProfile> {
    return this.http.get<UserProfile>('/api/auth/me').pipe(
      tap((user) => this.setUser(user))
    );
  }

  logout(): Observable<{ status: string }> {
    return this.http.post<{ status: string }>('/api/auth/logout', {}).pipe(
      tap(() => this.clearAuth())
    );
  }

  forceLogout(): void {
    this.clearAuth();
  }

  getToken(): string | null {
    if (!this.isBrowser()) return null;
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  getCurrentUser(): UserProfile | null {
    return this.userSubject.value;
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  private setToken(token: string): void {
    if (!this.isBrowser()) return;
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  private setUser(user: UserProfile): void {
    if (this.isBrowser()) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }
    this.userSubject.next(user);
  }

  private clearAuth(): void {
    if (this.isBrowser()) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
    }
    this.userSubject.next(null);
  }

  private loadUserFromStorage(): UserProfile | null {
    if (!this.isBrowser()) return null;
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      return null;
    }
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }
}
