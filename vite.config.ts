import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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