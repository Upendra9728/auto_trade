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

  isLoading = false;
  isSaving = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    public readonly auth: AuthService,
    private readonly tokensApi: TokenService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.loadTokenStatus();
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
