import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ApiService, TimeRange } from '../../core/api.service';
import { StatsResponse } from '../../core/schema.generated';

@Component({
  selector: 'lg-overview',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <header class="page-head">
      <h1>Vue d'ensemble</h1>
      <div class="range-tabs">
        @for (r of ranges; track r) {
          <button [class.active]="r === range()" (click)="setRange(r)">{{ r }}</button>
        }
      </div>
    </header>

    @if (stats(); as s) {
      <section class="kpi-grid">
        <mat-card><div class="kpi-label">Prompts</div><div class="kpi-value v-green">{{ s.total }}</div></mat-card>
        <mat-card><div class="kpi-label">Anonymisés</div><div class="kpi-value v-teal">{{ s.anonymized }}</div></mat-card>
        <mat-card><div class="kpi-label">Alertés</div><div class="kpi-value v-amber">{{ s.flagged }}</div></mat-card>
        <mat-card><div class="kpi-label">Bloqués</div><div class="kpi-value v-red">{{ s.blocked }}</div></mat-card>
      </section>

      <section class="split">
        <mat-card class="pane">
          <h2>Par LLM</h2>
          @for (row of llmRows(); track row.name) {
            <div class="row">
              <span class="row-name">{{ row.name }}</span>
              <div class="row-track"><div class="row-fill" [style.width.%]="row.pct"></div></div>
              <span class="row-count">{{ row.count }}</span>
            </div>
          } @empty {
            <p class="empty">Aucune donnée.</p>
          }
        </mat-card>

        <mat-card class="pane">
          <h2>Par type de PII</h2>
          @for (row of typeRows(); track row.name) {
            <div class="row">
              <span class="row-name">{{ row.name }}</span>
              <div class="row-track"><div class="row-fill warn" [style.width.%]="row.pct"></div></div>
              <span class="row-count">{{ row.count }}</span>
            </div>
          } @empty {
            <p class="empty">Aucune donnée.</p>
          }
        </mat-card>
      </section>
    } @else {
      <p class="empty">Chargement…</p>
    }
  `,
  styles: [
    `
      .page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .range-tabs { display: flex; gap: 4px; background: #14151a; padding: 3px; border-radius: 8px; }
      .range-tabs button { background: transparent; border: none; color: #888780; padding: 6px 12px; font-size: 12px; border-radius: 6px; cursor: pointer; }
      .range-tabs button.active { background: #0F6E56; color: #e1f5ee; }
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
      .kpi-label { font-size: 11px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; }
      .kpi-value { font-size: 28px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
      .v-green { color: #5DCAA5; } .v-teal { color: #5DCAA5; } .v-amber { color: #EF9F27; } .v-red { color: #E24B4A; }
      .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pane { padding: 18px; }
      .pane h2 { font-size: 13px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; margin-bottom: 10px; }
      .row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
      .row-name { width: 120px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row-track { flex: 1; height: 5px; background: #1e1f23; border-radius: 3px; overflow: hidden; }
      .row-fill { height: 100%; background: #0F6E56; transition: width 0.3s; }
      .row-fill.warn { background: #EF9F27; }
      .row-count { width: 40px; text-align: right; font-size: 11px; color: #888780; font-variant-numeric: tabular-nums; }
      .empty { color: #5f5e5a; font-size: 12px; }
    `,
  ],
})
export class OverviewComponent {
  private readonly api = inject(ApiService);

  protected readonly ranges: TimeRange[] = ['1h', '24h', '7d', '30d'];
  protected readonly range = signal<TimeRange>('24h');
  protected readonly stats = signal<StatsResponse | null>(null);

  protected readonly llmRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const max = Math.max(1, ...Object.values(s.by_llm));
    return Object.entries(s.by_llm)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: (count / max) * 100 }));
  });

  protected readonly typeRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const entries = Object.entries(s.by_type).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = Math.max(1, ...entries.map(([, c]) => c));
    return entries.map(([name, count]) => ({ name, count, pct: (count / max) * 100 }));
  });

  constructor() {
    this.refresh();
  }

  protected setRange(r: TimeRange): void {
    this.range.set(r);
    this.refresh();
  }

  private refresh(): void {
    this.api.stats(this.range()).subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null),
    });
  }
}
