import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'design-system',
    loadComponent: () =>
      import('./pages/design-system/design-system.page').then((m) => m.DesignSystemPage),
  },
  {
    path: '',
    redirectTo: 'design-system',
    pathMatch: 'full',
  },
];
