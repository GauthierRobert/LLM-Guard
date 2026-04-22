import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { ComplianceService } from '../../core/compliance.service';

@Component({
  selector: 'lg-dpia',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatButtonModule],
  template: `
    <header class="page-head">
      <div>
        <h1>AIPD & Registre des traitements</h1>
        <p class="sub">Génération automatique de l'analyse d'impact (Art. 35) et du RoPA (Art. 30) à partir de votre télémétrie.</p>
      </div>
      <div class="actions">
        <button mat-stroked-button (click)="refresh()"><mat-icon>refresh</mat-icon> Régénérer</button>
        <button mat-flat-button color="primary" (click)="downloadDpia()"><mat-icon>download</mat-icon> Télécharger AIPD</button>
        <button mat-stroked-button (click)="downloadRopa()"><mat-icon>table_chart</mat-icon> Exporter RoPA (CSV)</button>
      </div>
    </header>

    <section class="summary">
      <mat-card>
        <div class="kpi-label">Score global</div>
        <div class="kpi-value" [style.color]="scoreColor()">{{ score().score }}/100</div>
        <div class="kpi-note">Grade {{ score().grade }}</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">Articles RGPD mobilisés</div>
        <div class="kpi-value v-teal">{{ gdprCount() }}</div>
        <div class="kpi-note">sur {{ totalGdpr() }} disponibles</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">Articles IA Act mobilisés</div>
        <div class="kpi-value v-purple">{{ aiActCount() }}</div>
        <div class="kpi-note">sur {{ totalAiAct() }} disponibles</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">Dernière régénération</div>
        <div class="kpi-value-sm">{{ generatedAt() }}</div>
        <div class="kpi-note">Document vivant</div>
      </mat-card>
    </section>

    <section class="grid">
      <mat-card class="doc">
        <div class="doc-head">
          <mat-icon>description</mat-icon>
          <h2>AIPD — Analyse d'impact relative à la protection des données</h2>
        </div>
        <pre class="doc-body">{{ dpiaMarkdown() }}</pre>
      </mat-card>

      <mat-card class="doc">
        <div class="doc-head">
          <mat-icon>view_list</mat-icon>
          <h2>RoPA — Aperçu</h2>
        </div>
        <div class="ropa-wrap">
          <table class="ropa">
            <thead>
              <tr>
                <th>Finalité</th>
                <th>Catégorie</th>
                <th>Destinataire</th>
                <th>Transfert</th>
                <th>Articles</th>
              </tr>
            </thead>
            <tbody>
              @for (row of ropaPreview(); track row.key) {
                <tr>
                  <td>{{ row.purpose }}</td>
                  <td>{{ row.category }}</td>
                  <td>{{ row.recipient }}</td>
                  <td>
                    <span class="chip" [class.warn]="row.transferFlag">{{ row.transfer }}</span>
                  </td>
                  <td class="arts">{{ row.articles }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; max-width: 600px; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }

      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
      .summary mat-card { padding: 14px; }
      .kpi-label { font-size: 11px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; }
      .kpi-value { font-size: 28px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
      .kpi-value-sm { font-size: 15px; font-weight: 600; color: #e1f5ee; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .kpi-note { font-size: 11px; color: #5f5e5a; margin-top: 4px; }
      .v-teal { color: #5DCAA5; }
      .v-purple { color: #c4a6ff; }

      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 1200px) { .grid { grid-template-columns: 1fr; } }

      .doc { padding: 18px; }
      .doc-head { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
      .doc-head mat-icon { color: #5DCAA5; }
      .doc h2 { font-size: 14px; font-weight: 600; color: #e1f5ee; }
      .doc-body { background: #14151a; border: 1px solid #1e1f23; padding: 16px; border-radius: 8px; max-height: 560px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.6; color: #d1d0c7; white-space: pre-wrap; margin: 0; }

      .ropa-wrap { max-height: 560px; overflow-y: auto; }
      .ropa { width: 100%; border-collapse: collapse; font-size: 12px; }
      .ropa th { text-align: left; padding: 8px 10px; color: #888780; text-transform: uppercase; font-size: 10px; letter-spacing: 0.6px; border-bottom: 1px solid #1e1f23; background: #14151a; position: sticky; top: 0; }
      .ropa td { padding: 8px 10px; border-bottom: 1px solid #1e1f23; color: #d1d0c7; vertical-align: top; }
      .ropa .arts { font-family: ui-monospace, monospace; font-size: 10px; color: #9fe1cb; }
      .chip { padding: 2px 8px; border-radius: 10px; font-size: 10px; background: #2a3b34; color: #9fe1cb; white-space: nowrap; }
      .chip.warn { background: #412402; color: #FAC775; }
    `,
  ],
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
