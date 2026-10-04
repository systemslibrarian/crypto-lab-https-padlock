import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The repo name, read from the repo itself rather than guessed: GitHub Pages
  // serves this lab under a project subpath, so a wrong base 404s every asset.
  base: '/crypto-lab-https-padlock/',
  // PEM fixtures are imported as strings. They are the lab's subject matter --
  // real certificate bytes -- so they ship in the bundle rather than being
  // fetched, which keeps the lab working with no network at all.
  assetsInclude: ['**/*.pem'],
  test: {
    // e2e/ holds Playwright specs. Vitest must not collect them.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
