import { ChangeDetectionStrategy, Component, Input } from '@angular/core';


export type IconName =
  | 'dashboard'
  | 'list_alt'
  | 'shield'
  | 'gavel'
  | 'description'
  | 'smart_toy'
  | 'public'
  | 'devices'
  | 'settings'
  | 'error_outline'
  | 'warning'
  | 'block'
  | 'sync'
  | 'sync_disabled'
  | 'open_in_new'
  | 'replay'
  | 'lock'
  | 'history'
  | 'refresh'
  | 'download'
  | 'table_chart'
  | 'view_list'
  | 'policy'
  | 'close'
  | 'check'
  | 'chevron_right';

/**
 * Inline SVG icon set. No external font, no Material Icons dependency.
 * All icons are 24×24, stroke-based, currentColor-aware, visual weight
 * matches Heroicons / Lucide. Add a new name+@case branch to extend.
 */
@Component({
  selector: 'lg-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    stroke="currentColor"
    fill="none"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    [attr.width]="size"
    [attr.height]="size"
  >
    @switch (name) {
      @case ('dashboard') {
        <rect x="3" y="3" width="7" height="9" rx="1.5"/>
        <rect x="14" y="3" width="7" height="5" rx="1.5"/>
        <rect x="14" y="12" width="7" height="9" rx="1.5"/>
        <rect x="3" y="16" width="7" height="5" rx="1.5"/>
      }
      @case ('list_alt') {
        <rect x="3.5" y="4" width="17" height="16" rx="2"/>
        <path d="M8 9h9M8 13h9M8 17h6"/>
        <circle cx="5.75" cy="9" r="0.9" fill="currentColor" stroke="none"/>
        <circle cx="5.75" cy="13" r="0.9" fill="currentColor" stroke="none"/>
        <circle cx="5.75" cy="17" r="0.9" fill="currentColor" stroke="none"/>
      }
      @case ('shield') {
        <path d="M12 3 4.5 6v6c0 4.5 3 8 7.5 9 4.5-1 7.5-4.5 7.5-9V6Z"/>
      }
      @case ('gavel') {
        <path d="m14 4 6 6-3 3-6-6Z"/>
        <path d="m8 10 6 6-3 3-6-6Z"/>
        <path d="M11 7 7 11"/>
        <path d="M16 12l-4 4"/>
        <path d="M4 22h16"/>
      }
      @case ('description') {
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/>
        <path d="M14 3v5h5"/>
        <path d="M9 13h6M9 17h6M9 9h2"/>
      }
      @case ('smart_toy') {
        <rect x="4" y="8" width="16" height="12" rx="2"/>
        <path d="M12 4v4"/>
        <circle cx="12" cy="3.5" r="1"/>
        <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/>
        <path d="M9 17h6"/>
        <path d="M4 12H2M22 12h-2"/>
      }
      @case ('public') {
        <circle cx="12" cy="12" r="9"/>
        <path d="M3 12h18"/>
        <path d="M12 3a13 13 0 0 1 0 18"/>
        <path d="M12 3a13 13 0 0 0 0 18"/>
      }
      @case ('devices') {
        <rect x="3" y="5" width="13" height="10" rx="1.5"/>
        <rect x="17" y="9" width="4" height="10" rx="1"/>
        <path d="M6 19h8"/>
      }
      @case ('settings') {
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.18.66.47.85.83.2.36.27.76.22 1.17"/>
      }
      @case ('error_outline') {
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 8v5"/>
        <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none"/>
      }
      @case ('warning') {
        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/>
        <path d="M12 9v4"/>
        <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none"/>
      }
      @case ('block') {
        <circle cx="12" cy="12" r="9"/>
        <path d="M5.64 5.64 18.36 18.36"/>
      }
      @case ('sync') {
        <path d="M21 12a9 9 0 0 0-15.5-6.2L3 8"/>
        <path d="M3 4v4h4"/>
        <path d="M3 12a9 9 0 0 0 15.5 6.2L21 16"/>
        <path d="M21 20v-4h-4"/>
      }
      @case ('sync_disabled') {
        <path d="M21 12a9 9 0 0 0-12.5-8.3"/>
        <path d="M3 4v4h4"/>
        <path d="M3 12a9 9 0 0 0 12.5 8.3"/>
        <path d="M21 20v-4h-4"/>
        <path d="m4 4 16 16"/>
      }
      @case ('open_in_new') {
        <path d="M14 4h6v6"/>
        <path d="M10 14 20 4"/>
        <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>
      }
      @case ('replay') {
        <path d="M4 4v6h6"/>
        <path d="M4 10a8 8 0 1 1 2.3 5.66"/>
      }
      @case ('lock') {
        <rect x="4" y="11" width="16" height="10" rx="2"/>
        <path d="M8 11V7a4 4 0 1 1 8 0v4"/>
      }
      @case ('history') {
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
        <path d="M3 4v4h4"/>
        <path d="M12 7v5l3 2"/>
      }
      @case ('refresh') {
        <path d="M21 12a9 9 0 1 1-3-6.7"/>
        <path d="M21 3v6h-6"/>
      }
      @case ('download') {
        <path d="M12 4v12"/>
        <path d="m7 11 5 5 5-5"/>
        <path d="M5 20h14"/>
      }
      @case ('table_chart') {
        <rect x="3.5" y="4" width="17" height="16" rx="2"/>
        <path d="M3.5 10h17M3.5 15h17M9 10v10M15 10v10"/>
      }
      @case ('view_list') {
        <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
        <path d="M8 9h10M8 12h10M8 15h10"/>
        <circle cx="5.5" cy="9" r="0.8" fill="currentColor" stroke="none"/>
        <circle cx="5.5" cy="12" r="0.8" fill="currentColor" stroke="none"/>
        <circle cx="5.5" cy="15" r="0.8" fill="currentColor" stroke="none"/>
      }
      @case ('policy') {
        <path d="M12 3 4.5 6v6c0 4.5 3 8 7.5 9 4.5-1 7.5-4.5 7.5-9V6Z"/>
        <path d="m9 12 2 2 4-4"/>
      }
      @case ('close') {
        <path d="M6 6l12 12M6 18 18 6"/>
      }
      @case ('check') {
        <path d="m5 12 5 5L20 7"/>
      }
      @case ('chevron_right') {
        <path d="m9 6 6 6-6 6"/>
      }
    }
  </svg>`,
  styles: [`:host{display:inline-flex;align-items:center;justify-content:center;line-height:0}svg{display:block}`],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size = 20;
}
