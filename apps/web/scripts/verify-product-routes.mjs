import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DEV_URL || 'http://127.0.0.1:5276';
const output = fileURLToPath(new URL('../../../test-evidence/rotas-produto/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push({ url: page.url(), message: e.message }));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  await page.getByLabel('E-mail ou usuário').fill('revisao@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('somente-dev');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/companies');
  await page.goto(base + '/companies?visao=tabela');
  await page.getByRole('button', { name: /^Acessar / }).first().click();
  await page.waitForURL('**/companies/*/anotacoes');
  const companyId = new URL(page.url()).pathname.split('/')[2];
  console.log('COMPANY', companyId);
  const tabs = ['anotacoes', 'documentos', 'notas-fiscais', 'cadastro-fiscal', 'guides', 'sitfis', 'planejamento', 'lancamentos', 'circular', 'parcelamento', 'relatorios'];
  const selected = process.env.ROUTE_FILTER?.split(',');
  const routes = [...tabs.map(tab => ['/companies/' + companyId + '/' + tab, tab]), ['/onboardings', 'onboardings'], ['/suporte', 'suporte'], ['/companies?visao=operacoes', 'operacoes']].filter(([, name]) => !selected || selected.includes(name));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const [route, name] of routes) {
      await page.goto(base + route);
      await page.waitForTimeout(1800);
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.trim().length > 230 && !/Carregando\.\.\.$/.test(text.trim());
      }, null, { timeout: 45000 }).catch(() => {});
      const body = await page.locator('body').innerText();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await page.screenshot({ path: output + '/' + name + '-' + width + '.png', fullPage: true });
      results.push({ route, width, overflow, blank: !body.trim(), loadingOnly: /Carregando\.\.\.$/.test(body.trim()), text: body.slice(0, 12000) });
      console.log(name, width, 'overflow', overflow, 'length', body.length);
    }
  }
  await writeFile(output + (selected ? '/results-' + selected.join('-') + '.json' : '/results.json'), JSON.stringify({ companyId, results, errors }, null, 2));
  if (errors.length || results.some(r => r.blank || r.overflow || r.loadingOnly)) process.exitCode = 1;
} finally { await browser.close(); }
