import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DESIGN_BASE_URL || 'http://127.0.0.1:5194';
assert.equal(new URL(base).hostname, '127.0.0.1', 'A verificação usa somente servidor local mock.');
const dir = fileURLToPath(new URL('../../../test-evidence/design-layout/', import.meta.url));
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const results = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Modo demonstração', { exact: true }).waitFor();
  await page.getByLabel('E-mail ou usuário').fill('design@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('somente-mock');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/companies');
  const routes = [['configuracoes','/configuracoes'], ['atendimento','/configuracoes/atendimento'], ['cadastro','/companies/new'], ['serpro','/firm-settings/guides'], ['plano-contas','/firm-settings/chart'], ['rotinas','/rotinas'], ['comunicados','/whatsapp/comunicados'], ['planejamento','/planejamento']];
  for (const [name, path] of routes) {
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.locator('.office-workspace').waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        controlsOutside: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el => {
          const r = el.getBoundingClientRect();
          // Controles em tabelas largas podem ficar fora da janela, desde que
          // alcançáveis por rolagem local sem alargar a página.
          for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            const bounds = parent.getBoundingClientRect();
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)
              && parent.scrollWidth > parent.clientWidth
              && bounds.left >= -1 && bounds.right <= innerWidth + 1) return false;
          }
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        }).map(el => el.name || el.id || el.outerHTML.slice(0,100)),
      }));
      results.push({ name, width, ...metrics });
      await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  await writeFile(`${dir}/results.json`, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(results.every(r => !r.overflow && !r.controlsOutside.length), 'Confira results.json e as capturas.');
} finally { await browser.close(); }
