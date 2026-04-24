import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  DoughnutController,
  Legend,
  LinearScale,
  PieController,
  Tooltip,
} from 'chart.js';

import { ApiService, TimeRange } from '../../core/api.service';
import { ComplianceService } from '../../core/compliance.service';
import { StatsResponse } from '../../core/schema.generated';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  PieController,
  Tooltip,
);

const LLM_COLORS: Record<string, string> = {
  ChatGPT: '#10a37f',
  Claude: '#C26A3B',
  Gemini: '#4285F4',
  Copilot: '#5DCAA5',
  Mistral: '#FF7000',
  Perplexity: '#20808D',
  DeepSeek: '#4D6BFE',
  Grok: '#888780',
  Unknown: '#5f5e5a',
};

const FALLBACK_PALETTE = ['#B58BE8', '#E8C07D', '#7DB8E8', '#E87DB8', '#85E8B8', '#E8857D'];

const ACTION_COLORS = {
  clean: '#5DCAA5',
  anonymized: '#85B7EB',
  flagged: '#EF9F27',
  blocked: '#E24B4A',
};

interface LlmSlice {
  name: string;
  count: number;
  pct: number;
  color: string;
}

@Component({
  selector: 'lg-stats',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <header class="page-head">
      <h1>Statistiques d'usage</h1>
      <div class="range-tabs">
        @for (r of ranges; track r) {
          <button [class.active]="r === range()" (click)="setRange(r)">{{ r }}</button>
        }
      </div>
    </header>

    @if (stats(); as s) {
      <section class="kpi-grid">
        <mat-card>
          <div class="kpi-label">Prompts totaux</div>
          <div class="kpi-value v-green">{{ s.total }}</div>
        </mat-card>
        <mat-card>
          <div class="kpi-label">LLM distincts</div>
          <div class="kpi-value v-teal">{{ distinctLlms() }}</div>
        </mat-card>
        <mat-card>
          <div class="kpi-label">Taux d'anonymisation</div>
          <div class="kpi-value v-teal">{{ anonRate() }}%</div>
        </mat-card>
        <mat-card>
          <div class="kpi-label">Taux de blocage</div>
          <div class="kpi-value v-red">{{ blockRate() }}%</div>
        </mat-card>
      </section>

      <section class="charts-grid">
        <mat-card class="pane pie-pane">
          <h2>Prompts par LLM</h2>
          @if (llmSlices().length > 0) {
            <div class="pie-wrap">
              <div class="canvas-box">
                <canvas #pieCanvas></canvas>
              </div>
              <ul class="legend">
                @for (slice of llmSlices(); track slice.name) {
                  <li>
                    <span class="dot" [style.background]="slice.color"></span>
                    <span class="leg-name">{{ slice.name }}</span>
                    <span class="leg-count">{{ slice.count }}</span>
                    <span class="leg-pct">{{ slice.pct }}%</span>
                  </li>
                }
              </ul>
            </div>
          } @else {
            <p class="empty">Aucune donnée LLM pour cette période.</p>
          }
        </mat-card>

        <mat-card class="pane">
          <h2>Répartition des actions</h2>
          @if (s.total > 0) {
            <div class="doughnut-wrap">
              <div class="canvas-box">
                <canvas #actionsCanvas></canvas>
                <div class="doughnut-center">
                  <div class="dc-num">{{ s.total }}</div>
                  <div class="dc-label">prompts</div>
                </div>
              </div>
              <ul class="legend">
                <li><span class="dot" [style.background]="actionColors.clean"></span><span class="leg-name">Propres</span><span class="leg-count">{{ s.clean }}</span><span class="leg-pct">{{ pct(s.clean, s.total) }}%</span></li>
                <li><span class="dot" [style.background]="actionColors.anonymized"></span><span class="leg-name">Anonymisés</span><span class="leg-count">{{ s.anonymized }}</span><span class="leg-pct">{{ pct(s.anonymized, s.total) }}%</span></li>
                <li><span class="dot" [style.background]="actionColors.flagged"></span><span class="leg-name">Alertés</span><span class="leg-count">{{ s.flagged }}</span><span class="leg-pct">{{ pct(s.flagged, s.total) }}%</span></li>
                <li><span class="dot" [style.background]="actionColors.blocked"></span><span class="leg-name">Bloqués</span><span class="leg-count">{{ s.blocked }}</span><span class="leg-pct">{{ pct(s.blocked, s.total) }}%</span></li>
              </ul>
            </div>
          } @else {
            <p class="empty">Aucune donnée pour cette période.</p>
          }
        </mat-card>
      </section>

      <mat-card class="pane">
        <h2>Top 10 types de PII détectés</h2>
        @if (typeEntries().length > 0) {
          <div class="bar-box">
            <canvas #typesCanvas></canvas>
          </div>
        } @else {
          <p class="empty">Aucune détection de PII pour cette période.</p>
        }
      </mat-card>
    } @else if (loaded() && !hasData()) {
      <mat-card class="empty-state">
        <mat-icon class="empty-icon">insights</mat-icon>
        <h2>Aucune télémétrie encore reçue</h2>
        <p>Le backend est opérationnel mais aucun événement n'a été ingéré pour cette période. Deux options&nbsp;:</p>
        <ol>
          <li>Activez l'extension&nbsp;: <code>chrome-extension://…/options.html</code> → cochez <em>Enabled</em>, backend <code>http://localhost</code>, org <code>default</code>.</li>
          <li>Chargez des données de démonstration&nbsp;: <code>bash infra/seed-demo.sh</code>.</li>
        </ol>
      </mat-card>
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
      .v-green { color: #5DCAA5; } .v-teal { color: #85B7EB; } .v-amber { color: #EF9F27; } .v-red { color: #E24B4A; }

      .charts-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; margin-bottom: 12px; }
      @media (max-width: 1100px) { .charts-grid { grid-template-columns: 1fr; } }

      .pane { padding: 18px; }
      .pane h2 { font-size: 13px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; margin: 0 0 14px; }

      .pie-wrap, .doughnut-wrap { display: grid; grid-template-columns: minmax(180px, 240px) 1fr; gap: 20px; align-items: center; }
      @media (max-width: 640px) { .pie-wrap, .doughnut-wrap { grid-template-columns: 1fr; } }

      .canvas-box { position: relative; aspect-ratio: 1 / 1; min-height: 200px; }
      .canvas-box canvas { width: 100% !important; height: 100% !important; }

      .doughnut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
      .dc-num { font-size: 26px; font-weight: 700; color: #e1f5ee; font-variant-numeric: tabular-nums; }
      .dc-label { font-size: 10px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; }

      .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .legend li { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 10px; align-items: center; font-size: 12px; padding: 2px 0; }
      .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
      .leg-name { color: #d1d0c7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .leg-count { color: #888780; font-variant-numeric: tabular-nums; }
      .leg-pct { color: #5DCAA5; font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; }

      .bar-box { position: relative; height: 320px; }
      .bar-box canvas { width: 100% !important; height: 100% !important; }

      .empty { color: #5f5e5a; font-size: 12px; }
      .empty-state { padding: 32px; text-align: center; border: 1px dashed #1e1f23; }
      .empty-state .empty-icon { font-size: 48px; width: 48px; height: 48px; color: #0F6E56; margin-bottom: 12px; }
      .empty-state h2 { color: #e1f5ee; font-size: 16px; margin: 0 0 8px; }
      .empty-state p { color: #888780; font-size: 13px; margin: 4px auto 12px; max-width: 560px; }
      .empty-state ol { color: #d1d0c7; font-size: 12px; text-align: left; max-width: 560px; margin: 0 auto; padding-left: 20px; }
      .empty-state li { margin: 4px 0; }
      .empty-state code { background: #14151a; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 11px; }
      .empty-state em { color: #5DCAA5; font-style: normal; }
    `,
  ],
})
export class StatsComponent implements AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly compliance = inject(ComplianceService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ranges: TimeRange[] = ['1h', '24h', '7d', '30d'];
  protected readonly range = signal<TimeRange>('24h');
  protected readonly stats = signal<StatsResponse | null>(null);
  protected readonly loaded = this.compliance.loaded;
  protected readonly hasData = this.compliance.hasData;
  protected readonly actionColors = ACTION_COLORS;

  @ViewChild('pieCanvas') private pieCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('actionsCanvas') private actionsCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('typesCanvas') private typesCanvas?: ElementRef<HTMLCanvasElement>;

  private pieChart: Chart | null = null;
  private actionsChart: Chart | null = null;
  private typesChart: Chart | null = null;
  private viewReady = false;

  protected readonly llmSlices = computed<LlmSlice[]>(() => {
    const s = this.stats();
    if (!s) return [];
    const entries = Object.entries(s.by_llm).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, c]) => sum + c, 0);
    if (total === 0) return [];
    let fallbackIdx = 0;
    return entries.map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / total) * 1000) / 10,
      color: LLM_COLORS[name] ?? FALLBACK_PALETTE[fallbackIdx++ % FALLBACK_PALETTE.length],
    }));
  });

  protected readonly typeEntries = computed<[string, number][]>(() => {
    const s = this.stats();
    if (!s) return [];
    return Object.entries(s.by_type).sort((a, b) => b[1] - a[1]).slice(0, 10);
  });

  protected readonly distinctLlms = computed(() => Object.keys(this.stats()?.by_llm ?? {}).length);

  protected readonly anonRate = computed(() => {
    const s = this.stats();
    return s && s.total > 0 ? Math.round((s.anonymized / s.total) * 100) : 0;
  });

  protected readonly blockRate = computed(() => {
    const s = this.stats();
    return s && s.total > 0 ? Math.round((s.blocked / s.total) * 100) : 0;
  });

  constructor() {
    effect(() => {
      const slices = this.llmSlices();
      const types = this.typeEntries();
      const s = this.stats();
      if (!this.isBrowser || !this.viewReady) return;
      queueMicrotask(() => {
        this.renderPie(slices);
        this.renderActions(s);
        this.renderTypes(types);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.pieChart?.destroy();
      this.actionsChart?.destroy();
      this.typesChart?.destroy();
    });

    this.refresh();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderPie(this.llmSlices());
    this.renderActions(this.stats());
    this.renderTypes(this.typeEntries());
  }

  protected setRange(r: TimeRange): void {
    this.range.set(r);
    this.refresh();
  }

  protected pct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
  }

  private refresh(): void {
    this.compliance
      .loadStats(this.range())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.stats.set(s),
        error: () => this.stats.set(null),
      });
  }

  private renderPie(slices: LlmSlice[]): void {
    const canvas = this.pieCanvas?.nativeElement;
    if (!canvas || slices.length === 0) {
      this.pieChart?.destroy();
      this.pieChart = null;
      return;
    }
    const config: ChartConfiguration<'pie'> = {
      type: 'pie',
      data: {
        labels: slices.map((s) => s.name),
        datasets: [
          {
            data: slices.map((s) => s.count),
            backgroundColor: slices.map((s) => s.color),
            borderColor: '#0e0f11',
            borderWidth: 2,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const name = ctx.label ?? '';
                const count = typeof ctx.parsed === 'number' ? ctx.parsed : 0;
                const slice = slices.find((s) => s.name === name);
                const pct = slice ? slice.pct : 0;
                return `${name}: ${count} (${pct}%)`;
              },
            },
          },
        },
      },
    };
    if (this.pieChart) {
      this.pieChart.data = config.data;
      this.pieChart.options = config.options ?? {};
      this.pieChart.update();
    } else {
      this.pieChart = new Chart(canvas, config);
    }
  }

  private renderActions(s: StatsResponse | null): void {
    const canvas = this.actionsCanvas?.nativeElement;
    if (!canvas || !s || s.total === 0) {
      this.actionsChart?.destroy();
      this.actionsChart = null;
      return;
    }
    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: ['Propres', 'Anonymisés', 'Alertés', 'Bloqués'],
        datasets: [
          {
            data: [s.clean, s.anonymized, s.flagged, s.blocked],
            backgroundColor: [
              ACTION_COLORS.clean,
              ACTION_COLORS.anonymized,
              ACTION_COLORS.flagged,
              ACTION_COLORS.blocked,
            ],
            borderColor: '#0e0f11',
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.label ?? '';
                const count = typeof ctx.parsed === 'number' ? ctx.parsed : 0;
                const pct = s.total > 0 ? Math.round((count / s.total) * 1000) / 10 : 0;
                return `${label}: ${count} (${pct}%)`;
              },
            },
          },
        },
      },
    };
    if (this.actionsChart) {
      this.actionsChart.data = config.data;
      this.actionsChart.options = config.options ?? {};
      this.actionsChart.update();
    } else {
      this.actionsChart = new Chart(canvas, config);
    }
  }

  private renderTypes(entries: [string, number][]): void {
    const canvas = this.typesCanvas?.nativeElement;
    if (!canvas || entries.length === 0) {
      this.typesChart?.destroy();
      this.typesChart = null;
      return;
    }
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: entries.map(([name]) => name),
        datasets: [
          {
            data: entries.map(([, c]) => c),
            backgroundColor: '#EF9F27',
            borderRadius: 4,
            barThickness: 'flex',
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x} détections`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#888780' },
            grid: { color: '#1e1f23' },
          },
          y: {
            ticks: { color: '#d1d0c7' },
            grid: { display: false },
          },
        },
      },
    };
    if (this.typesChart) {
      this.typesChart.data = config.data;
      this.typesChart.options = config.options ?? {};
      this.typesChart.update();
    } else {
      this.typesChart = new Chart(canvas, config);
    }
  }
}
