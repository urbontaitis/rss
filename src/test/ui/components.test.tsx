import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeedIcon } from '../../components/FeedIcon'
import { FilterRulesHelp, RewriteRulesHelp, ScraperRulesHelp } from '../../components/RulesHelp'
import { saveSettings } from '../../lib/settings'
import { ShortcutsPage } from '../../pages/Shortcuts'

describe('small components', () => {
  it('renders a feed icon through the proxy and hides broken icons', () => {
    saveSettings({ imageProxyMode: 'all', imageProxyTemplate: 'https://p.org/?u=' })
    const { container, rerender } = render(<FeedIcon url="https://a.org/favicon.ico" />)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toHaveAttribute('src', 'https://p.org/?u=https%3A%2F%2Fa.org%2Ffavicon.ico')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.placeholder')).toBeInTheDocument()
    rerender(<FeedIcon url="" />)
    expect(container.querySelector('.placeholder')).toBeInTheDocument()
  })

  it('documents rule syntax', () => {
    render(
      <>
        <FilterRulesHelp />
        <RewriteRulesHelp />
        <ScraperRulesHelp />
      </>,
    )
    expect(screen.getByText('EntryTitle')).toBeInTheDocument()
    expect(screen.getAllByText('EntryDate').length).toBeGreaterThan(1)
    expect(screen.getByText('remove_clickbait')).toBeInTheDocument()
    expect(screen.getByText(/readability algorithm/)).toBeInTheDocument()
  })

  it('lists keyboard shortcuts', () => {
    render(<ShortcutsPage />)
    expect(screen.getByRole('heading', { name: 'Entry list' })).toBeInTheDocument()
    expect(screen.getByText('Fetch original content')).toBeInTheDocument()
  })
})
