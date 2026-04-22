import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ComplianceService } from '../../core/compliance.service';
import { ComplianceArticle, FINDING_TYPE_TO_ARTICLES } from '../../core/compliance.data';

interface FindingRow {
  type: string;
  count: number;
  articles: ComplianceArticle[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

@Component({
  selector: 'lg-findings',
  standalone: true,
  imports: [MatCardModule, MatIconModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Détections</h1>
        <p class="sub">Chaque type de donnée détecté relié à son fondement juridique (RGPD / IA Act).</p>
      </div>
    </header>

    <mat-card class="summary">
      <div class="sum-item">
        <div class="sum-label">Types détectés</div>
        <div class="sum-value">{{ rows().length }}</div>
      </div>
      <div class="sum-item">
        <div class="sum-label">Données Art. 9 RGPD</div>
        <div class="sum-value v-red">{{ art9Count() }}</div>
        <div class="sum-sub">Catégories particulières</div>
      </div>
      <div class="sum-item">
        <div class="sum-label">Signaux IA Act</div>
        <div class="sum-value v-purple">{{ aiActCount() }}</div>
        <div class="sum-sub">Signalements liés à l'Annexe III / Art. 5</div>
      </div>
      <div class="sum-item">
        <div class="sum-label">Occurrences totales</div>
        <div class="sum-value v-teal">{{ totalOcc() }}</div>
      </div>
    </mat-card>

    <mat-card class="pane">
      <table class="tbl">
        <thead>
          <tr>
            <th>Type</th>
            <th class="num">Occurrences</th>
            <th>Sévérité</th>
            <th>Fondement juridique</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.type) {
            <tr>
              <td class="bold">{{ row.type }}</td>
              <td class="num">{{ row.count }}</td>
              <td><span class="chip" [class]="'sev-' + row.severity">{{ labelSev(row.severity) }}</span></td>
              <td class="chips-cell">
                @for (a of row.articles; track a.id) {
                  <a class="leg-chip" [class.ai]="a.framework === 'AI_ACT'" [routerLink]="'/compliance'"
                     [attr.title]="a.summary">
                    <mat-icon>{{ a.framework === 'GDPR' ? 'gavel' : 'smart_toy' }}</mat-icon>
                    <span>{{ a.framework === 'GDPR' ? 'RGPD' : 'IA Act' }} · {{ a.number }}</span>
                  </a>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="empty">Aucune détection sur la période.</td></tr>
          }
        </tbody>
      </table>
    </mat-card>
  `,
  styles: [
    `
      .page-head { margin-bottom: 18px; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; }

      .summary { display: grid; grid-template-columns: repeat(4, 1fr); padding: 18px; gap: 14px; margin-bottom: 14px; }
      .sum-label { font-size: 11px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; }
      .sum-value { font-size: 28px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; color: #e1f5ee; }
      .sum-sub { font-size: 10px; color: #5f5e5a; margin-top: 2px; }
      .v-teal { color: #5DCAA5; } .v-red { color: #F09595; } .v-purple { color: #c4a6ff; }

      .pane { padding: 0; overflow: hidden; }
      .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
      .tbl th { text-align: left; padding: 12px 14px; color: #888780; text-transform: uppercase; font-size: 10px; letter-spacing: 0.6px; border-bottom: 1px solid #1e1f23; }
      .tbl td { padding: 12px 14px; border-bottom: 1px solid #1e1f23; color: #d1d0c7; vertical-align: middle; }
      .tbl .num { font-variant-numeric: tabular-nums; text-align: right; width: 120px; }
      .tbl .bold { font-weight: 600; color: #e1f5ee; font-family: ui-monospace, monospace; }
      .empty { color: #5f5e5a; text-align: center; padding: 40px 0; }

      .chip { padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
      .sev-critical { background: #501313; color: #F09595; }
      .sev-high { background: #4A1B0C; color: #F0997B; }
      .sev-medium { background: #412402; color: #FAC775; }
      .sev-low { background: #042C53; color: #85B7EB; }

      .chips-cell { display: flex; flex-wrap: wrap; gap: 6px; }
      .leg-chip { display: inline-flex; align-items: center; gap: 4px; background: #042C53; color: #85B7EB; font-size: 11px; padding: 3px 10px; border-radius: 10px; text-decoration: none; border: 1px solid transparent; transition: border-color 0.15s; cursor: pointer; }
      .leg-chip:hover { border-color: #85B7EB; }
      .leg-chip.ai { background: #2a1b42; color: #c4a6ff; }
      .leg-chip.ai:hover { border-color: #c4a6ff; }
      .leg-chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    `,
  ],
})
export class FindingsComponent {
  private readonly svc = inject(ComplianceService);

  protected readonly rows = computed<FindingRow[]>(() => {
    const s = this.svc.stats();
    return Object.entries(s.by_type)
      .map(([type, count]) => ({
        type,
        count,
        articles: this.svc.articlesForFinding(type),
        severity: this.severityFor(type),
      }))
      .sort((a, b) => b.count - a.count);
  });

  protected readonly totalOcc = computed(() => this.rows().reduce((n, r) => n + r.count, 0));

  protected readonly art9Count = computed(() =>
    this.rows().filter((r) => r.articles.some((a) => a.id === 'gdpr-9')).reduce((n, r) => n + r.count, 0),
  );

  protected readonly aiActCount = computed(() =>
    this.rows().filter((r) => r.articles.some((a) => a.framework === 'AI_ACT')).reduce((n, r) => n + r.count, 0),
  );

  constructor() {
    this.svc.loadStats('30d').subscribe();
  }

  protected labelSev(s: FindingRow['severity']): string {
    switch (s) {
      case 'critical': return 'Critique';
      case 'high': return 'Élevée';
      case 'medium': return 'Moyenne';
      case 'low': return 'Faible';
    }
  }

  private severityFor(type: string): FindingRow['severity'] {
    const ids = FINDING_TYPE_TO_ARTICLES[type.toLowerCase()] ?? [];
    if (ids.includes('aia-5')) return 'critical';
    if (ids.includes('gdpr-9')) return 'critical';
    if (['credit_card', 'ssn', 'password', 'nir', 'iban'].includes(type)) return 'high';
    if (['email', 'phone', 'phone_fr', 'address', 'name'].includes(type)) return 'medium';
    return 'low';
  }
}
