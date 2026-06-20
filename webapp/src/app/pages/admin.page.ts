import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { throwError } from 'rxjs';
import { catchError, finalize, timeout } from 'rxjs/operators';

import { formatHttpError } from '../http-error';
import { AlertComponent } from '../shared/alert.component';
import { ModalComponent } from '../shared/modal.component';
import {
  AdminDashboardResponse,
  AdminUserResponse,
  BrokerTokenSummary,
  TokenService,
} from '../token.service';

type AlertType = 'success' | 'danger' | 'info';

const BROKER_COLORS: Record<string, string> = {
  upstox: 'text-bg-primary',
  dhann: 'text-bg-success',
  fyers: 'text-bg-warning',
};

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, AlertComponent],
  templateUrl: './admin.page.html',
})
export class AdminPage {
  adminSecret = '';
  isLoading = false;
  isDeleting = false;
  isAuthed = false;
  showLogoutModal = false;
  showDeleteModal = false;
  pendingDeleteEmail: string | null = null;

  users: AdminUserResponse[] = [];
  dashboard: AdminDashboardResponse | null = null;

  // Filters
  filterBroker = '';
  filterActive = '';
  searchQuery = '';

  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly tokensApi: TokenService,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone
  ) {}

  get filteredUsers(): AdminUserResponse[] {
    return this.users.filter(u => {
      const matchesBroker = !this.filterBroker || u.primary_broker === this.filterBroker || u.broker_tokens.some(t => t.broker === this.filterBroker);
      const matchesActive = this.filterActive === '' || String(u.is_active) === this.filterActive;
      const q = this.searchQuery.toLowerCase();
      const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.phone_number.includes(q);
      return matchesBroker && matchesActive && matchesSearch;
    });
  }

  brokerBadgeClass(broker: string): string {
    return BROKER_COLORS[broker] || 'text-bg-secondary';
  }

  brokerTokensFor(user: AdminUserResponse): BrokerTokenSummary[] {
    return user.broker_tokens || [];
  }

  login(): void {
    this.alert = null;
    const secret = this.adminSecret.trim();
    if (!secret) {
      this.alert = { type: 'danger', message: 'Admin secret is required.' };
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();
    this.tokensApi.listUsersAdmin(secret).pipe(
      timeout(15000),
      catchError(err => {
        if (err?.name === 'TimeoutError') return throwError(() => new Error('Request timed out.'));
        return throwError(() => err);
      }),
      finalize(() => this.runInZone(() => { this.isLoading = false; }))
    ).subscribe({
      next: users => {
        this.runInZone(() => {
          this.users = users;
          this.isAuthed = true;
          this.alert = { type: 'info', message: `Loaded ${users.length} user(s).` };
        });
        this.loadDashboard();
      },
      error: err => {
        this.runInZone(() => {
          this.isAuthed = false;
          this.alert = { type: 'danger', message: `Login failed: ${formatHttpError(err)}` };
        });
      }
    });
  }

  loadDashboard(): void {
    this.tokensApi.getDashboard(this.adminSecret.trim()).pipe(
      timeout(15000),
      catchError(() => throwError(() => null))
    ).subscribe({
      next: data => this.runInZone(() => { this.dashboard = data; }),
      error: () => {}
    });
  }

  load(): void {
    if (!this.requireAuth()) return;
    const secret = this.adminSecret.trim();
    this.isLoading = true;
    this.tokensApi.listUsersAdmin(secret).pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => this.runInZone(() => { this.isLoading = false; }))
    ).subscribe({
      next: users => this.runInZone(() => {
        this.users = users;
        this.alert = { type: 'info', message: `Loaded ${users.length} user(s).` };
      }),
      error: err => this.runInZone(() => {
        this.alert = { type: 'danger', message: `Load failed: ${formatHttpError(err)}` };
      })
    });
    this.loadDashboard();
  }

  requestLogout(): void { this.showLogoutModal = true; }
  cancelLogout(): void { this.showLogoutModal = false; }
  confirmLogout(): void { this.showLogoutModal = false; this.logout(); }

  logout(): void {
    this.adminSecret = '';
    this.isAuthed = false;
    this.dashboard = null;
    this.users = [];
    this.alert = { type: 'info', message: 'Logged out.' };
  }

  requestDeleteUser(email: string): void {
    this.pendingDeleteEmail = email;
    this.showDeleteModal = true;
  }

  cancelDeleteUser(): void {
    this.showDeleteModal = false;
    this.pendingDeleteEmail = null;
  }

  confirmDeleteUser(): void {
    if (!this.pendingDeleteEmail) return;
    const email = this.pendingDeleteEmail;
    this.showDeleteModal = false;
    this.pendingDeleteEmail = null;
    this.deleteUserByEmail(email);
  }

  toggleActive(email: string): void {
    if (!this.requireAuth()) return;
    this.tokensApi.toggleUserActive(this.adminSecret.trim(), email).pipe(
      timeout(15000),
      catchError(err => throwError(() => err))
    ).subscribe({
      next: () => {
        this.runInZone(() => { this.alert = { type: 'success', message: `Updated ${email}.` }; });
        this.load();
      },
      error: err => this.runInZone(() => {
        this.alert = { type: 'danger', message: `Toggle failed: ${formatHttpError(err)}` };
      })
    });
  }

  deleteUserByEmail(email: string): void {
    this.isDeleting = true;
    this.tokensApi.deleteUserAdmin(this.adminSecret.trim(), email).pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => this.runInZone(() => { this.isDeleting = false; }))
    ).subscribe({
      next: res => {
        this.runInZone(() => { this.alert = { type: 'success', message: `Deleted ${email}.` }; });
        this.load();
      },
      error: err => this.runInZone(() => {
        this.alert = { type: 'danger', message: `Delete failed: ${formatHttpError(err)}` };
      })
    });
  }

  private requireAuth(): boolean {
    if (!this.adminSecret.trim()) {
      this.alert = { type: 'danger', message: 'Admin secret is required.' };
      return false;
    }
    if (!this.isAuthed) {
      this.alert = { type: 'danger', message: 'Please sign in to continue.' };
      return false;
    }
    return true;
  }

  private runInZone(fn: () => void): void {
    const apply = () => { fn(); queueMicrotask(() => this.cdr.detectChanges()); };
    if (NgZone.isInAngularZone()) { apply(); return; }
    this.zone.run(apply);
  }
}