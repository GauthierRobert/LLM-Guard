import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';

import { ErrorBusService } from './core/error-bus.service';

@Component({
  selector: 'lg-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatIconModule, MatListModule, MatSidenavModule],
  template: `
    <mat-sidenav-container class="shell">
      <mat-sidenav mode="side" opened class="nav">
        <div class="brand">
          <div class="brand-badge">G</div>
          <div>
            <div class="brand-name">LLM Guard</div>
            <div class="brand-sub">Dashboard</div>
          </div>
        </div>
        <mat-nav-list>
          @for (group of navGroups; track group.label) {
            <div class="nav-group">{{ group.label }}</div>
            @for (item of group.items; track item.path) {
              <a mat-list-item [routerLink]="item.path" routerLinkActive="active">
                <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                <span matListItemTitle>{{ item.label }}</span>
              </a>
            }
          }
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content>
        <main class="content">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>

    @if (errorBus.toasts().length > 0) {
      <div class="toast-stack" role="status" aria-live="polite">
        @for (t of errorBus.toasts(); track t.id) {
          <div class="toast">
            <mat-icon class="toast-icon">error_outline</mat-icon>
            <span class="toast-msg">{{ t.message }}</span>
            <button class="toast-close" (click)="errorBus.dismiss(t.id)" aria-label="Fermer">×</button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .shell { height: 100vh; }
      .nav { width: 232px; background: #14151a; border-right: 1px solid #1e1f23; }
      .brand { display: flex; gap: 10px; align-items: center; padding: 20px 18px; }
      .brand-badge { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #0F6E56, #085041); color: #e1f5ee; display: flex; align-items: center; justify-content: center; font-weight: 700; }
      .brand-name { font-weight: 600; color: #e1f5ee; }
      .brand-sub { font-size: 11px; color: #9fe1cb; }
      .nav-group { padding: 12px 18px 4px; font-size: 10px; text-transform: uppercase; color: #5f5e5a; letter-spacing: 0.8px; font-weight: 600; }
      .active { background: rgba(15, 110, 86, 0.15) !important; }
      .content { padding: 24px 32px; max-width: 1400px; }

      .toast-stack { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 9999; max-width: 420px; }
      .toast { display: flex; gap: 10px; align-items: flex-start; background: #2a1818; border: 1px solid #7a2b2b; color: #f4d4d4; padding: 10px 12px; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); font-size: 13px; }
      .toast-icon { color: #E24B4A; font-size: 20px; width: 20px; height: 20px; }
      .toast-msg { flex: 1; }
      .toast-close { background: transparent; border: none; color: #f4d4d4; font-size: 18px; cursor: pointer; padding: 0 4px; }
      .toast-close:hover { color: #fff; }
    `,
  ],
})
export class AppComponent {
  protected readonly errorBus = inject(ErrorBusService);
  protected readonly navGroups = [
    {
      label: 'Supervision',
      items: [
        { path: '/overview', label: 'Vue d’ensemble', icon: 'dashboard' },
        { path: '/events', label: 'Évènements', icon: 'list_alt' },
        { path: '/findings', label: 'Détections', icon: 'shield' },
      ],
    },
    {
      label: 'Conformité',
      items: [
        { path: '/compliance', label: 'Articles RGPD / IA Act', icon: 'gavel' },
        { path: '/dpia', label: 'AIPD & RoPA', icon: 'description' },
        { path: '/risk-tiers', label: 'Niveaux de risque IA', icon: 'smart_toy' },
        { path: '/transfers', label: 'Transferts hors UE', icon: 'public' },
      ],
    },
    {
      label: 'Administration',
      items: [
        { path: '/devices', label: 'Appareils', icon: 'devices' },
        { path: '/settings', label: 'Paramètres', icon: 'settings' },
      ],
    },
  ];
}
