import { defineConfig, loadEnv, type PluginOption } from 'vite';

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [];
  // DEV ONLY: in-memory accounts API (dev/mock-api.ts) — `VITE_MOCK_API=1 npx vite`.
  // Imported dynamically so it is never loaded for `vite build`.
  const env = loadEnv(mode, '.', 'VITE_');
  if (command === 'serve' && env.VITE_MOCK_API === '1') {
    const { mockApi } = await import('./dev/mock-api.ts');
    const latency = env.VITE_MOCK_LATENCY ? Number(env.VITE_MOCK_LATENCY) : undefined;
    plugins.push(mockApi({ latency: Number.isFinite(latency) ? latency : undefined }));
  }
  return {
    plugins,
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
