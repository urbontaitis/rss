import { fileURLToPath } from 'node:url'
import { mockSupabase, signIn, SUPABASE_URL } from './mockSupabase'
import { expect, test } from './test'

test('rejects wrong credentials', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('./')
  await page.getByLabel('Project URL').fill(SUPABASE_URL)
  await page.getByLabel('Publishable (anon) key').fill('anon-key')
  await page.getByLabel('Email').fill('me@example.org')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid login credentials')).toBeVisible()
})

test('subscribes, filters, reads and stars entries', async ({ page }) => {
  const state = await mockSupabase(page)
  await page.addInitScript(() => {
    if (!localStorage.getItem('rss.seeded')) {
      localStorage.setItem('rss.seeded', '1')
      localStorage.setItem('rss.settings', JSON.stringify({ imageProxyMode: 'all', imageProxyTemplate: 'https://images.example/?url={encoded}' }))
    }
  })
  await signIn(page)
  await expect(page.getByText('There are no unread entries.')).toBeVisible()

  await page.getByRole('link', { name: 'Feeds', exact: true }).click()
  await page.getByRole('link', { name: 'Add subscription' }).click()
  await page.getByLabel('URL').fill('blog.example')
  await page.getByRole('button', { name: 'Find a subscription' }).click()

  await expect(page.getByRole('heading', { name: /Blog/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Blog first post' })).toBeVisible()
  await expect(page.getByText('Sponsored Blog')).toHaveCount(0)
  expect(state.feeds[0]).toMatchObject({ feed_url: 'https://blog.example/feed.xml', title: 'Blog' })
  await expect(page.getByRole('navigation').getByText('(2)')).toBeVisible()

  await page.getByRole('link', { name: 'Blog first post' }).click()
  await expect(page.getByRole('heading', { name: 'Blog first post' })).toBeVisible()
  const image = page.locator('.entry-content img')
  await expect(image).toHaveAttribute('src', 'https://images.example/?url=https%3A%2F%2Fblog.example%2Fpic.jpg')
  await expect(image).not.toHaveAttribute('onerror', /.*/)
  expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined()
  await expect(page.getByRole('button', { name: 'Mark as unread' })).toBeVisible()
  expect(state.entries.find((entry) => entry.title === 'Blog first post')?.status).toBe('read')

  await page.getByRole('button', { name: '☆ Star' }).click()
  await expect(page.getByRole('button', { name: '★ Unstar' })).toBeVisible()
  await page.getByRole('link', { name: 'Starred' }).click()
  await expect(page.getByRole('link', { name: 'Blog first post' })).toBeVisible()

  await page.getByRole('link', { name: /^Unread/ }).click()
  await expect(page.getByRole('link', { name: 'Blog second post' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Mark all as read' }).click()
  await expect(page.getByText('There are no unread entries.')).toBeVisible()
})

test('imports OPML into categories and supports keyboard navigation', async ({ page }) => {
  const state = await mockSupabase(page)
  await signIn(page)
  await page.goto('./#/opml')
  await page.getByLabel('OPML file').setInputFiles(fileURLToPath(new URL('./fixtures/feeds.opml', import.meta.url)))
  await expect(page.getByText('2 feed(s) in 2 categories found.')).toBeVisible()
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByText('Imported 2 new feed(s), 0 already existed.')).toBeVisible()
  expect(state.categories.map((category) => category.title)).toEqual(['Cycling', 'Dev'])

  await page.getByRole('link', { name: /^Unread/ }).click()
  await expect(page.locator('.item')).toHaveCount(4)
  await page.keyboard.press('j')
  await expect(page.locator('.item.selected')).toHaveCount(1)
  const selected = await page.locator('.item.selected .item-title a').textContent()
  await page.keyboard.press('o')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(selected as string)
  await page.keyboard.press('u')
  await expect(page.locator('.item')).toHaveCount(3)

  await page.keyboard.press('?')
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('edits feed rules and previews them', async ({ page }) => {
  const state = await mockSupabase(page)
  await signIn(page)
  await page.goto('./#/feeds/add')
  await page.getByLabel('URL').fill('https://news.example/feed')
  await page.getByRole('button', { name: 'Find a subscription' }).click()
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Block rules').fill('EntryTitle=second')
  await page.getByRole('button', { name: 'Preview filters' }).click()
  await expect(page.getByText('✗ News second post')).toBeVisible()
  await expect(page.getByText('✓ News first post')).toBeVisible()
  await page.getByRole('button', { name: 'Update' }).click()
  await expect(page.getByRole('link', { name: 'Show all entries' })).toBeVisible()
  expect(state.feeds[0].block_filter_entry_rules).toBe('EntryTitle=second')
})
