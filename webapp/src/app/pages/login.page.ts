import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, throwError, timeout } from 'rxjs';

import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';
import { AlertComponent } from '../shared/alert.component';

type AlertType = 'success' | 'danger' | 'info';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AlertComponent],
  templateUrl: './login.page.html',
})
export class LoginPage {
  email = '';
  password = '';
  isLoading = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  login(): void {
    this.alert = null;
    const email = this.email.trim();
    const password = this.password.trim();
    if (!email || !password) {
      this.alert = { type: 'danger', message: 'Email and password are required.' };
      return;
    }

    this.isLoading = true;
    this.auth
      .login({ email, password })
      .pipe(
        timeout(15000),
        catchError((err) => throwError(() => err)),
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.cdr.detectChanges();
          this.router.navigateByUrl('/user');
        },
        error: (err) => {
          this.alert = { type: 'danger', message: `Login failed: ${formatHttpError(err)}` };
          this.cdr.detectChanges();
        },
      });
  }
}
