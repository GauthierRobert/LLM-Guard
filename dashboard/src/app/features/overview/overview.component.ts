import { Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ApiService, TimeRange } from '../../core/api.service';
import { StatsResponse } from '../../core/schema.generated';
import { ComplianceService } from '../../core/compliance.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-overview',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="flex justify-between items-center mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Vue d'ensemble</h1>
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

    <!-- Feature 5 : 72 h breach countdown (GDPR Art. 33) -->
    @if (breach().active) {
      <div role="alert"
           class="flex gap-4 items-stretch bg-gradient-to-r from-danger-900 to-danger-800 border border-danger-700 rounded-xl px-5 py-3.5 mb-3.5 animate-breach-pulse">
        <div class="flex items-center text-danger-300">
          <lg-icon name="warning" [size]="32"/>
        </div>
        <div class="flex-1">
          <div class="flex gap-2.5 items-center mb-1">
            <span class="bg-black/45 text-danger-300 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold">
              Art. 33 RGPD · notification 72 h
            </span>
            <a routerLink="/compliance" class="text-danger-100 text-[11px] hover:underline">Voir article ↗</a>
          </div>
          <div class="text-[14px] font-semibold text-white mb-0.5">Violation potentielle détectée — délai de notification en cours</div>
          <div class="text-[12px] text-danger-100/85">{{ breach().triggerReason }}</div>
        </div>
        <div class="flex gap-1 items-center">
          <div class="bg-black/50 rounded-md px-3 py-2 min-w-[56px] text-center">
            <div class="font-mono text-[22px] font-bold text-white leading-none tabular-nums">{{ breachParts().h }}</div>
            <div class="text-[9px] uppercase text-danger-300 tracking-wide mt-0.5">h</div>
          </div>
          <div class="text-danger-300 text-[18px] font-bold">:</div>
          <div class="bg-black/50 rounded-md px-3 py-2 min-w-[56px] text-center">
            <div class="font-mono text-[22px] font-bold text-white leading-none tabular-nums">{{ breachParts().m }}</div>
            <div class="text-[9px] uppercase text-danger-300 tracking-wide mt-0.5">min</div>
          </div>
          <div class="text-danger-300 text-[18px] font-bold">:</div>
          <div class="bg-black/50 rounded-md px-3 py-2 min-w-[56px] text-center">
            <div class="font-mono text-[22px] font-bold text-white leading-none tabular-nums">{{ breachParts().s }}</div>
            <div class="text-[9px] uppercase text-danger-300 tracking-wide mt-0.5">sec</div>
          </div>
        </div>
      </div>
    }

    <!-- Feature 3 : Prohibited-practice banner (AI Act Art. 5) -->
    @if (prohibited().length > 0) {
      <div role="alert"
           class="flex gap-3.5 items-start bg-warn-900/40 border border-warn-700 rounded-xl px-5 py-3.5 mb-3.5">
        <lg-icon name="block" [size]="24" class="text-warn-300 shrink-0 mt-0.5"/>
        <div class="flex-1">
          <div class="mb-1">
            <span class="bg-black/45 text-warn-300 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold">
              IA Act Art. 5 · pratiques interdites
            </span>
          </div>
          <div class="text-[13px] font-semibold text-warn-300 mb-1.5">
            {{ prohibited().length }} signal(aux) de pratique interdite détecté(s)
          </div>
          <ul class="space-y-0.5 text-[12px] text-ink-100">
            @for (p of prohibited(); track p.type) {
              <li><span class="font-mono text-warn-300">{{ p.type }}</span> — {{ p.reason }} <span class="text-ink-300">({{ p.count }})</span></li>
            }
          </ul>
        </div>
        <a routerLink="/compliance" class="text-warn-300 text-[12px] self-center whitespace-nowrap hover:underline">Ouvrir l'article →</a>
      </div>
    }

    @if (stats(); as s) {
      <!-- Feature 10 : Compliance score headline KPI -->
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-5 mb-3.5 grid gap-5 items-center"
           style="grid-template-columns: 180px 1fr 220px;">
        <div class="relative">
          <svg viewBox="0 0 120 120" class="w-[150px] h-[150px]">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1e1f23" stroke-width="10"/>
            <circle cx="60" cy="60" r="50" fill="none" [attr.stroke]="scoreColor()" stroke-width="10"
                    stroke-linecap="round"
                    [attr.stroke-dasharray]="314.16"
                    [attr.stroke-dashoffset]="314.16 - (314.16 * score().score / 100)"
                    transform="rotate(-90 60 60)"/>
            <text x="60" y="56" text-anchor="middle" [attr.fill]="scoreColor()" font-size="28" font-weight="700">{{ score().score }}</text>
            <text x="60" y="78" text-anchor="middle" fill="#888780" font-size="11">/ 100</text>
          </svg>
          <div class="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center font-bold text-[14px] text-ink-900"
               [style.background]="scoreColor()">{{ score().grade }}</div>
        </div>
        <div>
          <div class="text-[18px] font-semibold text-ink-50">Score de conformité unifié</div>
          <div class="text-[12px] text-ink-300 mb-3.5">Pondération RGPD + IA Act, recalculé en temps réel.</div>
          <div class="flex flex-col gap-2.5">
            @for (d of score().details; track d.label) {
              <div>
                <div class="flex justify-between text-[12px] mb-1">
                  <span class="text-ink-100">{{ d.label }}</span>
                  <span class="text-ink-300 tabular-nums">{{ d.value }}/{{ d.weight }}</span>
                </div>
                <div class="h-1 bg-ink-700 rounded overflow-hidden">
                  <div class="h-full transition-[width] duration-500"
                       [style.width.%]="(d.value / d.weight) * 100"
                       [style.background]="scoreColor()"></div>
                </div>
                <div class="text-[11px] text-ink-500 mt-0.5">{{ d.note }}</div>
              </div>
            }
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <a routerLink="/compliance" class="inline-flex items-center gap-2 px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-ink-100 text-[12px] hover:bg-brand-700/10 hover:border-brand-700 hover:text-brand-500 transition-colors">
            <lg-icon name="gavel" [size]="14"/> Explorateur d'articles
          </a>
          <a routerLink="/dpia" class="inline-flex items-center gap-2 px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-ink-100 text-[12px] hover:bg-brand-700/10 hover:border-brand-700 hover:text-brand-500 transition-colors">
            <lg-icon name="description" [size]="14"/> Générer AIPD / RoPA
          </a>
          <a routerLink="/risk-tiers" class="inline-flex items-center gap-2 px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-ink-100 text-[12px] hover:bg-brand-700/10 hover:border-brand-700 hover:text-brand-500 transition-colors">
            <lg-icon name="smart_toy" [size]="14"/> Niveaux IA Act
          </a>
          <a routerLink="/transfers" class="inline-flex items-center gap-2 px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-ink-100 text-[12px] hover:bg-brand-700/10 hover:border-brand-700 hover:text-brand-500 transition-colors">
            <lg-icon name="public" [size]="14"/> Transferts hors UE
          </a>
        </div>
      </div>

      <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Prompts</div>
          <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ s.total }}</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Anonymisés</div>
          <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ s.anonymized }}</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Alertés</div>
          <div class="text-[28px] font-bold text-warn-500 tabular-nums mt-1">{{ s.flagged }}</div>
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
          <div class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">Bloqués</div>
          <div class="text-[28px] font-bold text-danger-500 tabular-nums mt-1">{{ s.blocked }}</div>
        </div>
      </section>

      <section class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
          <h2 class="text-[13px] uppercase tracking-wide text-ink-300 font-semibold mb-2.5">Par LLM</h2>
          @for (row of llmRows(); track row.name) {
            <div class="flex items-center gap-2.5 py-1">
              <span class="w-[120px] text-[12px] truncate">{{ row.name }}</span>
              <div class="flex-1 h-[5px] bg-ink-700 rounded-sm overflow-hidden">
                <div class="h-full bg-brand-700 transition-[width] duration-300" [style.width.%]="row.pct"></div>
              </div>
              <span class="w-10 text-right text-[11px] text-ink-300 tabular-nums">{{ row.count }}</span>
            </div>
          } @empty {
            <p class="text-ink-500 text-[12px]">Aucune donnée.</p>
          }
        </div>
        <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
          <h2 class="text-[13px] uppercase tracking-wide text-ink-300 font-semibold mb-2.5">Par type de PII</h2>
          @for (row of typeRows(); track row.name) {
            <div class="flex items-center gap-2.5 py-1">
              <span class="w-[120px] text-[12px] truncate">{{ row.name }}</span>
              <div class="flex-1 h-[5px] bg-ink-700 rounded-sm overflow-hidden">
                <div class="h-full bg-warn-500 transition-[width] duration-300" [style.width.%]="row.pct"></div>
              </div>
              <span class="w-10 text-right text-[11px] text-ink-300 tabular-nums">{{ row.count }}</span>
            </div>
          } @empty {
            <p class="text-ink-500 text-[12px]">Aucune donnée.</p>
          }
        </div>
      </section>
    } @else if (loaded() && !hasData()) {
      <div class="bg-ink-800 border border-dashed border-ink-700 rounded-xl p-8 text-center">
        <lg-icon name="shield" [size]="48" class="text-brand-700 mx-auto mb-3"/>
        <h2 class="text-ink-50 text-[16px] font-semibold mb-2">Aucune télémétrie encore reçue</h2>
        <p class="text-ink-300 text-[13px] mx-auto max-w-[560px] mb-3">
          Le backend est opérationnel mais aucun événement n'a été ingéré pour cette période. Configurez l'extension pour envoyer vos données réelles&nbsp;:
        </p>
        <ol class="text-ink-100 text-[12px] text-left mx-auto max-w-[560px] list-decimal pl-5 space-y-1">
          <li>Ouvrez la page options&nbsp;:
            <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">chrome-extension://…/options.html</code>.</li>
          <li>Cochez <em class="not-italic text-brand-500">Activer l'envoi des métadonnées</em>, puis saisissez&nbsp;:
            <ul class="list-disc pl-5 mt-1 space-y-0.5 text-ink-300">
              <li>Backend <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">https://localhost</code></li>
              <li>Org <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">default</code></li>
              <li>Jeton appareil fourni par l'administrateur</li>
            </ul>
          </li>
          <li>Approuvez l'autorité racine <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">infra/certs/llm-guard-ca.crt</code> côté navigateur (sinon la connexion HTTPS est refusée).</li>
        </ol>
      </div>
    } @else {
      <p class="text-ink-500 text-[12px]">Chargement…</p>
    }
  `,
  styles: [`
    @keyframes breach-pulse {
      0%, 100% { box-shadow: 0 0 0 rgba(226, 75, 74, 0); }
      50%      { box-shadow: 0 0 24px rgba(226, 75, 74, 0.35); }
    }
    .animate-breach-pulse { animation: breach-pulse 2.4s ease-in-out infinite; }

    @media (max-width: 1100px) {
      :host section.grid[style*="180px 1fr 220px"] {
        grid-template-columns: 180px 1fr !important;
      }
    }
  `],
})
export class OverviewComponent {
  private readonly api = inject(ApiService);
  private readonly compliance = inject(ComplianceService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ranges: TimeRange[] = ['1h', '24h', '7d', '30d'];
  protected readonly range = signal<TimeRange>('24h');
  protected readonly stats = signal<StatsResponse | null>(null);
  protected readonly loaded = this.compliance.loaded;
  protected readonly hasData = this.compliance.hasData;
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
    this.compliance.loadRecentEvents(200).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
