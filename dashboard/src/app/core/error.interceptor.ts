import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { ErrorBusService } from './error-bus.service';

/**
 * Global HTTP error interceptor.
 *
 * Catches all 4xx/5xx responses from the backend, pushes a human-readable
 * message onto the ErrorBus (consumed by AppComponent's toast stack), and
 * rethrows so per-component `.subscribe({ error: ... })` handlers still run
 * — many of them set the signal back to `null`, which drives the loading
 * state. Without rethrow, components would stay stuck on "Chargement…".
 *
 * The previous version silently dropped these — users saw a blank dashboard
 * whenever Keycloak expired or the API returned 500.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next): Observable<unknown> => {
  const bus = inject(ErrorBusService);
  return next(req).pipe(
    catchError((err: unknown) => {
      bus.push(formatError(req.url, err));
      return throwError(() => err);
    }),
  ) as Observable<unknown>;
};

function formatError(url: string, err: unknown): string {
  const path = shortUrl(url);
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return `Backend injoignable (${path}). Vérifiez votre connexion.`;
    if (err.status === 401) return `Session expirée (${path}). Veuillez vous reconnecter.`;
    if (err.status === 403) return `Accès refusé (${path}).`;
    if (err.status === 404) return `Ressource introuvable (${path}).`;
    if (err.status === 429) return `Trop de requêtes (${path}). Réessayez dans un instant.`;
    if (err.status >= 500) return `Erreur serveur ${err.status} (${path}). L'équipe a été notifiée.`;
    return `Erreur ${err.status} (${path}): ${err.statusText || 'inconnue'}`;
  }
  return `Erreur inattendue (${path}).`;
}

function shortUrl(u: string): string {
  try {
    return new URL(u, 'http://_').pathname;
  } catch {
    return u;
  }
}
