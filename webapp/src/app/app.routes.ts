import { Routes } from '@angular/router';

import { authGuard } from './auth.guard';
import { AdminPage } from './pages/admin.page';
import { LoginPage } from './pages/login.page';
import { RegisterPage } from './pages/register.page';
import { ResetPasswordPage } from './pages/reset-password.page';
import { UserPage } from './pages/user.page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPage },
  { path: 'register', component: RegisterPage },
  { path: 'reset-password', component: ResetPasswordPage },
  { path: 'user', component: UserPage, canActivate: [authGuard] },
  { path: 'admin', component: AdminPage },
  { path: '**', redirectTo: 'login' },
];
