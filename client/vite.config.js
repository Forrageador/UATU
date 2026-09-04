import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '');

  const livekitTarget = (env.LIVEKIT_URL || '').replace(/^wss:\/\//, 'https://');

  return {
    envDir: '../',
    server: {
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        '/.proxy/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/.proxy/, ''),
        },

        '/.proxy/livekit': {
          target: livekitTarget,
          changeOrigin: true,
          secure: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/.proxy\/livekit/, ''),
        },
      },
      hmr: {
        clientPort: 443,
      },
    },
  };
});