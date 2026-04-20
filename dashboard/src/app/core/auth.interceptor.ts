import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Attach the current user's Keycloak access token to every API request.
 * Stub: reads from localStorage['lg_token']. Replace with a real Keycloak adapter
 * (e.g. keycloak-angular) once SSO is wired up.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (typeof localStorage === 'undefined') return next(req);
  const token = localStorage.getItem('lg_token');
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
