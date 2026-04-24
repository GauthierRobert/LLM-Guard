import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { ComplianceService } from '../../core/compliance.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-dpia',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="flex justify-between items-start mb-5 gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold text-ink-50">AIPD & Registre des traitements</h1>
        <p class="text-ink-300 text-[13px] mt-1 max-w-[600px]">
          Génération automatique de l'analyse d'impact (Art. 35) et du RoPA (Art. 30) à partir de votre télémétrie.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button type="button" (click)="refresh()"
                class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-700 text-ink-100 text-[13px] hover:border-brand-700 hover:bg-brand-700/10 transition-colors">
          <lg-icon name="refresh" [size]="16"/> Régénérer
        </button>
        <button type="button" (click)="downloadDpia()"
                class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-700 hover:bg-brand-900 text-ink-50 text-[13px] font-medium transition-colors">
          <lg-icon name="download" [size]="16"/> Télécharger AIPD
        </button>
        <button type="button" (click)="downloadRopa()"
                class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-700 text-ink-100 text-[13px] hover:border-brand-700 hover:bg-brand-700/10 transition-colors">
          <lg-icon name="table_chart" [size]="16"/> Exporter RoPA (CSV)
        </button>
      </div>
    </header>

    <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Score global</div>
        <div class="text-[28px] font-bold tabular-nums mt-1" [style.color]="scoreColor()">{{ score().score }}/100</div>
        <div class="text-[11px] text-ink-500 mt-0.5">Grade {{ score().grade }}</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Articles RGPD mobilisés</div>
        <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ gdprCount() }}</div>
        <div class="text-[11px] text-ink-500 mt-0.5">sur {{ totalGdpr() }} disponibles</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Articles IA Act mobilisés</div>
        <div class="text-[28px] font-bold text-ai-500 tabular-nums mt-1">{{ aiActCount() }}</div>
        <div class="text-[11px] text-ink-500 mt-0.5">sur {{ totalAiAct() }} disponibles</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Dernière régénération</div>
        <div class="text-[15px] font-semibold text-ink-50 tabular-nums mt-1.5">{{ generatedAt() }}</div>
        <div class="text-[11px] text-ink-500 mt-0.5">Document vivant</div>
      </div>
    </section>

    <section class="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
        <div class="flex items-center gap-2.5 mb-3">
          <lg-icon name="description" [size]="18" class="text-brand-500"/>
          <h2 class="text-[14px] font-semibold text-ink-50">AIPD — Analyse d'impact relative à la protection des données</h2>
        </div>
        <pre class="bg-ink-900 border border-ink-700 p-4 rounded-lg max-h-[560px] overflow-y-auto font-mono text-[12px] leading-relaxed text-ink-100 whitespace-pre-wrap m-0">{{ dpiaMarkdown() }}</pre>
      </div>

      <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
        <div class="flex items-center gap-2.5 mb-3">
          <lg-icon name="view_list" [size]="18" class="text-brand-500"/>
          <h2 class="text-[14px] font-semibold text-ink-50">RoPA — Aperçu</h2>
        </div>
        <div class="max-h-[560px] overflow-y-auto">
          <table class="w-full text-[12px]">
            <thead class="sticky top-0 bg-ink-800">
              <tr class="border-b border-ink-700">
                <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Finalité</th>
                <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Catégorie</th>
                <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Destinataire</th>
                <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Transfert</th>
                <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Articles</th>
              </tr>
            </thead>
            <tbody>
              @for (row of ropaPreview(); track row.key) {
                <tr class="border-b border-ink-700">
                  <td class="px-2.5 py-2 text-ink-100 align-top">{{ row.purpose }}</td>
                  <td class="px-2.5 py-2 text-ink-100 align-top">{{ row.category }}</td>
                  <td class="px-2.5 py-2 text-ink-100 align-top">{{ row.recipient }}</td>
                  <td class="px-2.5 py-2 align-top">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap"
                          [class]="row.transferFlag ? 'bg-warn-900 text-warn-300' : 'bg-clean-900 text-brand-300'">
                      {{ row.transfer }}
                    </span>
                  </td>
                  <td class="px-2.5 py-2 font-mono text-[10px] text-brand-300 align-top">{{ row.articles }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `,
})
export class DpiaComponent {
  private readonly svc = inject(ComplianceService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly tick = signal(0);
  private readonly now = signal(new Date());

  protected readonly dpiaMarkdown = computed(() => {
    this.tick();
    return this.svc.generateDpia();
  });

  protected readonly score = computed(() => this.svc.computeScore());

  protected readonly scoreColor = computed(() => {
    const g = this.score().grade;
    return g === 'A' ? '#5DCAA5' : g === 'B' ? '#85B7EB' : g === 'C' ? '#EF9F27' : '#E24B4A';
  });

  protected readonly gdprCount = computed(() => this.svc.articlesByFramework('GDPR').length);
  protected readonly aiActCount = computed(() => this.svc.articlesByFramework('AI_ACT').length);
  protected readonly totalGdpr = computed(() => this.svc.articlesByFramework('GDPR').length);
  protected readonly totalAiAct = computed(() => this.svc.articlesByFramework('AI_ACT').length);

  protected readonly generatedAt = computed(() =>
    this.now().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  );

  protected readonly ropaPreview = computed(() => {
    this.tick();
    const transfers = this.svc.transferRows();
    const s = this.svc.stats;
    const topTypes = Object.entries(s().by_type).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const rows: { key: string; purpose: string; category: string; recipient: string; transfer: string; transferFlag: boolean; articles: string }[] = [];
    for (const t of transfers.slice(0, 4)) {
      for (const [type, count] of topTypes) {
        const arts = this.svc.articlesForFinding(type).map((a) => a.number).join(', ');
        const isTransfer = t.region !== 'EU';
        rows.push({
          key: `${t.llm}-${type}`,
          purpose: `Assistance IA via ${t.llm}`,
          category: `${type} (${count})`,
          recipient: `${t.company} — ${t.country}`,
          transfer: isTransfer ? t.adequacy === 'no_adequate' ? 'Hors UE — non adéquat' : t.adequacy === 'dpf' ? 'Hors UE — DPF' : 'Hors UE — SCC' : 'Intra-UE',
          transferFlag: isTransfer,
          articles: arts,
        });
      }
    }
    return rows;
  });

  constructor() {
    this.svc.loadStats('30d').subscribe();
  }

  protected refresh(): void {
    this.svc.loadStats('30d').subscribe();
    this.tick.update((v) => v + 1);
    this.now.set(new Date());
  }

  protected downloadDpia(): void {
    if (!this.isBrowser) return;
    const blob = new Blob([this.dpiaMarkdown()], { type: 'text/markdown;charset=utf-8' });
    this.saveBlob(blob, `dpia-llm-guard-${this.fileStamp()}.md`);
  }

  protected downloadRopa(): void {
    if (!this.isBrowser) return;
    const csv = this.svc.generateRopaCsv();
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    this.saveBlob(blob, `ropa-llm-guard-${this.fileStamp()}.csv`);
  }

  private fileStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
