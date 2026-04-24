import { Component, computed, inject, signal } from '@angular/core';

import { ComplianceService } from '../../core/compliance.service';
import { ComplianceArticle, FINDING_TYPE_TO_ARTICLES, Framework } from '../../core/compliance.data';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-compliance',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="flex justify-between items-start mb-5 gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold text-ink-50">Explorateur de conformité</h1>
        <p class="text-ink-300 text-[13px] mt-1">Chaque détection cartographiée à l'article RGPD ou IA Act qui la concerne.</p>
      </div>
      <div class="inline-flex gap-1 bg-ink-800 border border-ink-700 p-1 rounded-lg">
        <button type="button" (click)="setFramework('GDPR')"
                class="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-[13px] transition-colors"
                [class]="framework() === 'GDPR' ? 'bg-brand-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'">
          <lg-icon name="gavel" [size]="16"/> RGPD
        </button>
        <button type="button" (click)="setFramework('AI_ACT')"
                class="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-[13px] transition-colors"
                [class]="framework() === 'AI_ACT' ? 'bg-brand-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'">
          <lg-icon name="smart_toy" [size]="16"/> IA Act
        </button>
      </div>
    </header>

    <section class="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-3 items-start">
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-5 max-h-[calc(100vh-170px)] overflow-y-auto">
        <h2 class="text-[15px] font-semibold text-ink-50 mb-1">
          {{ framework() === 'GDPR' ? 'Règlement général — RGPD' : 'Règlement IA — IA Act' }}
        </h2>
        <p class="text-ink-300 text-[12px] mb-4">{{ articles().length }} articles mappés à vos détections.</p>

        @for (a of articles(); track a.id) {
          <button type="button" (click)="select(a)"
                  class="w-full text-left p-3 mb-2 rounded-lg border transition-colors"
                  [class]="selected()?.id === a.id
                    ? 'bg-brand-700/15 border-brand-700'
                    : 'bg-transparent border-ink-700 hover:bg-ink-900/60 hover:border-ink-600'">
            <div class="flex gap-2 items-baseline">
              <span class="font-mono text-[11px] text-brand-500 font-semibold">{{ a.number }}</span>
              <span class="text-[13px] font-medium text-ink-50">{{ a.title }}</span>
            </div>
            <div class="text-ink-300 text-[12px] mt-1.5 mb-2 leading-relaxed">{{ a.summary }}</div>
            <div class="flex flex-wrap gap-1">
              @for (t of triggeringTypes(a.id); track t) {
                <span class="bg-ink-900 border border-ink-600 text-brand-300 text-[10px] px-2 py-0.5 rounded-full font-mono">{{ t }}</span>
              }
              @if (triggeringTypes(a.id).length === 0) {
                <span class="bg-ink-900 border border-ink-600 text-ink-500 text-[10px] px-2 py-0.5 rounded-full">Aucune détection active</span>
              }
            </div>
          </button>
        }
      </div>

      <div class="bg-ink-800 border border-ink-700 rounded-xl p-6 min-h-[400px]">
        @if (selected(); as a) {
          <div class="flex justify-between items-start mb-4 gap-4 flex-wrap">
            <div>
              <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold mb-2 tracking-wide"
                    [class]="a.framework === 'AI_ACT' ? 'bg-ai-900 text-ai-500' : 'bg-info-900 text-info-500'">
                {{ a.framework === 'GDPR' ? 'RGPD' : 'IA Act' }}
              </span>
              <h2 class="text-[20px] font-semibold text-ink-50">{{ a.number }} — {{ a.title }}</h2>
            </div>
            <a [href]="a.url" target="_blank" rel="noopener"
               class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-700 text-ink-100 text-[13px] hover:border-brand-700 hover:bg-brand-700/10 transition-colors">
              <lg-icon name="open_in_new" [size]="14"/> EUR-Lex
            </a>
          </div>

          <h3 class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mt-5 mb-2">Résumé</h3>
          <p class="text-ink-100 leading-relaxed text-[14px]">{{ a.summary }}</p>

          <h3 class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mt-5 mb-2">Texte</h3>
          <blockquote class="border-l-[3px] border-brand-700 bg-ink-900 rounded-r-lg px-4 py-3 italic text-ink-200 text-[13px] leading-relaxed">
            {{ a.fullText }}
          </blockquote>

          <h3 class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mt-5 mb-2">Types de détection concernés</h3>
          <div class="flex flex-wrap gap-1.5">
            @for (t of triggeringTypes(a.id); track t) {
              <span class="bg-ink-900 border border-ink-600 text-brand-300 text-[11px] px-2 py-0.5 rounded-full font-mono">{{ t }}</span>
            } @empty {
              <p class="text-ink-500 text-[13px]">Aucun type de détection actuellement mappé à cet article.</p>
            }
          </div>

          <h3 class="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mt-5 mb-2">Mesure appliquée par LLM Guard</h3>
          <ul class="space-y-2">
            <li class="flex items-center gap-3 text-ink-100 text-[13px]">
              <lg-icon name="shield" [size]="18" class="text-brand-500"/>
              Détection multi-couches (regex → fuzzy → contextuel → LLM)
            </li>
            <li class="flex items-center gap-3 text-ink-100 text-[13px]">
              <lg-icon name="replay" [size]="18" class="text-brand-500"/>
              Anonymisation par jetons typés, dé-anonymisation côté client
            </li>
            <li class="flex items-center gap-3 text-ink-100 text-[13px]">
              <lg-icon name="lock" [size]="18" class="text-brand-500"/>
              Minimisation : seul le contenu masqué atteint le LLM (Art. 5(1)(c))
            </li>
            <li class="flex items-center gap-3 text-ink-100 text-[13px]">
              <lg-icon name="history" [size]="18" class="text-brand-500"/>
              Traçabilité via cette télémétrie anonymisée
            </li>
          </ul>
        } @else {
          <p class="text-ink-500 text-[13px]">Sélectionnez un article dans la liste pour voir son détail.</p>
        }
      </div>
    </section>
  `,
})
export class ComplianceComponent {
  private readonly svc = inject(ComplianceService);

  protected readonly framework = signal<Framework>('GDPR');
  protected readonly selected = signal<ComplianceArticle | null>(null);

  protected readonly articles = computed(() => this.svc.articlesByFramework(this.framework()));

  constructor() {
    this.svc.loadStats('30d').subscribe();
    this.selected.set(this.articles()[0] ?? null);
  }

  protected setFramework(f: Framework): void {
    this.framework.set(f);
    this.selected.set(this.articles()[0] ?? null);
  }

  protected select(a: ComplianceArticle): void {
    this.selected.set(a);
  }

  protected triggeringTypes(articleId: string): string[] {
    return Object.entries(FINDING_TYPE_TO_ARTICLES)
      .filter(([, ids]) => ids.includes(articleId))
      .map(([t]) => t);
  }
}
