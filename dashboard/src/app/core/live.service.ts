import { Injectable, signal } from '@angular/core';

import { LLMGuardEvent } from './schema.generated';

@Injectable({ providedIn: 'root' })
export class LiveService {
  private socket: WebSocket | null = null;
  readonly events = signal<LLMGuardEvent[]>([]);
  readonly connected = signal(false);

  connect(org = 'default'): void {
    if (this.socket || typeof window === 'undefined') return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/v1/live?org=${encodeURIComponent(org)}`;
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.connected.set(true);
    this.socket.onclose = () => {
      this.connected.set(false);
      this.socket = null;
    };
    this.socket.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as LLMGuardEvent;
        this.events.update((curr) => [parsed, ...curr].slice(0, 200));
      } catch {
        /* ignore malformed payloads */
      }
    };
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}
