import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      // The pipeline is WebGL2; there is nothing meaningful to assert about it
      // in a fake DOM. These run in a real browser, headless.
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: [
            // Headless Chromium has no GPU, so ANGLE is pointed at its software
            // rasteriser. Slower than hardware, same results.
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
    include: ['tests/**/*.test.ts'],
  },
})
