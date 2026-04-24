import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ComplianceService } from '../../core/compliance.service';
import { ComplianceArticle, FINDING_TYPE_TO_ARTICLES } from '../../core/compliance.data';
import { IconComponent } from '../../shared/icon.component';

interface FindingRow {
  type: string;
  count: number;
  articles: ComplianceArticle[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const SEV_CLASS: Record<FindingRow['severity'], string> = {
  critical: 'bg-danger-800 text-danger-300',
  high:     'bg-high-900 text-high-300',
  medium:   'bg-warn-900 text-warn-300',
  low:      'bg-info-900 text-info-500',
};

const SEV_LABEL: Record<FindingRow['severity'], string> = {
  critical: 'Critique',
  high:     'Élevée',
  medium:   'Moyenne',
  low:      'Faible',
};

@Component({
  selector: 'lg-findings',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Détections</h1>
      <p class="text-ink-300 text-[13px] mt-1">Chaque type de donnée détecté relié à son fondement juridique (RGPD / IA Act).</p>
    </header>

    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Types détectés</div>
        <div class="text-[28px] font-bold text-ink-50 tabular-nums mt-1">{{ rows().length }}</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Données Art. 9 RGPD</div>
        <div class="text-[28px] font-bold text-danger-300 tabular-nums mt-1">{{ art9Count() }}</div>
        <div class="text-[10px] text-ink-500 mt-0.5">Catégories particulières</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Signaux IA Act</div>
        <div class="text-[28px] font-bold text-ai-500 tabular-nums mt-1">{{ aiActCount() }}</div>
        <div class="text-[10px] text-ink-500 mt-0.5">Annexe III / Art. 5</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-4">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Occurrences totales</div>
        <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ totalOcc() }}</div>
      </div>
    </section>

    <div class="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr class="bg-ink-900/50 border-b border-ink-700">
              <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Type</th>
              <th class="text-right px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold w-32">Occurrences</th>
              <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Sévérité</th>
              <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Fondement juridique</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.type) {
              <tr class="border-b border-ink-700 hover:bg-ink-900/40 transition-colors">
                <td class="px-4 py-3 font-mono font-semibold text-ink-50">{{ row.type }}</td>
                <td class="px-4 py-3 text-right tabular-nums text-ink-100">{{ row.count }}</td>
                <td class="px-4 py-3">
                  <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                        [class]="sevClass(row.severity)">{{ sevLabel(row.severity) }}</span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1.5">
                    @for (a of row.articles; track a.id) {
                      <a [routerLink]="'/compliance'" [attr.title]="a.summary"
                         class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border border-transparent transition-colors"
                         [class]="a.framework === 'AI_ACT'
                           ? 'bg-ai-900 text-ai-500 hover:border-ai-500'
                           : 'bg-info-900 text-info-500 hover:border-info-500'">
                        <lg-icon [name]="a.framework === 'GDPR' ? 'gavel' : 'smart_toy'" [size]="12"/>
                        <span>{{ a.framework === 'GDPR' ? 'RGPD' : 'IA Act' }} · {{ a.number }}</span>
                      </a>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="py-10 text-center text-ink-500 text-[13px]">Aucune détection sur la période.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
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

  protected sevClass(s: FindingRow['severity']): string { return SEV_CLASS[s]; }
  protected sevLabel(s: FindingRow['severity']): string { return SEV_LABEL[s]; }

  private severityFor(type: string): FindingRow['severity'] {
    const ids = FINDING_TYPE_TO_ARTICLES[type.toLowerCase()] ?? [];
    if (ids.includes('aia-5')) return 'critical';
    if (ids.includes('gdpr-9')) return 'critical';
    if (['credit_card', 'ssn', 'password', 'nir', 'iban'].includes(type)) return 'high';
    if (['email', 'phone', 'phone_fr', 'address', 'name'].includes(type)) return 'medium';
    return 'low';
  }
}
