import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';

import { ComplianceService } from '../../core/compliance.service';
import { ComplianceArticle, FINDING_TYPE_TO_ARTICLES, Framework } from '../../core/compliance.data';

@Component({
  selector: 'lg-compliance',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatChipsModule, MatButtonModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Explorateur de conformité</h1>
        <p class="sub">Chaque détection cartographiée à l'article RGPD ou IA Act qui la concerne.</p>
      </div>
      <div class="tabs">
        <button [class.active]="framework() === 'GDPR'" (click)="setFramework('GDPR')">
          <mat-icon>gavel</mat-icon> RGPD
        </button>
        <button [class.active]="framework() === 'AI_ACT'" (click)="setFramework('AI_ACT')">
          <mat-icon>smart_toy</mat-icon> IA Act
        </button>
      </div>
    </header>

    <section class="layout">
      <mat-card class="list">
        <h2>{{ framework() === 'GDPR' ? 'Règlement général — RGPD' : 'Règlement IA — IA Act' }}</h2>
        <p class="caption">{{ articles().length }} articles mappés à vos détections.</p>
        @for (a of articles(); track a.id) {
          <button class="article" [class.selected]="selected()?.id === a.id" (click)="select(a)">
            <div class="article-head">
              <span class="num">{{ a.number }}</span>
              <span class="title">{{ a.title }}</span>
            </div>
            <div class="article-sum">{{ a.summary }}</div>
            <div class="article-tags">
              @for (t of triggeringTypes(a.id); track t) {
                <span class="tag">{{ t }}</span>
              }
              @if (triggeringTypes(a.id).length === 0) {
                <span class="tag muted">Aucune détection active</span>
              }
            </div>
          </button>
        }
      </mat-card>

      <mat-card class="detail">
        @if (selected(); as a) {
          <div class="detail-head">
            <div>
              <span class="framework-chip" [class.ai]="a.framework === 'AI_ACT'">
                {{ a.framework === 'GDPR' ? 'RGPD' : 'IA Act' }}
              </span>
              <h2>{{ a.number }} — {{ a.title }}</h2>
            </div>
            <a mat-stroked-button [href]="a.url" target="_blank" rel="noopener">
              <mat-icon>open_in_new</mat-icon> EUR-Lex
            </a>
          </div>

          <h3>Résumé</h3>
          <p>{{ a.summary }}</p>

          <h3>Texte</h3>
          <blockquote>{{ a.fullText }}</blockquote>

          <h3>Types de détection concernés</h3>
          <div class="types">
            @for (t of triggeringTypes(a.id); track t) {
              <span class="tag">{{ t }}</span>
            } @empty {
              <p class="muted">Aucun type de détection actuellement mappé à cet article.</p>
            }
          </div>

          <h3>Mesure appliquée par LLM Guard</h3>
          <ul class="measures">
            <li><mat-icon>shield</mat-icon> Détection multi-couches (regex → fuzzy → contextuel → LLM)</li>
            <li><mat-icon>replay</mat-icon> Anonymisation par jetons typés, dé-anonymisation côté client</li>
            <li><mat-icon>lock</mat-icon> Minimisation : seul le contenu masqué atteint le LLM (Art. 5(1)(c))</li>
            <li><mat-icon>history</mat-icon> Traçabilité via cette télémétrie anonymisée</li>
          </ul>
        } @else {
          <p class="empty">Sélectionnez un article dans la liste pour voir son détail.</p>
        }
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; gap: 16px; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; }
      .tabs { display: flex; gap: 4px; background: #14151a; padding: 3px; border-radius: 8px; }
      .tabs button { background: transparent; border: none; color: #888780; padding: 8px 14px; font-size: 13px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .tabs button.active { background: #0F6E56; color: #e1f5ee; }
      .tabs button mat-icon { font-size: 18px; width: 18px; height: 18px; }

      .layout { display: grid; grid-template-columns: 420px 1fr; gap: 14px; align-items: start; }
      .list { padding: 18px; max-height: calc(100vh - 170px); overflow-y: auto; }
      .list h2 { font-size: 15px; font-weight: 600; color: #e1f5ee; margin-bottom: 4px; }
      .caption { color: #888780; font-size: 12px; margin-bottom: 14px; }

      .article { width: 100%; background: transparent; border: 1px solid #1e1f23; text-align: left; padding: 12px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; color: #d1d0c7; transition: background 0.15s, border-color 0.15s; }
      .article:hover { background: #14151a; border-color: #2a2b30; }
      .article.selected { background: rgba(15, 110, 86, 0.15); border-color: #0F6E56; }
      .article-head { display: flex; gap: 8px; align-items: baseline; }
      .num { font-family: ui-monospace, monospace; font-size: 11px; color: #5DCAA5; font-weight: 600; }
      .title { font-size: 13px; font-weight: 500; color: #e1f5ee; }
      .article-sum { color: #888780; font-size: 12px; margin: 6px 0 8px; line-height: 1.4; }
      .article-tags { display: flex; flex-wrap: wrap; gap: 4px; }
      .tag { background: #14151a; border: 1px solid #2a2b30; color: #9fe1cb; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-family: ui-monospace, monospace; }
      .tag.muted { color: #5f5e5a; }

      .detail { padding: 24px; min-height: 400px; }
      .detail-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; gap: 16px; }
      .framework-chip { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; background: #042C53; color: #85B7EB; margin-bottom: 6px; }
      .framework-chip.ai { background: #2a1b42; color: #c4a6ff; }
      .detail h2 { font-size: 20px; font-weight: 600; color: #e1f5ee; }
      .detail h3 { font-size: 11px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; margin-top: 18px; margin-bottom: 8px; }
      .detail p { color: #d1d0c7; line-height: 1.55; font-size: 14px; }
      blockquote { border-left: 3px solid #0F6E56; padding: 10px 14px; color: #b8b7ae; font-style: italic; background: #14151a; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.55; margin: 0; }
      .types { display: flex; flex-wrap: wrap; gap: 6px; }
      .measures { list-style: none; padding: 0; margin: 0; }
      .measures li { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: #d1d0c7; font-size: 13px; }
      .measures mat-icon { color: #5DCAA5; font-size: 18px; width: 18px; height: 18px; }
      .empty, .muted { color: #5f5e5a; font-size: 13px; }
    `,
  ],
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
