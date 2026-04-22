import { Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ComplianceService } from '../../core/compliance.service';

@Component({
  selector: 'lg-transfers',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Transferts transfrontaliers</h1>
        <p class="sub">Chapitre V RGPD (Art. 44+) : cartographie des destinataires LLM et de la base juridique applicable à chaque transfert.</p>
      </div>
    </header>

    <section class="summary">
      <mat-card>
        <div class="kpi-label">Flux intra-UE</div>
        <div class="kpi-value v-green">{{ pct('adequate') }}%</div>
        <div class="kpi-note">{{ count('adequate') }} invites</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">Couverts par DPF</div>
        <div class="kpi-value v-blue">{{ pct('dpf') }}%</div>
        <div class="kpi-note">{{ count('dpf') }} invites · EU-US Data Privacy Framework</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">SCC requises</div>
        <div class="kpi-value v-amber">{{ pct('scc_required') }}%</div>
        <div class="kpi-note">{{ count('scc_required') }} invites · Clauses types</div>
      </mat-card>
      <mat-card>
        <div class="kpi-label">Sans adéquation</div>
        <div class="kpi-value v-red">{{ pct('no_adequate') }}%</div>
        <div class="kpi-note">{{ count('no_adequate') }} invites · à restreindre</div>
      </mat-card>
    </section>

    <mat-card class="map-card">
      <h2>Destinations observées</h2>
      <div class="map" aria-label="Planisphère des destinations LLM">
        <svg viewBox="0 0 800 360" class="world">
          <!-- Stylized continents background, no external tiles -->
          <rect x="0" y="0" width="800" height="360" fill="#0e0f11" />
          <!-- Very rough continent shapes -->
          <path d="M 70,130 Q 120,90 180,110 Q 230,130 250,170 Q 240,210 200,230 Q 150,240 110,220 Q 70,200 70,130 Z" fill="#14151a" stroke="#1e1f23" />
          <path d="M 180,250 Q 210,250 230,290 Q 220,330 200,335 Q 180,320 175,285 Z" fill="#14151a" stroke="#1e1f23" />
          <path d="M 320,100 Q 380,80 430,110 Q 460,130 450,160 Q 420,170 390,155 Q 350,145 320,135 Z" fill="#14151a" stroke="#1e1f23" />
          <path d="M 420,150 Q 470,140 510,170 Q 520,220 490,240 Q 450,245 425,230 Q 410,200 420,150 Z" fill="#14151a" stroke="#1e1f23" />
          <path d="M 470,90 Q 580,75 680,110 Q 720,150 700,200 Q 640,230 560,225 Q 510,210 480,180 Z" fill="#14151a" stroke="#1e1f23" />
          <path d="M 640,240 Q 680,240 700,280 Q 690,310 660,310 Q 640,285 635,255 Z" fill="#14151a" stroke="#1e1f23" />
          <line x1="0" y1="180" x2="800" y2="180" stroke="#1e1f23" stroke-dasharray="4 6" />
          <text x="12" y="174" fill="#3f3e3a" font-size="9">Équateur</text>

          <!-- EU zone highlight -->
          <ellipse cx="420" cy="130" rx="70" ry="32" fill="rgba(15, 110, 86, 0.15)" stroke="#0F6E56" stroke-dasharray="4 4" />
          <text x="420" y="95" fill="#5DCAA5" font-size="10" text-anchor="middle" font-weight="600">Zone UE/EEE</text>

          @for (p of pins(); track p.llm) {
            <g [attr.transform]="'translate(' + p.x + ',' + p.y + ')'">
              <circle [attr.r]="p.radius" [attr.fill]="p.color" fill-opacity="0.25" />
              <circle r="5" [attr.fill]="p.color" stroke="#0e0f11" stroke-width="1.5" />
              <text x="9" y="-8" fill="#e1f5ee" font-size="11" font-weight="600">{{ p.llm }}</text>
              <text x="9" y="5" fill="#888780" font-size="9">{{ p.country }} · {{ p.usageCount }}</text>
            </g>
          }
        </svg>
      </div>
    </mat-card>

    <mat-card class="table-card">
      <h2>Détail par destinataire</h2>
      <table class="tbl">
        <thead>
          <tr>
            <th>LLM</th>
            <th>Fournisseur</th>
            <th>Pays</th>
            <th>Volume</th>
            <th>Part</th>
            <th>Base juridique</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.llm) {
            <tr>
              <td class="bold">{{ row.llm }}</td>
              <td>{{ row.company }}</td>
              <td>
                <span class="flag">{{ flag(row.countryCode) }}</span>
                {{ row.country }}
              </td>
              <td class="num">{{ row.usageCount }}</td>
              <td class="num">{{ (row.share * 100).toFixed(1) }}%</td>
              <td>
                <span class="chip" [class]="'chip-' + row.adequacy">{{ label(row.adequacy) }}</span>
                <div class="basis">{{ row.basis }}</div>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </mat-card>
  `,
  styles: [
    `
      .page-head { margin-bottom: 18px; }
      h1 { font-size: 22px; font-weight: 600; color: #e1f5ee; }
      .sub { color: #888780; font-size: 13px; margin-top: 4px; max-width: 720px; }

      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
      .summary mat-card { padding: 14px; }
      .kpi-label { font-size: 11px; text-transform: uppercase; color: #888780; letter-spacing: 0.6px; }
      .kpi-value { font-size: 28px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
      .kpi-note { font-size: 11px; color: #5f5e5a; margin-top: 4px; }
      .v-green { color: #5DCAA5; } .v-blue { color: #85B7EB; } .v-amber { color: #EF9F27; } .v-red { color: #E24B4A; }

      .map-card, .table-card { padding: 18px; margin-bottom: 14px; }
      .map-card h2, .table-card h2 { font-size: 14px; font-weight: 600; color: #e1f5ee; margin-bottom: 12px; }
      .map { background: #0e0f11; border: 1px solid #1e1f23; border-radius: 8px; overflow: hidden; }
      .world { width: 100%; height: auto; display: block; }

      .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
      .tbl th { text-align: left; padding: 10px; color: #888780; text-transform: uppercase; font-size: 10px; letter-spacing: 0.6px; border-bottom: 1px solid #1e1f23; }
      .tbl td { padding: 12px 10px; border-bottom: 1px solid #1e1f23; color: #d1d0c7; vertical-align: top; }
      .tbl .bold { font-weight: 600; color: #e1f5ee; }
      .tbl .num { font-variant-numeric: tabular-nums; text-align: right; }
      .flag { font-size: 16px; margin-right: 6px; }

      .chip { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }
      .chip-adequate { background: #2a3b34; color: #9fe1cb; }
      .chip-dpf { background: #042C53; color: #85B7EB; }
      .chip-scc_required { background: #412402; color: #FAC775; }
      .chip-no_adequate { background: #501313; color: #F09595; }
      .basis { color: #888780; font-size: 11px; margin-top: 6px; max-width: 480px; line-height: 1.5; }
    `,
  ],
})
export class TransfersComponent {
  private readonly svc = inject(ComplianceService);

  protected readonly rows = computed(() => this.svc.transferRows());

  protected readonly pins = computed(() => {
    const rs = this.rows();
    const max = Math.max(1, ...rs.map((r) => r.usageCount));
    return rs.map((r) => {
      // Equirectangular-ish projection onto 800x360 viewBox.
      const x = ((r.lng + 180) / 360) * 800;
      const y = ((90 - r.lat) / 180) * 360;
      const radius = 8 + (r.usageCount / max) * 22;
      const color =
        r.adequacy === 'adequate' ? '#5DCAA5' :
        r.adequacy === 'dpf' ? '#85B7EB' :
        r.adequacy === 'scc_required' ? '#EF9F27' : '#E24B4A';
      return { ...r, x, y, radius, color };
    });
  });

  constructor() {
    this.svc.loadStats('30d').subscribe();
  }

  protected pct(key: 'adequate' | 'dpf' | 'scc_required' | 'no_adequate'): string {
    const rs = this.rows();
    const total = rs.reduce((n, r) => n + r.usageCount, 0) || 1;
    const part = rs.filter((r) => r.adequacy === key).reduce((n, r) => n + r.usageCount, 0);
    return ((part / total) * 100).toFixed(1);
  }

  protected count(key: 'adequate' | 'dpf' | 'scc_required' | 'no_adequate'): number {
    return this.rows().filter((r) => r.adequacy === key).reduce((n, r) => n + r.usageCount, 0);
  }

  protected label(a: string): string {
    switch (a) {
      case 'adequate': return 'Intra-UE';
      case 'dpf': return 'DPF';
      case 'scc_required': return 'SCC requis';
      case 'no_adequate': return 'Sans adéquation';
      default: return a;
    }
  }

  protected flag(cc: string): string {
    if (cc.length !== 2) return '🏳';
    const base = 0x1f1e6;
    const A = 'A'.charCodeAt(0);
    return String.fromCodePoint(base + (cc.charCodeAt(0) - A)) + String.fromCodePoint(base + (cc.charCodeAt(1) - A));
  }
}
