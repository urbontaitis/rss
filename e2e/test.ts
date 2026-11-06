import { expect, test as base } from '@playwright/test'

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text())
      })
      await use(errors)
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
