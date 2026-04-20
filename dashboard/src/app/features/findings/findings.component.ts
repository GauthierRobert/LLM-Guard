import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'lg-findings',
  standalone: true,
  imports: [MatCardModule],
  template: `
    <h1>Détections</h1>
    <mat-card class="pane">
      <p>Heatmap type × sévérité — à implémenter (ng2-charts).</p>
    </mat-card>
  `,
  styles: [`h1 { font-size: 22px; color: #e1f5ee; margin-bottom: 16px; } .pane { padding: 24px; }`],
})
export class FindingsComponent {}
