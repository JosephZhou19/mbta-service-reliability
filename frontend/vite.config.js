import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so this works regardless of what the GitHub Pages repo/project
  // path ends up being (username.github.io/<repo>/) without hardcoding a repo name
  // here. Revisit if a custom domain or root-level repo makes an absolute base cleaner.
  base: './',
  plugins: [react()],
})
