import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export type AppAlertType = 'success' | 'danger' | 'info' | 'warning';

@Component({
  selector: 'app-alert',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alert.component.html'
})
export class AlertComponent {
  @Input() type: AppAlertType = 'info';
  @Input() message = '';
  @Input() dismissible = false;
  @Input() showIcon = true;
  @Input() ariaLive: 'polite' | 'assertive' = 'polite';
  @Output() closed = new EventEmitter<void>();

  get hasMessage(): boolean {
    return !!this.message && this.message.trim().length > 0;
  }

  close(): void {
    this.closed.emit();
  }
}
