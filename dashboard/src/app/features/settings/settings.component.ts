import { Component } from '@angular/core';

import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'lg-settings',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="text-[22px] font-semibold text-ink-50">Paramètres</h1>
      <p class="text-ink-300 text-[13px] mt-1">Seuils d'alerte, webhooks Slack/Teams, rétention — à implémenter.</p>
    </header>

    <div class="bg-ink-800 border border-ink-700 rounded-xl p-10 flex items-center gap-4 text-ink-300">
      <lg-icon name="settings" [size]="28" class="text-brand-500"/>
      <div>
        <div class="text-ink-50 text-sm font-semibold mb-1">À venir</div>
        <div class="text-[13px]">Cette section accueillera les réglages serveur, les webhooks et les politiques de rétention.</div>
      </div>
    </div>
  `,
})
export class SettingsComponent {}
