import { createBrowserRouter, RouteObject } from 'react-router'

import TonoLayout from '@/tono-ui/tono-layout'

import { hiddenRoutes, navItems } from './_navigation'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: TonoLayout,
    children: [
      ...navItems.map(({ path, lazy }): RouteObject => ({ path, lazy })),
      ...hiddenRoutes.map(
        ({ path, Component }): RouteObject => ({ path, Component }),
      ),
    ],
  },
])
