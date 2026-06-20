import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError, finalize, timeout } from 'rxjs/operators';

import { AuthService } from '../auth.service';
import { formatHttpError } from '../http-error';
import { AlertComponent } from '../shared/alert.component';
import { BrokerTokenSummary, TokenService } from '../token.service';

type AlertType = 'success' | 'danger' | 'info';

const BROKER_LABELS: Record<string, string> = {
  upstox: 'Upstox',
  dhann: 'Dhann',
  fyers: 'Fyers',
};

@Component({
  selector: 'app-user-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AlertComponent],
  templateUrl: './user.page.html',
})
export class UserPage implements OnInit {
  // Broker selection
  activeBroker: string = 'upstox';
  brokerTokens: BrokerTokenSummary[] = [];
  readonly allBrokers = ['upstox', 'dhann', 'fyers'];

  // Upstox state
  upstoxClientId = '';
  upstoxClientSecret = '';
  upstoxAccessToken = '';
  upstoxConsent = true;
  hasUpstoxApp = false;
  hasUpstoxToken = false;
  upstoxAppUpdatedAt = '';
  upstoxTokenUpdatedAt = '';
  isSavingApp = false;
  isSavingUpstoxToken = false;

  // Dhann / Fyers state
  brokerClientId = '';
  brokerAccessToken = '';
  brokerConsent = true;
  isSavingBrokerToken = false;

  isLoading = false;
  alert: { type: AlertType; message: string } | null = null;

  constructor(
    public readonly auth: AuthService,
    private readonly tokensApi: TokenService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const primaryBroker = this.auth.getCurrentUser()?.primary_broker || 'upstox';
    const paramBroker = this.route.snapshot.queryParamMap.get('broker');
    this.activeBroker = paramBroker || primaryBroker;
    this.loadAll();
  }

  get brokerLabel(): string {
    return BROKER_LABELS[this.activeBroker] || this.activeBroker;
  }

  get activeBrokerToken(): BrokerTokenSummary | null {
    return this.brokerTokens.find(t => t.broker === this.activeBroker) || null;
  }

  switchBroker(broker: string): void {
    this.activeBroker = broker;
    this.alert = null;
    this.loadBrokerSpecificData();
  }

  loadAll(): void {
    this.isLoading = true;
    this.tokensApi.getAllBrokerTokens().pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => { this.isLoading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: res => {
        this.brokerTokens = res.tokens;
        this.loadBrokerSpecificData();
        this.cdr.detectChanges();
      },
      error: err => {
        this.alert = { type: 'danger', message: `Failed to load tokens: ${formatHttpError(err)}` };
        this.loadBrokerSpecificData();
        this.cdr.detectChanges();
      }
    });
  }

  loadBrokerSpecificData(): void {
    if (this.activeBroker === 'upstox') {
      this.loadUpstoxApp();
      this.loadUpstoxToken();
    } else {
      const existing = this.activeBrokerToken;
      if (existing) {
        this.brokerClientId = existing.client_id;
        this.brokerConsent = existing.consent;
      }
    }
  }

  loadUpstoxApp(): void {
    this.tokensApi.getUserUpstoxApp().pipe(
      timeout(15000),
      catchError(err => throwError(() => err))
    ).subscribe({
      next: res => {
        this.hasUpstoxApp = res.has_app;
        this.upstoxClientId = res.client_id ?? '';
        this.upstoxAppUpdatedAt = res.updated_at ?? '';
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  loadUpstoxToken(): void {
    this.tokensApi.getUserTokenStatus().pipe(
      timeout(15000),
      catchError(err => throwError(() => err))
    ).subscribe({
      next: res => {
        this.hasUpstoxToken = res.has_token;
        this.upstoxConsent = res.token?.consent ?? true;
        this.upstoxTokenUpdatedAt = res.token?.updated_at ?? '';
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  connectUpstox(): void {
    this.alert = null;
    this.tokensApi.getUpstoxAuthUrl().subscribe({
      next: res => {
        if (res?.url) window.open(res.url, '_blank');
        else {
          this.alert = { type: 'danger', message: 'No auth URL returned from backend' };
          this.cdr.detectChanges();
        }
      },
      error: err => {
        const msg = err?.error?.detail || err?.message || String(err);
        this.alert = { type: 'danger', message: `Could not start OAuth: ${msg}` };
        this.cdr.detectChanges();
      }
    });
  }

  saveUpstoxApp(): void {
    this.alert = null;
    const client_id = this.upstoxClientId.trim();
    const client_secret = this.upstoxClientSecret.trim();
    if (!client_id || !client_secret) {
      this.alert = { type: 'danger', message: 'Client ID and Client Secret are required.' };
      return;
    }
    this.isSavingApp = true;
    this.tokensApi.upsertUserUpstoxApp({ client_id, client_secret }).pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => { this.isSavingApp = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: res => {
        this.hasUpstoxApp = res.has_app;
        this.upstoxClientId = res.client_id ?? client_id;
        this.upstoxClientSecret = '';
        this.alert = { type: 'success', message: 'Upstox app credentials saved.' };
        this.cdr.detectChanges();
      },
      error: err => {
        this.alert = { type: 'danger', message: `Save failed: ${formatHttpError(err)}` };
        this.cdr.detectChanges();
      }
    });
  }

  saveUpstoxToken(): void {
    this.alert = null;
    const access_token = this.upstoxAccessToken.trim();
    if (!access_token) {
      this.alert = { type: 'danger', message: 'Access Token is required.' };
      return;
    }
    this.isSavingUpstoxToken = true;
    this.tokensApi.upsertUserToken({
      client_id: this.auth.getCurrentUser()?.email || '',
      access_token,
      consent: this.upstoxConsent,
    }).pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => { this.isSavingUpstoxToken = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: res => {
        this.hasUpstoxToken = true;
        this.upstoxTokenUpdatedAt = res.updated_at;
        this.upstoxAccessToken = '';
        this.alert = { type: 'success', message: 'Upstox token saved successfully.' };
        this.loadAll();
        this.cdr.detectChanges();
      },
      error: err => {
        this.alert = { type: 'danger', message: `Save failed: ${formatHttpError(err)}` };
        this.cdr.detectChanges();
      }
    });
  }

  saveBrokerToken(): void {
    this.alert = null;
    const client_id = this.brokerClientId.trim();
    const access_token = this.brokerAccessToken.trim();
    if (!client_id || !access_token) {
      this.alert = { type: 'danger', message: 'Client ID and Access Token are required.' };
      return;
    }
    this.isSavingBrokerToken = true;
    this.tokensApi.upsertBrokerToken(this.activeBroker, {
      client_id,
      access_token,
      consent: this.brokerConsent,
    }).pipe(
      timeout(15000),
      catchError(err => throwError(() => err)),
      finalize(() => { this.isSavingBrokerToken = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: () => {
        this.brokerAccessToken = '';
        this.alert = { type: 'success', message: `${this.brokerLabel} credentials saved.` };
        this.loadAll();
        this.cdr.detectChanges();
      },
      error: err => {
        this.alert = { type: 'danger', message: `Save failed: ${formatHttpError(err)}` };
        this.cdr.detectChanges();
      }
    });
  }

  brokerHasToken(broker: string): boolean {
    return this.brokerTokens.some(t => t.broker === broker);
  }
}