import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';
import { AlertComponent } from '../shared/alert.component';
import { ModalComponent } from '../shared/modal.component';

type AlertType = 'success' | 'danger' | 'info';

const BROKER_LABELS: Record<string, string> = {
  upstox: 'Upstox',
  dhann: 'Dhann',
  fyers: 'Fyers',
};

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AlertComponent, ModalComponent],
  templateUrl: './register.page.html',
})
export class RegisterPage implements OnInit {
  name = '';
  email = '';
  phone_number = '';
  password = '';
  confirmPassword = '';
  broker = 'upstox';

  isSaving = false;
  showSuccessModal = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const brokerParam = this.route.snapshot.queryParamMap.get('broker');
    if (brokerParam && ['upstox', 'dhann', 'fyers'].includes(brokerParam)) {
      this.broker = brokerParam;
    }
  }

  get brokerLabel(): string {
    return BROKER_LABELS[this.broker] || this.broker;
  }

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
      .register({ name, email, phone_number, password, broker: this.broker })
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
          const msg = formatHttpError(err);
          // If the email is already registered, guide the user to login instead
          if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('email')) {
            this.alert = {
              type: 'info',
              message: 'This email is already registered. One account covers all brokers — just log in and add your broker tokens from the account page.',
            };
          } else {
            this.alert = { type: 'danger', message: `Registration failed: ${msg}` };
          }
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