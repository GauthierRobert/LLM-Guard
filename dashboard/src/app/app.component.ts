import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ErrorBusService } from './core/error-bus.service';
import { IconComponent, IconName } from './shared/icon.component';

interface NavItem { path: string; label: string; icon: IconName; }
interface NavGroup { label: string; items: NavItem[]; }

@Component({
  selector: 'lg-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="flex h-screen bg-ink-900">
      <aside class="w-60 shrink-0 bg-ink-800 border-r border-ink-700 flex flex-col">
        <div class="flex items-center gap-3 px-5 py-5">
          <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-700 to-brand-900 flex items-center justify-center font-bold text-ink-50 shadow-sm shadow-brand-900/50">G</div>
          <div>
            <div class="text-sm font-semibold text-ink-50 leading-tight">LLM Guard</div>
            <div class="text-[11px] text-brand-300 leading-tight">Dashboard</div>
          </div>
        </div>

        <nav class="flex-1 overflow-y-auto px-2 pb-4">
          @for (group of navGroups; track group.label) {
            <div class="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">{{ group.label }}</div>
            @for (item of group.items; track item.path) {
              <a [routerLink]="item.path"
                 routerLinkActive="bg-brand-700/15 text-ink-50 border-brand-700/40"
                 class="group flex items-center gap-3 px-3 py-2 mx-1 my-0.5 rounded-lg text-[13px] text-ink-100 border border-transparent hover:bg-ink-700/60 transition-colors">
                <lg-icon [name]="item.icon" [size]="18" class="text-ink-300 group-hover:text-brand-500 transition-colors"/>
                <span>{{ item.label }}</span>
              </a>
            }
          }
        </nav>

        <div class="px-4 py-3 border-t border-ink-700 text-[10px] text-ink-400">
          <div>v2 · Self-hosted</div>
          <div class="text-ink-500">RGPD + IA Act</div>
        </div>
      </aside>

      <main class="flex-1 overflow-y-auto">
        <div class="px-8 py-6 max-w-[1400px] mx-auto">
          <router-outlet/>
        </div>
      </main>
    </div>

    @if (errorBus.toasts().length > 0) {
      <div class="fixed bottom-5 right-5 flex flex-col gap-2 z-[9999] max-w-[420px]" role="status" aria-live="polite">
        @for (t of errorBus.toasts(); track t.id) {
          <div class="flex items-start gap-2.5 bg-danger-900/90 backdrop-blur border border-danger-700 text-danger-100 px-3 py-2.5 rounded-lg shadow-lg shadow-black/40 text-[13px]">
            <lg-icon name="error_outline" [size]="18" class="text-danger-500 shrink-0 mt-px"/>
            <span class="flex-1">{{ t.message }}</span>
            <button type="button" (click)="errorBus.dismiss(t.id)" aria-label="Fermer"
                    class="shrink-0 text-danger-100 hover:text-white px-1 -my-1">
              <lg-icon name="close" [size]="16"/>
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class AppComponent {
  protected readonly errorBus = inject(ErrorBusService);
  protected readonly navGroups: NavGroup[] = [
    {
      label: 'Supervision',
      items: [
        { path: '/overview', label: 'Vue d’ensemble', icon: 'dashboard' },
        { path: '/stats', label: 'Statistiques & détections', icon: 'pie_chart' },
        { path: '/events',   label: 'Évènements',    icon: 'list_alt' },
      ],
    },
    {
      label: 'Conformité',
      items: [
        { path: '/compliance',  label: 'Articles RGPD / IA Act', icon: 'gavel' },
        { path: '/dpia',        label: 'AIPD & RoPA',            icon: 'description' },
        { path: '/risk-tiers',  label: 'Niveaux de risque IA',   icon: 'smart_toy' },
        { path: '/transfers',   label: 'Transferts hors UE',     icon: 'public' },
      ],
    },
    {
      label: 'Administration',
      items: [
        { path: '/devices',  label: 'Appareils',   icon: 'devices' },
        { path: '/settings', label: 'Paramètres',  icon: 'settings' },
      ],
    },
  ];
}
