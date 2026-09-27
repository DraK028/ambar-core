import { createPublisher, loadRelayConfig } from './main';

describe('configuración del relay', () => {
  it('por defecto publica en EventBridge y exige el nombre del bus', () => {
    expect(() => loadRelayConfig({})).toThrow(/EVENT_BUS_NAME/);
    const c = loadRelayConfig({ EVENT_BUS_NAME: 'ambar-dev-core' });
    expect(createPublisher(c).name).toBe('eventbridge');
  });

  it('el modo webhook exige URL y secreto, y solo se permite en local', () => {
    expect(() => loadRelayConfig({ RELAY_PUBLISHER: 'webhook' })).toThrow(/N8N_WEBHOOK_BASE_URL[\s\S]*WEBHOOK_SIGNING_SECRET/);
    const env = { RELAY_PUBLISHER: 'webhook', N8N_WEBHOOK_BASE_URL: 'http://127.0.0.1:5678', WEBHOOK_SIGNING_SECRET: 'x'.repeat(32) };
    expect(createPublisher(loadRelayConfig(env)).name).toBe('webhook');
    expect(() => loadRelayConfig({ ...env, APP_ENV: 'prod' })).toThrow(/EventBridge/);
  });
});
