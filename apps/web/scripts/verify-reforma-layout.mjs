import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = fileURLToPath(new URL('../../../test-evidence/reforma-layout/', import.meta.url));
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:5188/reforma-dev.html');
  await page.getByRole('button', { name: 'Adicionar período' }).click();
  await page.getByLabel('Início da vigência', { exact: true }).fill('2027-01-01');
  await page.getByLabel('Fim da vigência (opcional)').fill('2027-06-30');
  await page.getByRole('combobox', { name: /^Regime da empresa/ }).selectOption('SIMPLES');
  await page.getByLabel('Forma de apuração IBS/CBS').selectOption('REGULAR');
  await page.getByRole('combobox', { name: /^Situação/ }).selectOption('SOLICITADA');
  await page.getByLabel('Protocolo ou referência do comprovante').fill('Protocolo fictício para conferir a interface.');
  await page.getByLabel('Motivo da revisão').fill('Registro de demonstração para janeiro de 2027.');
  await page.getByRole('button', { name: 'Registrar revisão' }).click();
  await page.getByText('Revisão registrada no histórico.').waitFor();
  await page.getByText('Reforma tributária · carteira', { exact: true }).click();
  await page.getByRole('link', { name: 'Conferir cadastro' }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Conferir notas' }).getAttribute('href'), /notas-fiscais$/);
  await page.getByText('Verificar conformidade de NFS-e · 2026-10').click();
  await page.getByText('Demonstração: nenhuma nota real foi analisada.').waitFor();
  for (const [nome, width] of [['desktop', 1440], ['mobile', 390]]) {
    await page.setViewportSize({ width, height: 1000 });
    const medidas = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      controlesFora: [...document.querySelectorAll('.reforma input,.reforma select,.reforma textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1); }).length,
    }));
    assert.deepEqual(medidas, { overflow: false, controlesFora: 0 }, nome);
    await page.screenshot({ path: `${dir}/${nome}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: cadastro salvo, histórico, carteira, caminhos reais e estados do verificador; desktop 1440px e mobile 390px sem overflow ou erros de JavaScript.');
} finally { await browser.close(); }
