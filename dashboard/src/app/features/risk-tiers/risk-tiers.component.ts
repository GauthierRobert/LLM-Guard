import { Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ComplianceService } from '../../core/compliance.service';
import { RISK_TIERS, RiskTier } from '../../core/compliance.data';

@Component({
  selector: 'lg-risk-tiers',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Classification par niveau de risque IA</h1>
        <p class="sub">Chaque service LLM positionné sur les quatre niveaux de l'EU AI Act, croisé avec votre trafic réel.</p>
      </div>
    </header>

    <section class="legend">
      @for (tier of tierOrder; track tier) {
        <div class="tier-card" [style.border-left-color]="info(tier).color">
          <div class="tier-label" [style.color]="info(tier).color">{{ info(tier).label }}</div>
          <div class="tier-desc">{{ info(tier).description }}</div>
          <div class="tier-oblig">
            <mat-icon>policy</mat-icon>
            {{ info(tier).obligations }}
          </div>
        </div>
      }
    </section>

    <mat-card class="matrix">
      <h2>Positionnement de votre flotte</h2>
      <div class="grid">
        @for (tier of tierOrder; track tier) {
          <div class="col">
            <div class="col-head" [style.background]="info(tier).color">
              <span>{{ info(tier).label }}</span>
              <span class="col-count">{{ byTier(tier).length }}</span>
            </div>
            <div class="col-body">
              @for (row of byTier(tier); track row.llm) {
                <div class="llm-card" [style.border-color]="info(tier).color">
                  <div class="llm-top">
                    <div class="llm-name">{{ row.llm }}</div>
                    <div class="llm-count">{{ row.usageCount }}</div>
                  </div>
                  @if (row.jurisdiction) {
                    <div class="llm-jur">{{ row.jurisdiction.company }} · {{ row.jurisdiction.country }}</div>
                  }
                  <div class="llm-reason">{{ row.reason }}</div>
                </div>
              } @empty {
                <p class="empty">—</p>
              }
            </div>
          </div>
        }
      </div>
    </mat-card>

    <mat-card class="heat">
      <h2>Carte thermique usage × niveau</h2>
      <p class="caption">Plus la couleur est saturée, plus le croisement est sensible.</p>
      <div class="heat-grid">
        <div class="heat-row heat-head">
          <div class="heat-cell-label"></div>
          @for (tier of tierOrder; track tier) {
            <div class="heat-cell-head" [style.color]="info(tier).color">{{ info(tier).label }}</div>
          }
        </div>
        @for (row of rows(); track row.llm) {
          <div class="heat-row">
            <div class="heat-cell-label">{{ row.llm }} <span class="total">({{ row.usageCount }})</span></div>
            @for (tier of tierOrder; track tier) {
              <div class="heat-cell" [class.active]="row.tier === tier"
                   [style.background]="row.tier === tier ? info(tier).color : '#14151a'"
                   [style.opacity]="row.tier === tier ? heatOpacity(row.usageCount) : 1">
                @if (row.tier === tier) {
                  <span class="dot">●</span>
                }
              </div>
            }
          </div>
        }
      </div>
    </mat-card>
  `,
  styles: [
    `
      .page-head { margin-bottom: 18px; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; max-width: 720px; }

      .legend { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
      .tier-card { padding: 14px; background: #14151a; border-radius: 8px; border-left: 4px solid transparent; }
      .tier-label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
      .tier-desc { color: #d1d0c7; font-size: 12px; line-height: 1.5; margin-bottom: 8px; }
      .tier-oblig { display: flex; gap: 6px; font-size: 11px; color: #888780; line-height: 1.45; }
      .tier-oblig mat-icon { font-size: 14px; width: 14px; height: 14px; color: #888780; flex-shrink: 0; margin-top: 1px; }

      .matrix { padding: 18px; margin-bottom: 14px; }
      .matrix h2, .heat h2 { font-size: 14px; font-weight: 600; color: #e1f5ee; margin-bottom: 12px; }
      .caption { color: #888780; font-size: 12px; margin-bottom: 12px; }

      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .col { background: #14151a; border-radius: 8px; overflow: hidden; min-height: 220px; }
      .col-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; color: #0e0f11; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
      .col-count { background: rgba(14, 15, 17, 0.25); border-radius: 10px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
      .col-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }

      .llm-card { background: #0e0f11; border: 1px solid; border-radius: 6px; padding: 10px; }
      .llm-top { display: flex; justify-content: space-between; align-items: center; }
      .llm-name { font-size: 13px; font-weight: 600; color: #e1f5ee; }
      .llm-count { font-size: 11px; color: #9fe1cb; font-variant-numeric: tabular-nums; }
      .llm-jur { font-size: 10px; color: #5f5e5a; margin-top: 4px; }
      .llm-reason { font-size: 11px; color: #888780; line-height: 1.5; margin-top: 6px; }
      .empty { color: #3f3e3a; font-size: 11px; padding: 14px; text-align: center; }

      .heat { padding: 18px; }
      .heat-grid { display: flex; flex-direction: column; gap: 4px; }
      .heat-row { display: grid; grid-template-columns: 200px repeat(4, 1fr); gap: 4px; align-items: center; }
      .heat-head .heat-cell-head { text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px; font-weight: 600; }
      .heat-cell-label { font-size: 12px; color: #d1d0c7; padding: 0 6px; }
      .heat-cell-label .total { color: #5f5e5a; font-size: 11px; }
      .heat-cell { height: 38px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
      .heat-cell .dot { color: rgba(14, 15, 17, 0.85); font-size: 20px; }
    `,
  ],
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
