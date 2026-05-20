import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';
import { AlertComponent } from '../shared/alert.component';
import { ModalComponent } from '../shared/modal.component';

type AlertType = 'success' | 'danger' | 'info';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AlertComponent, ModalComponent],
  templateUrl: './register.page.html',
})
export class RegisterPage {
  name = '';
  email = '';
  phone_number = '';
  password = '';
  confirmPassword = '';

  isSaving = false;
  showSuccessModal = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  register(): void {
    this.alert = null;
    const name = this.name.trim();
    const email = this.email.trim().toLowerCase();
    const phone_number = this.phone_number.trim();
    const password = this.password;

    if (!name || !email || !phone_number || !password) {
      this.alert = { type: 'danger', message: 'All fields are required.' };
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.alert = { type: 'danger', message: 'Passwords do not match.' };
      return;
    }

    this.isSaving = true;
    this.auth
      .register({ name, email, phone_number, password })
      .pipe(
        finalize(() => {
          this.isSaving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.alert = null;
          this.showSuccessModal = true;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.alert = { type: 'danger', message: `Registration failed: ${formatHttpError(err)}` };
          this.cdr.detectChanges();
        },
      });
  }

  cancelSuccess(): void {
    this.showSuccessModal = false;
  }

  confirmGoToLogin(): void {
    this.showSuccessModal = false;
    this.router.navigateByUrl('/login');
  }
}
