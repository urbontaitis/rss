import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

export function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

export function renderRoute(element: ReactElement, { path, at = '/' }: { path?: string; at?: string } = {}) {
  const routePath = path ?? at.split('?')[0]
  const user = userEvent.setup()
  const result = render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
  return { user, ...result }
}
