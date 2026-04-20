import { Injectable, signal } from '@angular/core';

export interface ErrorToast {
  readonly id: number;
  readonly message: string;
  readonly at: number;
}

/**
 * Tiny signal-based error bus. Components subscribe to `.toasts()`; the
 * global HTTP interceptor pushes messages. Toasts auto-expire after
 * TOAST_TTL_MS so the UI doesn't grow unbounded.
 */
@Injectable({ providedIn: 'root' })
export class ErrorBusService {
  private readonly TOAST_TTL_MS = 6000;
  private readonly MAX_TOASTS = 5;
  private nextId = 1;
  readonly toasts = signal<ErrorToast[]>([]);

  push(message: string): void {
    const toast: ErrorToast = { id: this.nextId++, message, at: Date.now() };
    const next = [...this.toasts(), toast].slice(-this.MAX_TOASTS);
    this.toasts.set(next);
    setTimeout(() => this.dismiss(toast.id), this.TOAST_TTL_MS);
  }

  dismiss(id: number): void {
    this.toasts.set(this.toasts().filter((t) => t.id !== id));
  }
}
