import { Component, computed, inject } from '@angular/core';

import { ComplianceService } from '../../core/compliance.service';
import { RISK_TIERS, RiskTier } from '../../core/compliance.data';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-risk-tiers',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Classification par niveau de risque IA</h1>
      <p class="text-ink-300 text-[13px] mt-1 max-w-[720px]">
        Chaque service LLM positionné sur les quatre niveaux de l'EU AI Act, croisé avec votre trafic réel.
      </p>
    </header>

    <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
      @for (tier of tierOrder; track tier) {
        <div class="bg-ink-800 p-3.5 rounded-xl border-l-4"
             [style.border-left-color]="info(tier).color">
          <div class="text-[13px] font-semibold mb-1.5" [style.color]="info(tier).color">
            {{ info(tier).label }}
          </div>
          <div class="text-ink-100 text-[12px] leading-relaxed mb-2">{{ info(tier).description }}</div>
          <div class="flex gap-1.5 text-[11px] text-ink-300 leading-snug">
            <lg-icon name="policy" [size]="14" class="text-ink-300 shrink-0 mt-0.5"/>
            <span>{{ info(tier).obligations }}</span>
          </div>
        </div>
      }
    </section>

    <div class="bg-ink-800 border border-ink-700 rounded-xl p-5 mb-4">
      <h2 class="text-[14px] font-semibold text-ink-50 mb-3">Positionnement de votre flotte</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
        @for (tier of tierOrder; track tier) {
          <div class="bg-ink-900 rounded-lg overflow-hidden min-h-[220px]">
            <div class="flex justify-between items-center px-3 py-2.5 text-ink-900 text-[12px] font-semibold uppercase tracking-wide"
                 [style.background]="info(tier).color">
              <span>{{ info(tier).label }}</span>
              <span class="bg-black/25 rounded-full px-2 tabular-nums">{{ byTier(tier).length }}</span>
            </div>
            <div class="p-2.5 flex flex-col gap-2">
              @for (row of byTier(tier); track row.llm) {
                <div class="bg-ink-900 border rounded-md p-2.5"
                     [style.border-color]="info(tier).color">
                  <div class="flex justify-between items-center">
                    <div class="text-[13px] font-semibold text-ink-50">{{ row.llm }}</div>
                    <div class="text-[11px] text-brand-300 tabular-nums">{{ row.usageCount }}</div>
                  </div>
                  @if (row.jurisdiction) {
                    <div class="text-[10px] text-ink-500 mt-1">{{ row.jurisdiction.company }} · {{ row.jurisdiction.country }}</div>
                  }
                  <div class="text-[11px] text-ink-300 leading-relaxed mt-1.5">{{ row.reason }}</div>
                </div>
              } @empty {
                <p class="text-ink-500 text-[11px] py-4 text-center">—</p>
              }
            </div>
          </div>
        }
      </div>
    </div>

    <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
      <h2 class="text-[14px] font-semibold text-ink-50 mb-1">Carte thermique usage × niveau</h2>
      <p class="text-ink-300 text-[12px] mb-3">Plus la couleur est saturée, plus le croisement est sensible.</p>

      <div class="flex flex-col gap-1">
        <div class="grid gap-1 items-center"
             style="grid-template-columns: 200px repeat(4, 1fr);">
          <div></div>
          @for (tier of tierOrder; track tier) {
            <div class="text-center text-[10px] uppercase tracking-wide font-semibold py-1.5"
                 [style.color]="info(tier).color">
              {{ info(tier).label }}
            </div>
          }
        </div>
        @for (row of rows(); track row.llm) {
          <div class="grid gap-1 items-center"
               style="grid-template-columns: 200px repeat(4, 1fr);">
            <div class="text-[12px] text-ink-100 px-1.5">
              {{ row.llm }} <span class="text-ink-500 text-[11px]">({{ row.usageCount }})</span>
            </div>
            @for (tier of tierOrder; track tier) {
              <div class="h-9 rounded flex items-center justify-center"
                   [style.background]="row.tier === tier ? info(tier).color : '#14151a'"
                   [style.opacity]="row.tier === tier ? heatOpacity(row.usageCount) : 1">
                @if (row.tier === tier) {
                  <span class="text-black/85 text-[18px] leading-none">●</span>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class RiskTiersComponent {
  private readonly svc = inject(ComplianceService);

  protected readonly tierOrder: RiskTier[] = ['minimal', 'limited', 'high', 'unacceptable'];
  protected readonly rows = computed(() => this.svc.riskTiers());

  constructor() {
    this.svc.loadStats('30d').subscribe();
  }

  protected info(tier: RiskTier) {
    return RISK_TIERS[tier];
  }

  protected byTier(tier: RiskTier) {
    return this.rows().filter((r) => r.tier === tier);
  }

  protected heatOpacity(count: number): number {
    const max = Math.max(1, ...this.rows().map((r) => r.usageCount));
    return 0.35 + 0.65 * (count / max);
  }
}
