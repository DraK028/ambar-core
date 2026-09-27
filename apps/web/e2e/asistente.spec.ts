import { expect, test } from '@playwright/test';
import { customer, expectAccessible, login } from './support';

/** Con el modelo guionado del asistente: las respuestas son deterministas y vienen del core real. */
test.describe('asistente', () => {
  test('responde el saldo con datos del core, dice qué consultó y es accesible', async ({ page }) => {
    const ana = await customer('asistente', 1_250);
    await login(page, ana.sub);
    await page.getByRole('link', { name: 'Asistente' }).first().click();
    await expect(page.getByRole('heading', { name: 'Pregúntale a Ámbar' })).toBeVisible();
    await expectAccessible(page, '/asistente');

    await page.getByRole('button', { name: '¿Cuál es mi saldo?' }).click();
    const log = page.getByRole('log', { name: 'Mensajes' });
    await expect(log.getByText('Tu saldo total es $1,250.00')).toBeVisible();
    await expect(log.getByText('Consulté tus cuentas.')).toBeVisible();
    await expect(log.getByText(`terminación ${ana.account.clabe.slice(-4)}`)).toBeVisible();
    await expectAccessible(page, '/asistente con conversación');
  });

  test('avisa y oculta datos sensibles; no hace operaciones', async ({ page }) => {
    const ana = await customer('asistente-priv', 500);
    await login(page, ana.sub);
    await page.goto('/asistente');

    const input = page.getByLabel('Tu pregunta');
    await input.fill('Transfiere $100 a mi hermano, mi NIP es 4821');
    await input.press('Enter');
    const log = page.getByRole('log', { name: 'Mensajes' });
    await expect(log.getByText('No puedo hacer operaciones por ti', { exact: false })).toBeVisible();
    await expect(log.getByRole('note').filter({ hasText: 'Ámbar nunca te los pedirá' })).toBeVisible();

    // La conversación continúa y se puede borrar.
    await input.fill('¿En qué gasté este mes?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(log.getByText('ingresaron $500.00', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Borrar conversación' }).click();
    await expect(log.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '¿Cuál es mi saldo?' })).toBeVisible();
  });

  test('se usa solo con teclado @movil', async ({ page }) => {
    const ana = await customer('asistente-kbd', 300);
    await login(page, ana.sub);
    await page.goto('/asistente');
    await page.getByLabel('Tu pregunta').focus();
    await page.keyboard.type('¿Tengo avisos?');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log').getByText('aviso(s) sin leer', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Tu pregunta')).toBeFocused();
  });
});
