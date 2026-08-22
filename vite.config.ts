import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative, so the same build works at a domain root, in a project
  // subdirectory like /iris/ on GitHub Pages, or opened straight off disk.
  // Nothing has to know where it will be served from.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
})
