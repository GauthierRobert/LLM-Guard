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
import { IconComponent } from '../../shared/icon.component';

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
  imports: [IconComponent],
  template: `
    <header class="flex justify-between items-center mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Statistiques d'usage</h1>
      <div class="inline-flex gap-1 bg-ink-800 border border-ink-700 p-[3px] rounded-lg">
        @for (r of ranges; track r) {
          <button type="button" (click)="setRange(r)"
                  class="px-3 py-1.5 rounded-md text-[12px] transition-colors"
                  [class]="r === range() ? 'bg-brand-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'">
            {{ r }}
          </button>
        }
      </div>
    </header>

    @if (stats(); as s) {
      <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Prompts totaux</div>
          <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ s.total }}</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">LLM distincts</div>
          <div class="text-[28px] font-bold text-info-500 tabular-nums mt-1">{{ distinctLlms() }}</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Taux d'anonymisation</div>
          <div class="text-[28px] font-bold text-info-500 tabular-nums mt-1">{{ anonRate() }}%</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Taux de blocage</div>
          <div class="text-[28px] font-bold text-danger-500 tabular-nums mt-1">{{ blockRate() }}%</div>
        </div>
      </section>

      <section class="grid grid-cols-1 min-[1100px]:grid-cols-[1.3fr_1fr] gap-3 mb-3">
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
          <h2 class="text-[13px] uppercase tracking-wide text-ink-300 font-semibold mb-3.5">Prompts par LLM</h2>
          @if (llmSlices().length > 0) {
            <div class="grid grid-cols-1 sm:grid-cols-[minmax(180px,240px)_1fr] gap-5 items-center">
              <div class="relative aspect-square min-h-[200px] [&>canvas]:!w-full [&>canvas]:!h-full">
                <canvas #pieCanvas></canvas>
              </div>
              <ul class="list-none m-0 p-0 flex flex-col gap-1.5">
                @for (slice of llmSlices(); track slice.name) {
                  <li class="grid grid-cols-[12px_1fr_auto_auto] gap-2.5 items-center text-[12px] py-0.5">
                    <span class="w-2.5 h-2.5 rounded-full inline-block" [style.background]="slice.color"></span>
                    <span class="text-ink-100 whitespace-nowrap overflow-hidden text-ellipsis">{{ slice.name }}</span>
                    <span class="text-ink-300 tabular-nums">{{ slice.count }}</span>
                    <span class="text-brand-500 tabular-nums min-w-[44px] text-right">{{ slice.pct }}%</span>
                  </li>
                }
              </ul>
            </div>
          } @else {
            <p class="text-ink-500 text-[12px]">Aucune donnée LLM pour cette période.</p>
          }
        </div>

        <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
          <h2 class="text-[13px] uppercase tracking-wide text-ink-300 font-semibold mb-3.5">Répartition des actions</h2>
          @if (s.total > 0) {
            <div class="grid grid-cols-1 sm:grid-cols-[minmax(180px,240px)_1fr] gap-5 items-center">
              <div class="relative aspect-square min-h-[200px] [&>canvas]:!w-full [&>canvas]:!h-full">
                <canvas #actionsCanvas></canvas>
                <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div class="text-[26px] font-bold text-ink-50 tabular-nums">{{ s.total }}</div>
                  <div class="text-[10px] uppercase text-ink-300 tracking-wide">prompts</div>
                </div>
              </div>
              <ul class="list-none m-0 p-0 flex flex-col gap-1.5">
                <li class="grid grid-cols-[12px_1fr_auto_auto] gap-2.5 items-center text-[12px] py-0.5">
                  <span class="w-2.5 h-2.5 rounded-full inline-block" [style.background]="actionColors.clean"></span>
                  <span class="text-ink-100">Propres</span>
                  <span class="text-ink-300 tabular-nums">{{ s.clean }}</span>
                  <span class="text-brand-500 tabular-nums min-w-[44px] text-right">{{ pct(s.clean, s.total) }}%</span>
                </li>
                <li class="grid grid-cols-[12px_1fr_auto_auto] gap-2.5 items-center text-[12px] py-0.5">
                  <span class="w-2.5 h-2.5 rounded-full inline-block" [style.background]="actionColors.anonymized"></span>
                  <span class="text-ink-100">Anonymisés</span>
                  <span class="text-ink-300 tabular-nums">{{ s.anonymized }}</span>
                  <span class="text-brand-500 tabular-nums min-w-[44px] text-right">{{ pct(s.anonymized, s.total) }}%</span>
                </li>
                <li class="grid grid-cols-[12px_1fr_auto_auto] gap-2.5 items-center text-[12px] py-0.5">
                  <span class="w-2.5 h-2.5 rounded-full inline-block" [style.background]="actionColors.flagged"></span>
                  <span class="text-ink-100">Alertés</span>
                  <span class="text-ink-300 tabular-nums">{{ s.flagged }}</span>
                  <span class="text-brand-500 tabular-nums min-w-[44px] text-right">{{ pct(s.flagged, s.total) }}%</span>
                </li>
                <li class="grid grid-cols-[12px_1fr_auto_auto] gap-2.5 items-center text-[12px] py-0.5">
                  <span class="w-2.5 h-2.5 rounded-full inline-block" [style.background]="actionColors.blocked"></span>
                  <span class="text-ink-100">Bloqués</span>
                  <span class="text-ink-300 tabular-nums">{{ s.blocked }}</span>
                  <span class="text-brand-500 tabular-nums min-w-[44px] text-right">{{ pct(s.blocked, s.total) }}%</span>
                </li>
              </ul>
            </div>
          } @else {
            <p class="text-ink-500 text-[12px]">Aucune donnée pour cette période.</p>
          }
        </div>
      </section>

      <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
        <h2 class="text-[13px] uppercase tracking-wide text-ink-300 font-semibold mb-3.5">Top 10 types de PII détectés</h2>
        @if (typeEntries().length > 0) {
          <div class="relative h-80 [&>canvas]:!w-full [&>canvas]:!h-full">
            <canvas #typesCanvas></canvas>
          </div>
        } @else {
          <p class="text-ink-500 text-[12px]">Aucune détection de PII pour cette période.</p>
        }
      </div>
    } @else if (loaded() && !hasData()) {
      <div class="bg-ink-800 border border-dashed border-ink-700 rounded-xl p-8 text-center">
        <lg-icon name="table_chart" [size]="48" class="text-brand-700 mx-auto mb-3"/>
        <h2 class="text-ink-50 text-[16px] font-semibold mb-2">Aucune télémétrie encore reçue</h2>
        <p class="text-ink-300 text-[13px] mx-auto max-w-[560px] mb-3">
          Le backend est opérationnel mais aucun événement n'a été ingéré pour cette période. Deux options&nbsp;:
        </p>
        <ol class="text-ink-100 text-[12px] text-left mx-auto max-w-[560px] list-decimal pl-5 space-y-1">
          <li>Activez l'extension&nbsp;:
            <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">chrome-extension://…/options.html</code>
            → cochez <em class="not-italic text-brand-500">Enabled</em>, backend
            <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">http://localhost</code>, org
            <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">default</code>.
          </li>
          <li>Chargez des données de démonstration&nbsp;:
            <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">bash infra/seed-demo.sh</code>.
          </li>
        </ol>
      </div>
    } @else {
      <p class="text-ink-500 text-[12px]">Chargement…</p>
    }
  `,
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
