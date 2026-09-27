import { expect, test } from '@playwright/test';
import { customer, expectAccessible, login, UNUSED_CLABE } from './support';

test.describe('inicio de sesión', () => {
  test('la página de entrada es accesible y explica por qué se cerró la sesión', async ({ page }) => {
    await page.goto('/entrar?motivo=inactividad');
    await expect(page.getByRole('heading', { name: 'Entra a tu banca en línea' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'inactividad' })).toBeVisible();
    await expectAccessible(page, '/entrar');
  });

  test('sin sesión, las páginas de la banca redirigen a /entrar', async ({ page }) => {
    await page.goto('/inicio');
    await expect(page).toHaveURL(/\/entrar\?motivo=expirada$/);
  });

  test('la cookie de sesión es HttpOnly y SameSite=Strict, y la página lleva CSP con nonce', async ({ page, context }) => {
    const ana = await customer('cookie', 100);
    await login(page, ana.sub);
    const sid = (await context.cookies()).find((c) => c.name.endsWith('ambar_sid'));
    expect(sid).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

    const res = await page.goto('/inicio');
    const csp = res!.headers()['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res!.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('inicio', () => {
  test('muestra saldo, CLABE y movimientos, y es accesible', async ({ page }) => {
    const ana = await customer('inicio', 1_250);
    await login(page, ana.sub);

    await expect(page.getByRole('heading', { name: 'Saldo disponible' })).toBeVisible();
    await expect(page.locator('.balance .amount-xl')).toContainText('$1,250');
    await expect(page.getByText('999 180', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Depósito de prueba')).toBeVisible();
    await expectAccessible(page, '/inicio');
  });

  test('un usuario nuevo puede abrir su cuenta', async ({ page }) => {
    await login(page, `e2e-nuevo-${Date.now()}`);
    await page.getByRole('button', { name: 'Abrir mi cuenta' }).click();
    await expect(page).toHaveURL(/\/cuentas\/[0-9a-f-]{36}\?nueva=1$/);
    await expect(page.getByRole('status').filter({ hasText: 'Tu cuenta está lista' })).toBeVisible();
  });

  test('la cuenta de otro usuario no existe para mí (BOLA)', async ({ page }) => {
    const ana = await customer('bola-ana', 500);
    const intruso = await customer('bola-intruso');
    await login(page, intruso.sub);
    const res = await page.goto(`/cuentas/${ana.account.id}`);
    expect(res!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'No encontramos esa página' })).toBeVisible();
    await expect(page.getByText('$500')).toHaveCount(0);
  });
});

test.describe('transferencias', () => {
  test('flujo completo: datos, confirmación, comprobante y saldo actualizado en ambos lados', async ({ page, browser }) => {
    const ana = await customer('ana', 500);
    const luis = await customer('luis');
    await login(page, ana.sub);

    await page.getByRole('link', { name: 'Transferir', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Transferir' })).toBeVisible();
    await expectAccessible(page, '/transferir paso 1');

    await page.getByLabel('CLABE de destino').fill(luis.account.clabe);
    await page.getByLabel('Monto').fill('120.50');
    await page.getByLabel('Concepto').fill('Pizza del viernes');
    await page.getByRole('button', { name: 'Continuar' }).click();

    await expect(page.getByRole('heading', { name: 'Confirma tu transferencia' })).toBeFocused();
    await expect(page.getByText('$379.50')).toBeVisible(); // saldo después
    await expectAccessible(page, '/transferir paso 2');
    await page.getByRole('button', { name: 'Confirmar y enviar' }).click();

    await expect(page.getByRole('heading', { name: 'Transferencia enviada' })).toBeFocused();
    const folio = await page.locator('dt:text("Folio") + dd').textContent();
    expect(folio).toMatch(/^[0-9a-f-]{36}$/);
    await expectAccessible(page, '/transferir comprobante');

    await page.getByRole('link', { name: 'Ver movimientos' }).click();
    await expect(page.locator('.balance .amount-xl')).toContainText('$379');
    await expect(page.getByText('Pizza del viernes')).toBeVisible();
    await expectAccessible(page, '/cuentas/[id]');

    const luisContext = await browser.newContext();
    const luisPage = await luisContext.newPage();
    await login(luisPage, luis.sub);
    await expect(luisPage.locator('.balance .amount-xl')).toContainText('$120');
    await expect(luisPage.getByText('Pizza del viernes')).toBeVisible();
    await luisContext.close();
  });

  test('valida en el navegador: CLABE con verificador incorrecto, saldo insuficiente y concepto vacío', async ({ page }) => {
    const ana = await customer('validar', 100);
    await login(page, ana.sub);
    await page.goto('/transferir');

    await page.getByLabel('CLABE de destino').fill('999180000000000019'); // verificador correcto sería 5
    await page.getByLabel('Monto').fill('150');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // `main` excluye el anunciador de rutas de Next.js, que también tiene role=alert.
    const summary = page.getByRole('main').getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Revisa 3 datos');
    await expect(summary).toContainText('último dígito no coincide');
    await expect(summary).toContainText('Tu saldo disponible es $100.00');
    await expect(summary).toContainText('Escribe un concepto');
    await expect(page.getByLabel('CLABE de destino')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, '/transferir con errores');

    await summary.getByRole('link', { name: 'Monto' }).click();
    await expect(page.getByLabel('Monto')).toBeFocused();
  });

  test('un error del core regresa al campo correcto: CLABE válida que no existe en Ámbar', async ({ page }) => {
    const ana = await customer('noexiste', 100);
    await login(page, ana.sub);
    await page.goto('/transferir');
    await page.getByLabel('CLABE de destino').fill(UNUSED_CLABE);
    await page.getByLabel('Monto').fill('10');
    await page.getByLabel('Concepto').fill('Prueba');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Confirmar y enviar' }).click();

    await expect(page.getByRole('heading', { name: 'Transferir' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('No encontramos una cuenta Ámbar con esa CLABE');
    await expect(page.getByLabel('Monto')).toHaveValue('10'); // no se pierde lo capturado
  });

  test('se puede transferir solo con teclado', async ({ page }) => {
    const ana = await customer('teclado', 200);
    const luis = await customer('teclado-destino');
    await login(page, ana.sub);
    await page.goto('/transferir');

    await page.getByLabel('Cuenta de origen').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.type(luis.account.clabe);
    await page.keyboard.press('Tab'); // el texto de ayuda no es enfocable: el siguiente es el monto
    await expect(page.getByLabel('Monto')).toBeFocused();
    await page.keyboard.type('25');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Con teclado');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Confirma tu transferencia' })).toBeFocused();

    await page.getByRole('button', { name: 'Confirmar y enviar' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Transferencia enviada' })).toBeFocused();
  });
});

test.describe('sesión', () => {
  test('avisa antes de cerrar por inactividad y permite seguir conectado', async ({ page }) => {
    const ana = await customer('inactiva', 10);
    await page.clock.install();
    await login(page, ana.sub);
    await expect(page.getByRole('heading', { name: 'Saldo disponible' })).toBeVisible();

    await page.clock.fastForward('14:05'); // la sesión vence a los 15 min
    const dialog = page.getByRole('dialog', { name: '¿Sigues ahí?' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page, 'aviso de inactividad');
    await dialog.getByRole('button', { name: 'Seguir conectado' }).click();
    await expect(dialog).toBeHidden();
  });

  test('cerrar sesión invalida la sesión en el servidor, no solo la cookie', async ({ page, browser, context }) => {
    const ana = await customer('salir', 10);
    await login(page, ana.sub);
    const stolen = (await context.cookies()).filter((c) => c.name.endsWith('ambar_sid'));

    await page.getByRole('button', { name: 'Salir' }).first().click();
    await expect(page).toHaveURL(/\/entrar\?motivo=salida$/);

    // Reusar la cookie anterior en otro navegador ya no da acceso.
    const other = await browser.newContext();
    await other.addCookies(stolen);
    const otherPage = await other.newPage();
    await otherPage.goto('/inicio');
    await expect(otherPage).toHaveURL(/\/entrar/);
    await other.close();
  });

  test('rechaza POST de otro origen (CSRF) en los endpoints de sesión', async ({ request }) => {
    const res = await request.post('/api/auth/logout', { headers: { Origin: 'https://sitio-malicioso.example' } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });
});

test.describe('móvil @movil', () => {
  test('la barra inferior navega y la transferencia cabe en pantalla', async ({ page }) => {
    const ana = await customer('movil', 300);
    await login(page, ana.sub);
    const tabbar = page.getByRole('navigation', { name: 'Secciones' }).last();
    await expect(tabbar).toBeVisible();
    await tabbar.getByRole('link', { name: 'Transferir' }).click();
    await expect(page.getByRole('heading', { name: 'Transferir' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await expectAccessible(page, '/transferir en móvil');
  });
});
