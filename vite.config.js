import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/haunted-terminal/',
  plugins: [react()],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/unit/localStorage.test.js', 'jsdom'],
      ['tests/property/progressPersistence.property.test.js', 'jsdom'],
    ],
  },
})
