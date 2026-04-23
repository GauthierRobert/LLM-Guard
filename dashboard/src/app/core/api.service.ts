import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { LLMGuardEvent, StatsResponse } from './schema.generated';

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export interface DeviceRow {
  id: string;
  userHint: string | null;
  extensionVersion: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  revoked: boolean;
  eventCount24h: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  stats(range: TimeRange = '24h'): Observable<StatsResponse> {
    return this.http.get<StatsResponse>(`${this.base}/v1/stats`, { params: { range } });
  }

  events(params: { limit?: number; offset?: number; severity?: string; llm?: string; action?: string; range?: TimeRange } = {}): Observable<{
    items: LLMGuardEvent[];
    limit: number;
    offset: number;
  }> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<string, string | number>;
    return this.http.get<{ items: LLMGuardEvent[]; limit: number; offset: number }>(`${this.base}/v1/events`, {
      params: clean as Record<string, string | number>,
    });
  }

  devices(): Observable<DeviceRow[]> {
    return this.http.get<DeviceRow[]>(`${this.base}/v1/devices`);
  }

  revokeDevice(id: string): Observable<{ id: string; revoked: boolean }> {
    return this.http.post<{ id: string; revoked: boolean }>(`${this.base}/v1/devices/${encodeURIComponent(id)}/revoke`, {});
  }
}
