import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';

type AlertType = 'success' | 'danger' | 'info';

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.page.html',
})
export class ResetPasswordPage {
  email = '';
  otp = '';
  newPassword = '';
  confirmPassword = '';

  otpRequested = false;
  isRequesting = false;
  isResetting = false;

  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  requestOtp(): void {
    this.alert = null;
    const email = this.email.trim().toLowerCase();
    if (!email) {
      this.alert = { type: 'danger', message: 'Email is required.' };
      return;
    }

    this.isRequesting = true;
    this.auth
      .requestPasswordReset(email)
      .pipe(
        finalize(() => {
          this.isRequesting = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.otpRequested = true;
          this.alert = {
            type: 'success',
            message: 'OTP sent to your Gmail. Check inbox/spam and submit below.',
          };
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.alert = { type: 'danger', message: `OTP request failed: ${formatHttpError(err)}` };
          this.cdr.detectChanges();
        },
      });
  }

  resetPassword(): void {
    this.alert = null;
    const email = this.email.trim().toLowerCase();
    const otp = this.otp.trim();

    if (!email || !otp || !this.newPassword) {
      this.alert = { type: 'danger', message: 'Email, OTP and new password are required.' };
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.alert = { type: 'danger', message: 'Passwords do not match.' };
      return;
    }

    this.isResetting = true;
    this.auth
      .verifyPasswordReset({ email, otp, new_password: this.newPassword })
      .pipe(
        finalize(() => {
          this.isResetting = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.alert = { type: 'success', message: 'Password updated. You can login now.' };
          this.otp = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.alert = { type: 'danger', message: `Reset failed: ${formatHttpError(err)}` };
          this.cdr.detectChanges();
        },
      });
  }
}
