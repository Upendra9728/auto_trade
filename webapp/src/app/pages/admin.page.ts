import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { throwError } from 'rxjs';
import { catchError, finalize, timeout } from 'rxjs/operators';

import { formatHttpError } from '../http-error';
import {
  TokenAdminUpdateRequest,
  TokenResponse,
  TokenService,
  TokenUpsertRequest,
} from '../token.service';

type AlertType = 'success' | 'danger' | 'info';

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.page.html',
})
export class AdminPage {
  adminSecret = '';
  isLoading = false;
  isSaving = false;
  isDeleting = false;
  isAuthed = false;
  showAddModal = false;
  showEditModal = false;

  tokens: TokenResponse[] = [];
  selectedClientId: string | null = null;

  // Create (public upsert)
  newClientId = '';
  newAccessToken = '';
  newConsent = true;

  // Update (admin patch)
  editConsent: boolean | null = null;
  editAccessToken = '';

  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly tokensApi: TokenService,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone
  ) {}

  login(): void {
    this.alert = null;
    const secret = this.adminSecret.trim();
    if (!secret) {
      this.alert = { type: 'danger', message: 'Admin secret is required.' };
      return;
    }

    this.isLoading = true;
    this.tokensApi
      .listTokensAdmin(secret)
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.runInZone(() => {
            this.isLoading = false;
          });
        })
      )
      .subscribe({
        next: (data) => {
          this.runInZone(() => {
            this.tokens = data;
            this.isAuthed = true;
            this.alert = { type: 'info', message: `Loaded ${data.length} client(s).` };
          });
        },
        error: (err) => {
          this.runInZone(() => {
            this.isAuthed = false;
            this.alert = { type: 'danger', message: `Load failed: ${formatHttpError(err)}` };
          });
        },
      });
  }

  logout(): void {
    this.adminSecret = '';
    this.tokens = [];
    this.selectedClientId = null;
    this.isAuthed = false;
    this.alert = { type: 'info', message: 'Logged out.' };
  }

  load(): void {
    if (!this.requireAuth()) return;
    const secret = this.adminSecret.trim();
    this.isLoading = true;
    this.tokensApi
      .listTokensAdmin(secret)
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.runInZone(() => {
            this.isLoading = false;
          });
        })
      )
      .subscribe({
        next: (data) => {
          this.runInZone(() => {
            this.tokens = data;
            this.alert = { type: 'info', message: `Loaded ${data.length} client(s).` };
          });
        },
        error: (err) => {
          this.runInZone(() => {
            this.alert = { type: 'danger', message: `Load failed: ${formatHttpError(err)}` };
          });
        },
      });
  }

  select(clientId: string): void {
    this.selectedClientId = clientId;
    const token = this.tokens.find((t) => t.client_id === clientId) ?? null;
    this.editConsent = token ? token.consent : null;
    this.editAccessToken = '';
  }

  openAddModal(): void {
    this.alert = null;
    this.showAddModal = true;
  }

  closeAddModal(): void {
    this.showAddModal = false;
  }

  openEditModal(clientId: string): void {
    this.alert = null;
    this.select(clientId);
    this.showEditModal = true;
  }

  closeEditModal(): void {
    this.showEditModal = false;
  }

  createOrUpsert(): void {
    this.alert = null;
    if (!this.requireAuth()) return;
    const client_id = this.newClientId.trim();
    const access_token = this.newAccessToken.trim();
    if (!client_id || !access_token) {
      this.alert = { type: 'danger', message: 'Client ID and Access Token are required.' };
      return;
    }

    this.isSaving = true;
    const req: TokenUpsertRequest = {
      client_id,
      access_token,
      consent: this.newConsent,
    };

    this.tokensApi
      .upsertTokenAdmin(this.adminSecret.trim(), req)
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.runInZone(() => {
            this.isSaving = false;
          });
        })
      )
      .subscribe({
        next: (res) => {
          this.runInZone(() => {
            this.alert = { type: 'success', message: `Saved ${res.client_id}.` };
            this.newAccessToken = '';
            this.showAddModal = false;
          });
          this.load();
        },
        error: (err) => {
          this.runInZone(() => {
            this.alert = { type: 'danger', message: `Save failed: ${formatHttpError(err)}` };
          });
        },
      });
  }

  updateSelected(): void {
    this.alert = null;
    if (!this.requireAuth()) return;
    if (!this.selectedClientId) {
      this.alert = { type: 'danger', message: 'Select a client first.' };
      return;
    }

    const req: TokenAdminUpdateRequest = {};
    if (this.editConsent !== null) req.consent = this.editConsent;
    if (this.editAccessToken.trim()) req.access_token = this.editAccessToken.trim();

    this.isSaving = true;
    this.tokensApi
      .updateTokenAdmin(this.adminSecret.trim(), this.selectedClientId, req)
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.runInZone(() => {
            this.isSaving = false;
          });
        })
      )
      .subscribe({
        next: (res) => {
          this.runInZone(() => {
            this.alert = { type: 'success', message: `Updated ${res.client_id}.` };
            this.editAccessToken = '';
            this.showEditModal = false;
          });
          this.load();
        },
        error: (err) => {
          this.runInZone(() => {
            this.alert = { type: 'danger', message: `Update failed: ${formatHttpError(err)}` };
          });
        },
      });
  }

  deleteSelected(): void {
    this.alert = null;
    if (!this.requireAuth()) return;
    if (!this.selectedClientId) {
      this.alert = { type: 'danger', message: 'Select a client first.' };
      return;
    }

    this.isDeleting = true;
    this.tokensApi
      .deleteTokenAdmin(this.adminSecret.trim(), this.selectedClientId)
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.runInZone(() => {
            this.isDeleting = false;
          });
        })
      )
      .subscribe({
        next: (res) => {
          this.runInZone(() => {
            this.alert = { type: 'success', message: `Deleted ${res.client_id}.` };
            this.selectedClientId = null;
          });
          this.load();
        },
        error: (err) => {
          this.runInZone(() => {
            this.alert = { type: 'danger', message: `Delete failed: ${formatHttpError(err)}` };
          });
        },
      });
  }

  private requireAuth(): boolean {
    const secret = this.adminSecret.trim();
    if (!secret) {
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
    if (NgZone.isInAngularZone()) {
      fn();
      this.cdr.detectChanges();
      return;
    }
    this.zone.run(() => {
      fn();
      this.cdr.detectChanges();
    });
  }
}
