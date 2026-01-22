import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  server: {
    fs: {
      // Allow importing prompt/key from ../api (client-only Mistral pane).
      allow: [
        // Always allow serving the client app itself.
        fileURLToPath(new URL('.', import.meta.url)),
        // Allow importing prompt/key from ../api.
        fileURLToPath(new URL('../api', import.meta.url)),
      ]
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
