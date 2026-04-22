import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  {
    path: 'overview',
    loadComponent: () => import('./features/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    path: 'events',
    loadComponent: () => import('./features/events/events.component').then((m) => m.EventsComponent),
  },
  {
    path: 'findings',
    loadComponent: () => import('./features/findings/findings.component').then((m) => m.FindingsComponent),
  },
  {
    path: 'compliance',
    loadComponent: () => import('./features/compliance/compliance.component').then((m) => m.ComplianceComponent),
  },
  {
    path: 'dpia',
    loadComponent: () => import('./features/dpia/dpia.component').then((m) => m.DpiaComponent),
  },
  {
    path: 'risk-tiers',
    loadComponent: () => import('./features/risk-tiers/risk-tiers.component').then((m) => m.RiskTiersComponent),
  },
  {
    path: 'transfers',
    loadComponent: () => import('./features/transfers/transfers.component').then((m) => m.TransfersComponent),
  },
  {
    path: 'devices',
    loadComponent: () => import('./features/devices/devices.component').then((m) => m.DevicesComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
];
