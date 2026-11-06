import { mockSupabase, signIn } from './mockSupabase'
import { expect, test } from './test'

test('ships a strict content security policy', async ({ page }) => {
  await page.goto('./')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("base-uri 'none'")
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')
})

test('loads the reader within the JavaScript budget and defers heavy modules', async ({ page }) => {
  await mockSupabase(page)
  const scripts: { url: string; size: number }[] = []
  page.on('response', async (response) => {
    if (response.request().resourceType() === 'script' && response.url().startsWith('http://localhost')) {
      scripts.push({ url: response.url(), size: (await response.body()).length })
    }
  })
  await signIn(page)
  await expect(page.getByText('There are no unread entries.')).toBeVisible()
  const total = scripts.reduce((sum, script) => sum + script.size, 0)
  expect(total).toBeLessThan(650 * 1024)
  expect(scripts.some((script) => /readability|marked/.test(script.url))).toBe(false)
  expect(scripts.some((script) => /Settings|FeedEdit|Opml/.test(script.url))).toBe(false)
})

test('fits the viewport without horizontal scrolling', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)
  for (const path of ['./#/unread', './#/settings', './#/feeds/add']) {
    await page.goto(path)
    await page.locator('h1').first().waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }
})
