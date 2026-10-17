import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5276';
const dir = fileURLToPath(new URL('../../../test-evidence/revisao-produto/', import.meta.url));
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const results = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base + '/revisao-dev.html');
  await page.getByRole('button', { name: 'Reiniciar cenário' }).click();
  const capture = async (name) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await page.screenshot({ path: dir + '/' + name + '.png', fullPage: true });
    results.push({ name, overflow });
    assert.equal(overflow, false, name + ': overflow');
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.getByRole('button', { name: 'Empresas', exact: true }).click();
    await page.getByLabel('Estado de teste').selectOption('normal');
    await capture('empresas-' + width);
    await page.getByRole('button', { name: /Guias de Horizonte.*3\/4 disponíveis/ }).click();
    await capture('empresas-detalhe-' + width);
    await page.getByRole('button', { name: /Guias de Horizonte.*3\/4 disponíveis/ }).click();
    for (const state of ['vazio', 'erro', 'carregando']) {
      await page.getByLabel('Estado de teste').selectOption(state);
      await capture('empresas-' + state + '-' + width);
    }
    await page.getByLabel('Estado de teste').selectOption('normal');
    await page.getByRole('button', { name: 'Operações', exact: true }).click();
    await page.getByRole('button', { name: /Guias faltantes 2/ }).waitFor();
    await capture('operacoes-' + width);
    await page.getByRole('button', { name: /Envios pendentes 1/ }).click();
    assert.equal(await page.getByRole('region', { name: 'Fila de trabalho' }).locator('li').count(), 1);
    await capture('operacoes-fila-' + width);
    await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await capture('operacoes-detalhe-' + width);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Limpar filtro' }).click();
    for (const state of ['vazio', 'erro', 'carregando']) {
      await page.getByLabel('Estado de teste').selectOption(state);
      await capture('operacoes-' + state + '-' + width);
    }
    await page.getByLabel('Estado de teste').selectOption('normal');
  }
  await page.getByRole('button', { name: 'Simular quarta guia validada' }).click();
  await page.getByRole('button', { name: /Envios pendentes 2/ }).waitFor();
  await page.getByRole('button', { name: 'Empresas', exact: true }).click();
  await page.getByRole('button', { name: /Guias de Horizonte.*4\/4 disponíveis/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Guias de Horizonte.*4\/4 disponíveis/ }).waitFor();
  await page.getByRole('button', { name: 'Operações', exact: true }).click();
  await page.getByRole('button', { name: /Erros de envio de guias 1/ }).click();
  await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click();
  await page.getByRole('button', { name: 'Conferir novo envio', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  await page.getByText('Envio simulado confirmado. Nenhuma mensagem foi enviada.').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Erros de envio de guias 0/ }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(dir + '/results.json', JSON.stringify({ results, errors, integrated: 'document validation, queue, simulated send and browser reload passed; local fixture only' }, null, 2));
  console.log(JSON.stringify({ captures: results.length, errors, integrated: true }));
} finally { await browser.close(); }

