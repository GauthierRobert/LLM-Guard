import { Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ApiService, TimeRange } from '../../core/api.service';
import { StatsResponse } from '../../core/schema.generated';
import { ComplianceService } from '../../core/compliance.service';

@Component({
  selector: 'lg-overview',
  standalone: true,
  imports: [MatCardModule, MatIconModule, RouterLink],
  template: `
    <header class="page-head">
      <h1>Vue d'ensemble</h1>
      <div class="range-tabs">
        @for (r of ranges; track r) {
          <button [class.active]="r === range()" (click)="setRange(r)">{{ r }}</button>
        }
      </div>
    </header>

    <!-- Feature 5 : 72 h breach countdown (GDPR Art. 33) -->
    @if (breach().active) {
      <div class="breach" role="alert">
        <div class="breach-icon">
          <mat-icon>warning</mat-icon>
        </div>
        <div class="breach-body">
          <div class="breach-head">
            <span class="breach-badge">Art. 33 RGPD · notification 72 h</span>
            <a routerLink="/compliance" class="breach-link">Voir article ↗</a>
          </div>
          <div class="breach-title">Violation potentielle détectée — délai de notification en cours</div>
          <div class="breach-reason">{{ breach().triggerReason }}</div>
        </div>
        <div class="breach-timer">
          <div class="t-cell"><div class="t-num">{{ breachParts().h }}</div><div class="t-unit">h</div></div>
          <div class="t-sep">:</div>
          <div class="t-cell"><div class="t-num">{{ breachParts().m }}</div><div class="t-unit">min</div></div>
          <div class="t-sep">:</div>
          <div class="t-cell"><div class="t-num">{{ breachParts().s }}</div><div class="t-unit">sec</div></div>
        </div>
      </div>
    }

    <!-- Feature 3 : Prohibited-practice banner (AI Act Art. 5) -->
    @if (prohibited().length > 0) {
      <div class="prohibited" role="alert">
        <mat-icon class="proh-icon">block</mat-icon>
        <div class="proh-body">
          <div class="proh-head">
            <span class="proh-badge">IA Act Art. 5 · pratiques interdites</span>
          </div>
          <div class="proh-title">{{ prohibited().length }} signal(aux) de pratique interdite détecté(s)</div>
          <ul class="proh-list">
            @for (p of prohibited(); track p.type) {
              <li><span class="mono">{{ p.type }}</span> — {{ p.reason }} <span class="count">({{ p.count }})</span></li>
            }
          </ul>
        </div>
        <a routerLink="/compliance" class="proh-cta">Ouvrir l'article →</a>
      </div>
    }

    @if (stats(); as s) {
      <!-- Feature 10 : Compliance score headline KPI -->
      <mat-card class="score-card">
        <div class="score-gauge">
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1e1f23" stroke-width="10" />
            <circle cx="60" cy="60" r="50" fill="none" [attr.stroke]="scoreColor()" stroke-width="10"
                    stroke-linecap="round"
                    [attr.stroke-dasharray]="314.16"
                    [attr.stroke-dashoffset]="314.16 - (314.16 * score().score / 100)"
                    transform="rotate(-90 60 60)" />
            <text x="60" y="56" text-anchor="middle" [attr.fill]="scoreColor()" font-size="28" font-weight="700">{{ score().score }}</text>
            <text x="60" y="78" text-anchor="middle" fill="#888780" font-size="11">/ 100</text>
          </svg>
          <div class="grade" [style.background]="scoreColor()">{{ score().grade }}</div>
        </div>
        <div class="score-body">
          <div class="score-title">Score de conformité unifié</div>
          <div class="score-sub">Pondération RGPD + IA Act, recalculé en temps réel.</div>
          <div class="score-breakdown">
            @for (d of score().details; track d.label) {
              <div class="brk-row">
                <div class="brk-head">
                  <span class="brk-label">{{ d.label }}</span>
                  <span class="brk-val">{{ d.value }}/{{ d.weight }}</span>
                </div>
                <div class="brk-track">
                  <div class="brk-fill" [style.width.%]="(d.value / d.weight) * 100" [style.background]="scoreColor()"></div>
                </div>
                <div class="brk-note">{{ d.note }}</div>
              </div>
            }
          </div>
        </div>
        <div class="score-links">
          <a routerLink="/compliance" class="score-link"><mat-icon>gavel</mat-icon> Explorateur d'articles</a>
          <a routerLink="/dpia" class="score-link"><mat-icon>description</mat-icon> Générer AIPD / RoPA</a>
          <a routerLink="/risk-tiers" class="score-link"><mat-icon>smart_toy</mat-icon> Niveaux IA Act</a>
          <a routerLink="/transfers" class="score-link"><mat-icon>public</mat-icon> Transferts hors UE</a>
        </div>
      </mat-card>

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

      /* Breach banner */
      .breach { display: flex; gap: 16px; align-items: stretch; background: linear-gradient(90deg, #3a0e0e, #501313); border: 1px solid #7a2b2b; border-radius: 10px; padding: 14px 18px; margin-bottom: 14px; animation: breach-pulse 2.4s ease-in-out infinite; }
      @keyframes breach-pulse { 0%, 100% { box-shadow: 0 0 0 rgba(226, 75, 74, 0); } 50% { box-shadow: 0 0 24px rgba(226, 75, 74, 0.35); } }
      .breach-icon { display: flex; align-items: center; color: #F09595; }
      .breach-icon mat-icon { font-size: 32px; width: 32px; height: 32px; }
      .breach-body { flex: 1; }
      .breach-head { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; }
      .breach-badge { background: rgba(14, 15, 17, 0.45); color: #F09595; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
      .breach-link { color: #F4D4D4; font-size: 11px; text-decoration: none; }
      .breach-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
      .breach-reason { font-size: 12px; color: #f4d4d4; opacity: 0.85; }
      .breach-timer { display: flex; gap: 4px; align-items: center; }
      .t-cell { background: rgba(14, 15, 17, 0.5); border-radius: 6px; padding: 8px 12px; min-width: 56px; text-align: center; }
      .t-num { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 700; color: #fff; line-height: 1; font-variant-numeric: tabular-nums; }
      .t-unit { font-size: 9px; text-transform: uppercase; color: #F09595; letter-spacing: 0.6px; margin-top: 2px; }
      .t-sep { color: #F09595; font-size: 18px; font-weight: 700; }

      /* Prohibited banner */
      .prohibited { display: flex; gap: 14px; align-items: flex-start; background: rgba(65, 36, 2, 0.4); border: 1px solid #5a3302; border-radius: 10px; padding: 14px 18px; margin-bottom: 14px; }
      .proh-icon { color: #FAC775; font-size: 24px; width: 24px; height: 24px; flex-shrink: 0; margin-top: 2px; }
      .proh-body { flex: 1; }
      .proh-head { margin-bottom: 4px; }
      .proh-badge { background: rgba(14, 15, 17, 0.45); color: #FAC775; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
      .proh-title { font-size: 13px; font-weight: 600; color: #FAC775; margin-bottom: 6px; }
      .proh-list { list-style: none; padding: 0; margin: 0; font-size: 12px; color: #d1d0c7; }
      .proh-list li { padding: 2px 0; }
      .proh-list .mono { font-family: ui-monospace, monospace; color: #FAC775; }
      .proh-list .count { color: #888780; }
      .proh-cta { color: #FAC775; font-size: 12px; text-decoration: none; align-self: center; white-space: nowrap; }

      /* Score card */
      .score-card { display: grid; grid-template-columns: 180px 1fr 220px; gap: 20px; padding: 20px; margin-bottom: 14px; align-items: center; }
      @media (max-width: 1100px) { .score-card { grid-template-columns: 180px 1fr; } .score-links { grid-column: 1 / -1; flex-direction: row !important; flex-wrap: wrap; } }
      .score-gauge { position: relative; }
      .gauge-svg { width: 150px; height: 150px; }
      .grade { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #0e0f11; }
      .score-title { font-size: 18px; font-weight: 600; color: #e1f5ee; }
      .score-sub { font-size: 12px; color: #888780; margin-bottom: 14px; }
      .score-breakdown { display: flex; flex-direction: column; gap: 10px; }
      .brk-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
      .brk-label { color: #d1d0c7; }
      .brk-val { color: #888780; font-variant-numeric: tabular-nums; }
      .brk-track { height: 4px; background: #1e1f23; border-radius: 2px; overflow: hidden; }
      .brk-fill { height: 100%; transition: width 0.4s; }
      .brk-note { font-size: 11px; color: #5f5e5a; margin-top: 3px; }
      .score-links { display: flex; flex-direction: column; gap: 8px; }
      .score-link { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #14151a; border: 1px solid #1e1f23; border-radius: 6px; color: #d1d0c7; text-decoration: none; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
      .score-link:hover { background: rgba(15, 110, 86, 0.12); border-color: #0F6E56; color: #5DCAA5; }
      .score-link mat-icon { font-size: 16px; width: 16px; height: 16px; }

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
  private readonly compliance = inject(ComplianceService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ranges: TimeRange[] = ['1h', '24h', '7d', '30d'];
  protected readonly range = signal<TimeRange>('24h');
  protected readonly stats = signal<StatsResponse | null>(null);
  private readonly tick = signal(0);

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

  protected readonly score = computed(() => this.compliance.computeScore());

  protected readonly scoreColor = computed(() => {
    const g = this.score().grade;
    return g === 'A' ? '#5DCAA5' : g === 'B' ? '#85B7EB' : g === 'C' ? '#EF9F27' : '#E24B4A';
  });

  protected readonly prohibited = computed(() => this.compliance.prohibitedAlerts());

  protected readonly breach = computed(() => {
    this.tick();
    return this.compliance.breachStatus();
  });

  protected readonly breachParts = computed(() => {
    const ms = this.breach().remainingMs;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return { h: h.toString().padStart(2, '0'), m: m.toString().padStart(2, '0'), s: s.toString().padStart(2, '0') };
  });

  constructor() {
    this.refresh();
    if (this.isBrowser) {
      const id = setInterval(() => this.tick.update((v) => v + 1), 1000);
      this.destroyRef.onDestroy(() => clearInterval(id));
    }
  }

  protected setRange(r: TimeRange): void {
    this.range.set(r);
    this.refresh();
  }

  private refresh(): void {
    this.compliance.loadStats(this.range()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null),
    });
  }
}
