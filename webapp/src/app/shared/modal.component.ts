import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modal.component.html'
})
export class ModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() showClose = true;
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Output() closed = new EventEmitter<void>();

  onBackdropClick(): void {
    if (this.closeOnBackdrop) {
      this.closed.emit();
    }
  }

  onCloseClick(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.open || !this.closeOnEscape) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    }
  }
}
