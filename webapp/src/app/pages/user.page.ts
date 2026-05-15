import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { throwError } from 'rxjs';
import { catchError, finalize, timeout } from 'rxjs/operators';
import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';
import { TokenService } from '../token.service';

type AlertType = 'success' | 'danger' | 'info';

@Component({
  selector: 'app-user-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user.page.html',
})
export class UserPage {
  accessToken = '';
  consent = true;
  hasToken = false;
  lastUpdatedAt = '';

  appClientId = '';
  appClientSecret = '';
  hasApp = false;
  appUpdatedAt = '';

  isLoading = false;
  isSaving = false;
  isSavingApp = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    public readonly auth: AuthService,
    private readonly tokensApi: TokenService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.loadTokenStatus();
    this.loadUpstoxAppStatus();
  }

  connectUpstox(): void {
    this.alert = null;
    this.tokensApi.getUpstoxAuthUrl().subscribe({
      next: (res) => {
        if (res?.url) {
          // Open in a new tab so the callback can redirect back to the webapp
          window.open(res.url, '_blank');
        } else {
          this.alert = { type: 'danger', message: 'No auth URL returned from backend' };
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        const detail = err?.error?.detail;
        const msg = detail ? `${detail}` : `${err?.message ?? err}`;
        this.alert = { type: 'danger', message: `Could not start OAuth: ${msg}` };
        this.cdr.detectChanges();
      },
    });
  }

  loadUpstoxAppStatus(): void {
    this.tokensApi
      .getUserUpstoxApp()
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        })
      )
      .subscribe({
        next: (res) => {
          this.hasApp = res.has_app;
          this.appClientId = res.client_id ?? '';
          this.appUpdatedAt = res.updated_at ?? '';
          this.cdr.detectChanges();
        },
        error: () => {
          // non-fatal, keep silent to avoid noisy UI
        },
      });
  }

  loadTokenStatus(): void {
    this.alert = null;
    this.isLoading = true;
    this.tokensApi
      .getUserTokenStatus()
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (res) => {
          this.hasToken = res.has_token;
          this.consent = res.token?.consent ?? true;
          this.lastUpdatedAt = res.token?.updated_at ?? '';
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.alert = { type: 'danger', message: `Unable to load token status: ${formatHttpError(err)}` };
          this.cdr.detectChanges();
        },
      });
  }

  saveUpstoxApp(): void {
    this.alert = null;

    const client_id = this.appClientId.trim();
    const client_secret = this.appClientSecret.trim();

    if (!client_id || !client_secret) {
      this.alert = {
        type: 'danger',
        message: 'Client ID and Client Secret are required.',
      };
      return;
    }

    this.isSavingApp = true;
    this.tokensApi
      .upsertUserUpstoxApp({ client_id, client_secret })
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.isSavingApp = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (res) => {
          this.hasApp = res.has_app;
          this.appClientId = res.client_id ?? client_id;
          this.appUpdatedAt = res.updated_at ?? '';
          this.appClientSecret = '';
          this.alert = {
            type: 'success',
            message: 'Upstox app credentials saved.',
          };
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.alert = {
            type: 'danger',
            message: `Save failed: ${formatHttpError(err)}`,
          };
          this.cdr.detectChanges();
        },
      });
  }

  save(): void {
    this.alert = null;

    const access_token = this.accessToken.trim();

    if (!access_token) {
      this.alert = {
        type: 'danger',
        message: 'Access Token is required.',
      };
      return;
    }

    this.isSaving = true;

    this.tokensApi
      .upsertUserToken({
        access_token,
        consent: this.consent,
      })
      .pipe(
        timeout(15000),
        catchError((err) => {
          if (err?.name === 'TimeoutError') {
            return throwError(() => new Error('Request timed out. Check backend or proxy.'));
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.isSaving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (res) => {
          this.alert = {
            type: 'success',
            message: this.hasToken
              ? `Token updated for ${res.client_id}`
              : `Token created for ${res.client_id}`,
          };

          this.hasToken = true;
          this.lastUpdatedAt = res.updated_at;
          this.accessToken = '';
          this.cdr.detectChanges();
        },

        error: (err) => {
          this.alert = {
            type: 'danger',
            message: `Save failed: ${formatHttpError(err)}`,
          };
          this.cdr.detectChanges();
        },
      });
  }
}
