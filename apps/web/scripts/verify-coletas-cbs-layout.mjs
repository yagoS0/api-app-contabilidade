import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = new URL('../../../test-evidence/coletas-cbs/', import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(process.env.REFORMA_PREVIEW_URL || 'http://127.0.0.1:5201/reforma-dev.html');
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByText('Coleta CBS · Homologação', { exact: true }).click();
  await page.getByText('Demonstração local: nenhuma consulta ou arquivo oficial.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Solicitar coleta de débitos' }).isDisabled(), true);
  // Fixture exclusiva para inspeção visual. Nenhuma API externa ou mutação é chamada.
  await page.route('**/src/api/mock/apuracaoConsumoMock.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function criarApuracaoConsumoMock() { return {
      async getBaseApuracaoConsumo(id, ctx) { return { ok:true, ...ctx, podeEditar:false, capacidades:{}, contribuinte:null }; },
      async getColetasCbs(id, {ambiente}) { return {ok:true,ambiente,capacidades:{abrir:false,consultar:false,baixar:false},bloqueios:[{codigo:'INSPECAO',mensagem:'INSPEÇÃO LOCAL SIMULADA — registros fictícios; serviços externos desativados.'}],coletas:['PENDENTE','INCERTA','ARQUIVADA','EXPIRADA'].map((estado,i)=>({id:'fixture-'+i,ambiente,recurso:i%2?'CREDITOS':'DEBITOS',estado,ticket:i===1?null:'SIMULADO-SEM-VALIDADE-'+i,createdAt:'2026-10-11T12:00:00Z',updatedAt:'2026-10-11T12:05:00Z',arquivos:estado==='ARQUIVADA'?[{id:'arquivo-ficticio',sha256:'a'.repeat(64),tamanhoBytes:1024,contentType:'application/json',createdAt:'2026-10-11T12:05:00Z'}]:[],tentativas:[]}))}; }
    }; }
  ` }));
  await page.reload();
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByText('Coleta CBS · Homologação', { exact: true }).click();
  await page.getByText(/INSPEÇÃO LOCAL SIMULADA/).waitFor();
  await page.getByText('Arquivos armazenados', { exact: true }).click();
  for (const [name,width] of [['desktop',1440],['mobile',390]]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
    await page.screenshot({path:new URL(name+'.png',dir).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: produto offline; fixture local rotulada; desktop/celular sem overflow e sem erros JS.');
} finally {await browser.close();}
