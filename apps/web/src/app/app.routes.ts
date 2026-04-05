import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./components/chat/chat.component').then((m) => m.ChatComponent),
  },
  {
    path: 'design-system',
    loadComponent: () =>
      import('./pages/design-system/design-system.page').then((m) => m.DesignSystemPage),
  },
];
