import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';

import { ApiService, DeviceRow } from '../../core/api.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-devices',
  standalone: true,
  imports: [DatePipe, IconComponent],
  template: `
    <header class="flex justify-between items-start mb-5 gap-4">
      <div>
        <h1 class="text-[22px] font-semibold text-ink-50">Appareils</h1>
        <p class="text-ink-300 text-[13px] mt-1">Flotte active, dernière activité, révocation des jetons.</p>
      </div>
      <button type="button" (click)="refresh()" [disabled]="loading()"
              class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-700 text-ink-100 text-[13px] hover:border-brand-700 hover:bg-brand-700/10 disabled:opacity-50 transition-colors">
        <lg-icon name="refresh" [size]="16"/> Rafraîchir
      </button>
    </header>

    <div class="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
      @if (loading()) {
        <div class="flex items-center justify-center gap-3 py-12 text-ink-300 text-[13px]">
          <span class="inline-block w-5 h-5 border-2 border-ink-600 border-t-brand-500 rounded-full animate-spin"></span>
          <span>Chargement…</span>
        </div>
      } @else if (error()) {
        <div class="flex items-center justify-center gap-3 py-12 text-ink-300 text-[13px]">
          <lg-icon name="error_outline" [size]="24" class="text-danger-500"/>
          <span>{{ error() }}</span>
        </div>
      } @else if (rows().length === 0) {
        <div class="flex items-center justify-center gap-3 py-12 text-ink-300 text-[13px] text-center px-4">
          <lg-icon name="devices" [size]="28" class="text-brand-700"/>
          <span>Aucun appareil enregistré — activez la télémétrie dans l'extension et configurez-la avec <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">https://localhost</code> + jeton fourni par l'administrateur.</span>
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="bg-ink-900/50 border-b border-ink-700">
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Utilisateur</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Device ID</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Version</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Dernière activité</th>
                <th class="text-right px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Évèn. 24h</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Statut</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-b border-ink-700 hover:bg-ink-900/40 transition-colors" [class.opacity-55]="r.revoked">
                  <td class="px-4 py-3 text-ink-100">{{ r.userHint || '—' }}</td>
                  <td class="px-4 py-3 text-ink-100 font-mono">{{ shortId(r.id) }}</td>
                  <td class="px-4 py-3 text-ink-100">{{ r.extensionVersion || '—' }}</td>
                  <td class="px-4 py-3 text-ink-100">{{ r.lastSeenAt ? (r.lastSeenAt | date: 'short') : 'jamais' }}</td>
                  <td class="px-4 py-3 text-right font-mono tabular-nums text-ink-100">{{ r.eventCount24h }}</td>
                  <td class="px-4 py-3">
                    @if (r.revoked) {
                      <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-danger-800 text-danger-300 uppercase tracking-wide">Révoqué</span>
                    } @else {
                      <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-clean-900 text-brand-300 uppercase tracking-wide">Actif</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-right">
                    @if (!r.revoked) {
                      <button type="button" (click)="revoke(r)" [disabled]="revoking() === r.id"
                              class="text-[12px] text-danger-300 hover:text-danger-500 disabled:opacity-50 font-medium">
                        {{ revoking() === r.id ? 'Révocation…' : 'Révoquer' }}
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DevicesComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rows = signal<DeviceRow[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly error = signal<string | null>(null);
  protected readonly revoking = signal<string | null>(null);

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.devices().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.status === 401 ? 'Authentification requise.' : 'Impossible de charger la flotte.');
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  protected revoke(row: DeviceRow): void {
    if (!confirm(`Révoquer le jeton de ${row.userHint || this.shortId(row.id)} ? L'extension devra être reconfigurée.`)) return;
    this.revoking.set(row.id);
    this.api.revokeDevice(row.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.revoking.set(null);
        this.refresh();
      },
      error: () => {
        this.revoking.set(null);
        this.error.set('La révocation a échoué.');
      },
    });
  }

  protected shortId(id: string): string {
    return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
  }
}
