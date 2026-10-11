import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = new URL('../../../test-evidence/apuracao-consumo/', import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(process.env.REFORMA_PREVIEW_URL || 'http://127.0.0.1:5199/reforma-dev.html');
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByText('Demonstração: a preparação de IBS/CBS não grava dados e não habilita serviços oficiais.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Vincular esta empresa' }).count(), 0);
  // Fixture exclusivamente deste navegador; o mock de produto continua recusando gravações.
  await page.route('**/src/api/mock/apuracaoConsumoMock.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function criarApuracaoConsumoMock() {
      let config = { versao: 1, habilitado: false, dados: { referenciaContrato: 'Contrato fictício para inspeção de layout' } };
      let revisao = null;
      return {
        async getBaseApuracaoConsumo(id, ctx) { return { ok: true, ...ctx, podeEditar: true,
          contribuinte: { cnpjBase: '00000000', estabelecimentos: [{ id, razao: 'Estabelecimento fictício da inspeção local', cnpj: '00.000.000/0001-00' }] },
          configuracao: config, revisao, desatualizada: true, capacidades: { coletar: false, conferir: false, confirmarOficial: false, emitirGuia: false, consultarPagamento: false } }; },
        async salvarConfiguracaoConsumo(id, p) { config = { ...p, versao: p.versao + 1 }; return { ok: true, configuracao: config }; },
        async prepararRevisaoConsumo(id, p) { revisao = { ...p, versao: p.versao + 1, estado: 'PREPARACAO', dados: { motivo: p.motivo, pendencias: ['COLETA_OFICIAL_NAO_IMPLEMENTADA', 'CREDENCIAL_NAO_REFERENCIADA'] } }; return { ok: true, revisao }; },
      };
    }
  ` }));
  await page.reload();
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByLabel('Motivo da configuração').fill('INSPEÇÃO LOCAL SIMULADA — sem dados ou serviços externos');
  await page.getByLabel(/^Preparação local/).selectOption('sim');
  await page.getByRole('button', { name: 'Salvar preparação local' }).click();
  await page.getByText('Configuração local · versão 2').waitFor();
  await page.getByLabel('Motivo da preparação da competência').fill('INSPEÇÃO LOCAL SIMULADA — revisão fictícia');
  await page.getByRole('button', { name: 'Registrar preparação da competência' }).click();
  await page.getByText(/Última revisão: 1/).waitFor();
  await page.getByText('Disponibilidade dos serviços', { exact: true }).click();
  for (const [nome, width] of [['desktop', 1440], ['mobile', 390]]) {
    await page.setViewportSize({ width, height: 1000 });
    const medidas = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      controlesFora: [...document.querySelectorAll('.reforma input,.reforma select,.reforma textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1); }).length,
    }));
    assert.deepEqual(medidas, { overflow: false, controlesFora: 0 }, nome);
    await page.screenshot({ path: new URL(nome + '.png', dir).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mock de produto indisponível; fixture local salva configuração e revisão; desktop e celular sem overflow nem erros JS.');
} finally { await browser.close(); }
