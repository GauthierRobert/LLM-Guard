import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'lg-devices',
  standalone: true,
  imports: [MatCardModule],
  template: `
    <h1>Appareils</h1>
    <mat-card class="pane">
      <p>Inventaire de la flotte, dernière activité, rotation de jeton — à implémenter.</p>
    </mat-card>
  `,
  styles: [`h1 { font-size: 22px; color: #e1f5ee; margin-bottom: 16px; } .pane { padding: 24px; }`],
})
export class DevicesComponent {}
