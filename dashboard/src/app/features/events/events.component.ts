import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { ApiService } from '../../core/api.service';
import { LLMGuardEvent } from '../../core/schema.generated';
import { LiveService } from '../../core/live.service';
import { IconComponent } from '../../shared/icon.component';

const ACTION_STYLE: Record<string, string> = {
  CLEAN: 'bg-clean-900 text-brand-300',
  ANONYMIZED: 'bg-brand-700 text-ink-50',
  PII_DETECTED: 'bg-warn-900 text-warn-300',
  BLOCKED: 'bg-danger-800 text-danger-300',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-danger-800 text-danger-300',
  high: 'bg-high-900 text-high-300',
  medium: 'bg-warn-900 text-warn-300',
  low: 'bg-info-900 text-info-500',
};

@Component({
  selector: 'lg-events',
  standalone: true,
  imports: [DatePipe, IconComponent],
  template: `
    <header class="flex justify-between items-center mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Évènements</h1>
      <button type="button" (click)="toggleLive()"
              class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition-colors"
              [class]="live.connected()
                ? 'border-brand-700 bg-brand-700/15 text-brand-500 hover:bg-brand-700/25'
                : 'border-ink-700 text-ink-100 hover:border-brand-700 hover:bg-brand-700/10'">
        <lg-icon [name]="live.connected() ? 'sync' : 'sync_disabled'" [size]="16"
                 [class]="live.connected() ? 'animate-spin-slow' : ''"/>
        {{ live.connected() ? 'Live activé' : 'Activer le live' }}
      </button>
    </header>

    <div class="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
      @if (rows().length > 0) {
        <div class="overflow-x-auto">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="bg-ink-900/50 border-b border-ink-700">
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Heure</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">LLM</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Action</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Hôte</th>
                <th class="text-left px-4 py-3 text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Détections</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.timestamp + r.endpoint) {
                <tr class="border-b border-ink-700 hover:bg-ink-900/40 transition-colors">
                  <td class="px-4 py-3 text-ink-100 font-mono tabular-nums">{{ r.timestamp | date: 'short' }}</td>
                  <td class="px-4 py-3 text-ink-50 font-medium">{{ r.llm }}</td>
                  <td class="px-4 py-3">
                    <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                          [class]="actionStyle(r.action)">{{ r.action }}</span>
                  </td>
                  <td class="px-4 py-3 text-ink-300 font-mono text-[12px]">{{ r.hostname }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-1.5">
                      @for (f of r.findings; track f.type) {
                        <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium"
                              [class]="severityStyle(f.severity)">{{ f.type }} ({{ f.count }})</span>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (loaded()) {
        <div class="py-14 px-6 text-center text-ink-300 text-[13px]">
          <lg-icon name="list_alt" [size]="40" class="text-brand-700 mx-auto mb-3"/>
          <p>Aucun évènement ingéré. Activez la télémétrie dans l'extension
            (<code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">chrome-extension://…/options.html</code>)
            et pointez-la sur <code class="bg-ink-900 px-1.5 py-0.5 rounded font-mono text-[11px]">https://localhost</code>.</p>
        </div>
      } @else {
        <p class="py-10 px-6 text-ink-400 text-[13px]">Chargement…</p>
      }
    </div>
  `,
  styles: [`
    .animate-spin-slow { animation: spin 3s linear infinite; }
  `],
})
export class EventsComponent {
  private readonly api = inject(ApiService);
  protected readonly live = inject(LiveService);
  protected readonly rows = signal<LLMGuardEvent[]>([]);
  protected readonly loaded = signal<boolean>(false);

  constructor() {
    this.api.events({ limit: 100 }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.loaded.set(true);
      },
      error: () => {
        this.rows.set([]);
        this.loaded.set(true);
      },
    });
  }

  protected toggleLive(): void {
    if (this.live.connected()) this.live.disconnect();
    else this.live.connect();
  }

  protected actionStyle(a: string): string {
    return ACTION_STYLE[a] ?? 'bg-ink-700 text-ink-100';
  }

  protected severityStyle(s: string): string {
    return SEVERITY_STYLE[s] ?? 'bg-ink-700 text-ink-100';
  }
}
