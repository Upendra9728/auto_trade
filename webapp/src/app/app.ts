import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { ModalComponent } from './shared/modal.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  showLogoutModal = false;

  constructor(
    public readonly auth: AuthService,
    public readonly router: Router
  ) {
    // Validate stored session on every app load to clear stale tokens
    this.auth.validateSession();
  }

  logout(): void {
    this.showLogoutModal = true;
  }

  cancelLogout(): void {
    this.showLogoutModal = false;
  }

  confirmLogout(): void {
    this.showLogoutModal = false;

    this.auth.logout().subscribe({
      next: () => {
        this.router.navigateByUrl('/login');
      },
      error: () => {
        this.auth.forceLogout();
        this.router.navigateByUrl('/login');
      },
    });
  }
}
