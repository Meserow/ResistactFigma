import { defineConfig } from 'vite'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
let gitSha = 'dev'
try { gitSha = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
const buildDate = new Date().toISOString().slice(0, 10)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_GIT_SHA__: JSON.stringify(gitSha),
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
  },
  server: {
    port: parseInt(process.env.PORT ?? '5173'),
    strictPort: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'figma-asset-stub',
      resolveId(id) {
        if (id.startsWith('figma:asset/')) return id;
      },
      load(id) {
        if (id.startsWith('figma:asset/')) return 'export default ""';
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})