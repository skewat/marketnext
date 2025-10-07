import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
  // Add your desired hostname to the list of allowed hosts to prevent DNS rebinding attacks.
    host: true,
    allowedHosts: [
      'marketnext.in'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:6123',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
