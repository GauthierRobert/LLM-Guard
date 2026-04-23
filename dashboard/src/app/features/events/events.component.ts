import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { ApiService } from '../../core/api.service';
import { LLMGuardEvent } from '../../core/schema.generated';
import { LiveService } from '../../core/live.service';

@Component({
  selector: 'lg-events',
  standalone: true,
  imports: [DatePipe, MatCardModule, MatTableModule, MatChipsModule, MatIconModule, MatButtonModule],
  template: `
    <header class="page-head">
      <h1>Évènements</h1>
      <button mat-stroked-button (click)="toggleLive()">
        <mat-icon>{{ live.connected() ? 'sync' : 'sync_disabled' }}</mat-icon>
        {{ live.connected() ? 'Live activé' : 'Activer le live' }}
      </button>
    </header>

    <mat-card class="pane">
      @if (rows().length > 0) {
        <table mat-table [dataSource]="rows()">
          <ng-container matColumnDef="timestamp">
            <th mat-header-cell *matHeaderCellDef>Heure</th>
            <td mat-cell *matCellDef="let r">{{ r.timestamp | date: 'short' }}</td>
          </ng-container>
          <ng-container matColumnDef="llm">
            <th mat-header-cell *matHeaderCellDef>LLM</th>
            <td mat-cell *matCellDef="let r">{{ r.llm }}</td>
          </ng-container>
          <ng-container matColumnDef="action">
            <th mat-header-cell *matHeaderCellDef>Action</th>
            <td mat-cell *matCellDef="let r"><mat-chip [class]="'chip-' + r.action">{{ r.action }}</mat-chip></td>
          </ng-container>
          <ng-container matColumnDef="hostname">
            <th mat-header-cell *matHeaderCellDef>Hôte</th>
            <td mat-cell *matCellDef="let r">{{ r.hostname }}</td>
          </ng-container>
          <ng-container matColumnDef="findings">
            <th mat-header-cell *matHeaderCellDef>Détections</th>
            <td mat-cell *matCellDef="let r">
              @for (f of r.findings; track f.type) {
                <mat-chip [class]="'sev-' + f.severity">{{ f.type }} ({{ f.count }})</mat-chip>
              }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr mat-row *matRowDef="let r; columns: cols"></tr>
        </table>
      } @else if (loaded()) {
        <div class="empty-state">
          <mat-icon>list_alt</mat-icon>
          <p>Aucun évènement ingéré. Activez la télémétrie dans l'extension ou lancez <code>bash infra/seed-demo.sh</code>.</p>
        </div>
      } @else {
        <p class="empty">Chargement…</p>
      }
    </mat-card>
  `,
  styles: [
    `
      .page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      h1 { font-size: 22px; color: #e1f5ee; }
      .pane { padding: 0; overflow: hidden; }
      .chip-CLEAN { background: #2a3b34; color: #9fe1cb; }
      .chip-ANONYMIZED { background: #0F6E56; color: #e1f5ee; }
      .chip-PII_DETECTED { background: #412402; color: #FAC775; }
      .chip-BLOCKED { background: #501313; color: #F09595; }
      .sev-critical { background: #501313; color: #F09595; }
      .sev-high { background: #4A1B0C; color: #F0997B; }
      .sev-medium { background: #412402; color: #FAC775; }
      .sev-low { background: #042C53; color: #85B7EB; }
      .empty-state { padding: 40px 24px; text-align: center; color: #888780; }
      .empty-state mat-icon { font-size: 40px; width: 40px; height: 40px; color: #0F6E56; margin-bottom: 8px; }
      .empty-state code { background: #14151a; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; }
      .empty { padding: 24px; color: #5f5e5a; }
    `,
  ],
})
export class EventsComponent {
  private readonly api = inject(ApiService);
  protected readonly live = inject(LiveService);
  protected readonly cols = ['timestamp', 'llm', 'action', 'hostname', 'findings'];
  protected readonly rows = signal<LLMGuardEvent[]>([]);
  protected readonly loaded = signal<boolean>(false);

  constructor() {
    this.api.events({ limit: 100 }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.loaded.set(true);
      },
      error: () => {
        this.rows.set([]);
        this.loaded.set(true);
      },
    });
  }

  protected toggleLive(): void {
    if (this.live.connected()) this.live.disconnect();
    else this.live.connect();
  }
}
