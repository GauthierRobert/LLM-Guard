import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'lg-settings',
  standalone: true,
  imports: [MatCardModule],
  template: `
    <h1>Paramètres</h1>
    <mat-card class="pane">
      <p>Seuils d'alerte, webhooks Slack/Teams, rétention — à implémenter.</p>
    </mat-card>
  `,
  styles: [`h1 { font-size: 22px; color: #e1f5ee; margin-bottom: 16px; } .pane { padding: 24px; }`],
})
export class SettingsComponent {}
