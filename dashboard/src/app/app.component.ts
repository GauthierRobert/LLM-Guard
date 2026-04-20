import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';

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
          @for (item of nav; track item.path) {
            <a mat-list-item [routerLink]="item.path" routerLinkActive="active">
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content>
        <main class="content">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [
    `
      .shell { height: 100vh; }
      .nav { width: 220px; background: #14151a; border-right: 1px solid #1e1f23; }
      .brand { display: flex; gap: 10px; align-items: center; padding: 20px 18px; }
      .brand-badge { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #0F6E56, #085041); color: #e1f5ee; display: flex; align-items: center; justify-content: center; font-weight: 700; }
      .brand-name { font-weight: 600; color: #e1f5ee; }
      .brand-sub { font-size: 11px; color: #9fe1cb; }
      .active { background: rgba(15, 110, 86, 0.15) !important; }
      .content { padding: 24px 32px; max-width: 1400px; }
    `,
  ],
})
export class AppComponent {
  protected readonly nav = [
    { path: '/overview', label: 'Vue d\u2019ensemble', icon: 'dashboard' },
    { path: '/events', label: 'Évènements', icon: 'list_alt' },
    { path: '/findings', label: 'Détections', icon: 'shield' },
    { path: '/devices', label: 'Appareils', icon: 'devices' },
    { path: '/settings', label: 'Paramètres', icon: 'settings' },
  ];
}
