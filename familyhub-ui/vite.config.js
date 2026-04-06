import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load .env so we can inject the API key server-side in the proxy
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_URL || 'http://localhost:8080',
          changeOrigin: true,
          configure: (proxy) => {
            // Inject API key server-side — never sent to the browser
            const apiKey = env.VITE_BACKEND_KEY || ''
            if (apiKey) {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('x-api-key', apiKey)
              })
            }
          },
        },
      },
    },
  }
})
