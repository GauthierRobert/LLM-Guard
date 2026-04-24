import { Component, computed, inject } from '@angular/core';

import { ComplianceService } from '../../core/compliance.service';
import { WORLD_PATH_D } from './world-paths';

const ADEQ_CHIP: Record<string, string> = {
  adequate:     'bg-clean-900 text-brand-300',
  dpf:          'bg-info-900 text-info-500',
  scc_required: 'bg-warn-900 text-warn-300',
  no_adequate:  'bg-danger-800 text-danger-300',
};

const ADEQ_LABEL: Record<string, string> = {
  adequate:     'Intra-UE',
  dpf:          'DPF',
  scc_required: 'SCC requis',
  no_adequate:  'Sans adéquation',
};

@Component({
  selector: 'lg-transfers',
  standalone: true,
  imports: [],
  template: `
    <header class="mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Transferts transfrontaliers</h1>
      <p class="text-ink-300 text-[13px] mt-1 max-w-[720px]">
        Chapitre V RGPD (Art. 44+) : cartographie des destinataires LLM et de la base juridique applicable à chaque transfert.
      </p>
    </header>

    <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Flux intra-UE</div>
        <div class="text-[28px] font-bold text-brand-500 tabular-nums mt-1">{{ pct('adequate') }}%</div>
        <div class="text-[11px] text-ink-500 mt-0.5">{{ count('adequate') }} invites</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Couverts par DPF</div>
        <div class="text-[28px] font-bold text-info-500 tabular-nums mt-1">{{ pct('dpf') }}%</div>
        <div class="text-[11px] text-ink-500 mt-0.5">{{ count('dpf') }} invites · Data Privacy Framework</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">SCC requises</div>
        <div class="text-[28px] font-bold text-warn-500 tabular-nums mt-1">{{ pct('scc_required') }}%</div>
        <div class="text-[11px] text-ink-500 mt-0.5">{{ count('scc_required') }} invites · Clauses types</div>
      </div>
      <div class="bg-ink-800 border border-ink-700 rounded-xl p-3.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Sans adéquation</div>
        <div class="text-[28px] font-bold text-danger-500 tabular-nums mt-1">{{ pct('no_adequate') }}%</div>
        <div class="text-[11px] text-ink-500 mt-0.5">{{ count('no_adequate') }} invites · à restreindre</div>
      </div>
    </section>

    <div class="bg-ink-800 border border-ink-700 rounded-xl p-5 mb-4">
      <h2 class="text-[14px] font-semibold text-ink-50 mb-3">Destinations observées</h2>
      <div class="border border-ink-700 rounded-lg overflow-hidden" aria-label="Planisphère des destinations LLM">
        <svg viewBox="0 0 800 360" class="w-full h-auto block" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="ocean" cx="0.5" cy="0.55" r="0.75">
              <stop offset="0%"   stop-color="#0f1d2e"/>
              <stop offset="55%"  stop-color="#0a1320"/>
              <stop offset="100%" stop-color="#05090f"/>
            </radialGradient>
            <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stop-color="#233042"/>
              <stop offset="55%"  stop-color="#1c2838"/>
              <stop offset="100%" stop-color="#16202c"/>
            </linearGradient>
            <filter id="landShadow" x="-5%" y="-5%" width="110%" height="115%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.8"/>
              <feOffset dx="0" dy="0.6" result="offsetBlur"/>
              <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          <rect x="0" y="0" width="800" height="360" fill="url(#ocean)"/>

          <g stroke="#152232" stroke-width="0.35" fill="none" opacity="0.55">
            <line x1="133.3" y1="0" x2="133.3" y2="360"/>
            <line x1="266.7" y1="0" x2="266.7" y2="360"/>
            <line x1="400"   y1="0" x2="400"   y2="360"/>
            <line x1="533.3" y1="0" x2="533.3" y2="360"/>
            <line x1="666.7" y1="0" x2="666.7" y2="360"/>
            <line x1="0" y1="60"  x2="800" y2="60"/>
            <line x1="0" y1="120" x2="800" y2="120"/>
            <line x1="0" y1="240" x2="800" y2="240"/>
            <line x1="0" y1="300" x2="800" y2="300"/>
          </g>

          <line x1="0" y1="180" x2="800" y2="180" stroke="#1a2838" stroke-dasharray="3 5" stroke-width="0.6"/>
          <text x="8" y="176" fill="#2e4258" font-size="8" font-family="Inter, sans-serif">Équateur</text>

          <path [attr.d]="worldPath"
                fill="url(#land)"
                stroke="#34475e"
                stroke-width="0.35"
                stroke-linejoin="round"
                stroke-linecap="round"
                fill-rule="evenodd"
                filter="url(#landShadow)"/>

          <!-- EU/EEA zone (covers Western + Central Europe on the Natural Earth projection) -->
          <ellipse cx="422" cy="70" rx="48" ry="22"
                   fill="rgba(93, 202, 165, 0.10)"
                   stroke="#0F6E56" stroke-dasharray="3 3" stroke-width="1"/>
          <text x="422" y="42" fill="#5DCAA5" font-size="10" text-anchor="middle"
                font-weight="600" font-family="Inter, sans-serif">UE / EEE</text>

          @for (p of pins(); track p.llm) {
            <g [attr.transform]="'translate(' + p.x + ',' + p.y + ')'">
              <circle [attr.r]="p.radius"        [attr.fill]="p.color" fill-opacity="0.14"/>
              <circle [attr.r]="p.radius * 0.55" [attr.fill]="p.color" fill-opacity="0.28"/>
              <circle r="4" [attr.fill]="p.color" stroke="#0b1422" stroke-width="1.5"/>
              <text x="8" y="-6" fill="#e1f5ee" font-size="11" font-weight="600" font-family="Inter, sans-serif" style="paint-order: stroke; stroke: #0b1422; stroke-width: 3px;">{{ p.llm }}</text>
              <text x="8" y="6"  fill="#9c9b93" font-size="9"  font-family="Inter, sans-serif" style="paint-order: stroke; stroke: #0b1422; stroke-width: 3px;">{{ p.country }} · {{ p.usageCount }}</text>
            </g>
          }
        </svg>
      </div>
    </div>

    <div class="bg-ink-800 border border-ink-700 rounded-xl p-5">
      <h2 class="text-[14px] font-semibold text-ink-50 mb-3">Détail par destinataire</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr class="border-b border-ink-700">
              <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">LLM</th>
              <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Fournisseur</th>
              <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Pays</th>
              <th class="text-right px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Volume</th>
              <th class="text-right px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Part</th>
              <th class="text-left px-2.5 py-2 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Base juridique</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.llm) {
              <tr class="border-b border-ink-700 hover:bg-ink-900/40 transition-colors">
                <td class="px-2.5 py-3 font-semibold text-ink-50">{{ row.llm }}</td>
                <td class="px-2.5 py-3 text-ink-100">{{ row.company }}</td>
                <td class="px-2.5 py-3 text-ink-100">
                  <span class="text-base mr-1.5">{{ flag(row.countryCode) }}</span>{{ row.country }}
                </td>
                <td class="px-2.5 py-3 text-right tabular-nums text-ink-100">{{ row.usageCount }}</td>
                <td class="px-2.5 py-3 text-right tabular-nums text-ink-100">{{ (row.share * 100).toFixed(1) }}%</td>
                <td class="px-2.5 py-3">
                  <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                        [class]="adeqChip(row.adequacy)">{{ adeqLabel(row.adequacy) }}</span>
                  <div class="text-ink-300 text-[11px] mt-1.5 max-w-[480px] leading-relaxed">{{ row.basis }}</div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class TransfersComponent {
  private readonly svc = inject(ComplianceService);

  protected readonly worldPath = WORLD_PATH_D;

  protected readonly rows = computed(() => this.svc.transferRows());

  protected readonly pins = computed(() => {
    const rs = this.rows();
    const max = Math.max(1, ...rs.map((r) => r.usageCount));
    return rs.map((r) => {
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

  protected adeqChip(a: string): string { return ADEQ_CHIP[a] ?? 'bg-ink-700 text-ink-100'; }
  protected adeqLabel(a: string): string { return ADEQ_LABEL[a] ?? a; }

  protected flag(cc: string): string {
    if (cc.length !== 2) return '🏳';
    const base = 0x1f1e6;
    const A = 'A'.charCodeAt(0);
    return String.fromCodePoint(base + (cc.charCodeAt(0) - A)) + String.fromCodePoint(base + (cc.charCodeAt(1) - A));
  }
}
