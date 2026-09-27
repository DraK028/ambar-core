import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra el stack local completo: Postgres + Ledger (tokens locales, endpoints de QA) + Asistente + Banca Web.
 * En CI levanta ambos servidores; en tu máquina reutiliza los que ya tengas corriendo.
 */
const LOCAL_JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? 'e2e-local-secret-with-at-least-32-characters';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://ambar:ambar_local@localhost:5432/ambar';
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'movil', use: { ...devices['Pixel 7'] }, grep: /@movil/ },
  ],
  webServer: [
    {
      command: 'npm run start',
      cwd: '../../services/ledger',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL,
        LOCAL_JWT_SECRET,
        MIGRATE_ON_START: 'true',
        ENABLE_QA_ENDPOINTS: 'true',
        PORT: '3000',
      },
    },
    {
      // Asistente con el modelo guionado (sin AWS): prueba el flujo completo de la interfaz.
      command: 'npm run start',
      cwd: '../../services/assistant',
      url: 'http://localhost:3002/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { LOCAL_JWT_SECRET, CORE_API_URL: 'http://localhost:3000', PORT: '3002', LOG_AUDIT: 'false' },
    },
    {
      command: 'npx next start --port 3001',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        APP_URL: 'http://localhost:3001',
        LEDGER_API_URL: 'http://localhost:3000',
        ASSISTANT_API_URL: 'http://localhost:3002',
        AUTH_PROVIDER: 'local',
        LOCAL_JWT_SECRET,
        SESSION_SECRET: 'e2e-web-session-secret-with-32-chars-min',
        SHOW_DEMO_USERS: 'true',
      },
    },
  ],
});
