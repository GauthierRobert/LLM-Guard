import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';

import { ApiService, DeviceRow } from '../../core/api.service';

@Component({
  selector: 'lg-devices',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatProgressSpinnerModule, MatTableModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Appareils</h1>
        <p class="sub">Flotte active, dernière activité, révocation des jetons.</p>
      </div>
      <button mat-stroked-button (click)="refresh()" [disabled]="loading()">
        <mat-icon>refresh</mat-icon> Rafraîchir
      </button>
    </header>

    <mat-card class="pane">
      @if (loading()) {
        <div class="state"><mat-spinner diameter="28"></mat-spinner><span>Chargement…</span></div>
      } @else if (error()) {
        <div class="state err">
          <mat-icon>error_outline</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else if (rows().length === 0) {
        <div class="state">
          <mat-icon>devices</mat-icon>
          <span>Aucun appareil enregistré — activez la télémétrie dans l'extension, ou lancez <code>bash infra/seed-demo.sh</code>.</span>
        </div>
      } @else {
        <table mat-table [dataSource]="rows()">
          <ng-container matColumnDef="userHint">
            <th mat-header-cell *matHeaderCellDef>Utilisateur</th>
            <td mat-cell *matCellDef="let r">{{ r.userHint || '—' }}</td>
          </ng-container>
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>Device ID</th>
            <td mat-cell *matCellDef="let r" class="mono">{{ shortId(r.id) }}</td>
          </ng-container>
          <ng-container matColumnDef="extensionVersion">
            <th mat-header-cell *matHeaderCellDef>Version</th>
            <td mat-cell *matCellDef="let r">{{ r.extensionVersion || '—' }}</td>
          </ng-container>
          <ng-container matColumnDef="lastSeenAt">
            <th mat-header-cell *matHeaderCellDef>Dernière activité</th>
            <td mat-cell *matCellDef="let r">{{ r.lastSeenAt ? (r.lastSeenAt | date: 'short') : 'jamais' }}</td>
          </ng-container>
          <ng-container matColumnDef="eventCount24h">
            <th mat-header-cell *matHeaderCellDef class="num">Évèn. 24h</th>
            <td mat-cell *matCellDef="let r" class="num">{{ r.eventCount24h }}</td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Statut</th>
            <td mat-cell *matCellDef="let r">
              @if (r.revoked) {
                <mat-chip class="chip-revoked">Révoqué</mat-chip>
              } @else {
                <mat-chip class="chip-ok">Actif</mat-chip>
              }
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let r">
              @if (!r.revoked) {
                <button mat-button color="warn" (click)="revoke(r)" [disabled]="revoking() === r.id">
                  {{ revoking() === r.id ? 'Révocation…' : 'Révoquer' }}
                </button>
              }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr mat-row *matRowDef="let r; columns: cols" [class.row-revoked]="r.revoked"></tr>
        </table>
      }
    </mat-card>
  `,
  styles: [
    `
      .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
      h1 { font-size: 22px; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; }
      .pane { padding: 0; overflow: hidden; }
      .state { display: flex; gap: 12px; align-items: center; padding: 40px 24px; color: #888780; font-size: 13px; justify-content: center; }
      .state mat-icon { color: #0F6E56; font-size: 28px; width: 28px; height: 28px; }
      .state.err mat-icon { color: #E24B4A; }
      .state code { background: #14151a; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; }
      table { width: 100%; }
      td.mono, td.num { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      th.num, td.num { text-align: right; }
      .chip-ok { background: #2a3b34; color: #9fe1cb; }
      .chip-revoked { background: #501313; color: #F09595; }
      .row-revoked { opacity: 0.55; }
    `,
  ],
})
export class DevicesComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly cols = ['userHint', 'id', 'extensionVersion', 'lastSeenAt', 'eventCount24h', 'status', 'actions'];
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
