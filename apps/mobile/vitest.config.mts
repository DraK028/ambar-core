import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Solo lógica pura (sin React Native): flujo de transferencia, tokens, errores, sesión.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
