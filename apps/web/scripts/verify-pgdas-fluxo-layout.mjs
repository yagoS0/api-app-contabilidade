import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DESIGN_BASE_URL || 'http://127.0.0.1:5198';
assert.equal(new URL(base).hostname, '127.0.0.1');
const dir = fileURLToPath(new URL('../../../test-evidence/pgdas-fluxo/', import.meta.url));
await mkdir(dir, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDom from '/node_modules/.vite/deps/react-dom_client.js';
import {ApuracaoV2Tab} from '/src/features/apuracao-v2/pages/renderApuracaoV2Tab.jsx';
import '/src/index.css'; import '/src/App.css';
const h=React.createElement;
const pa='2026-10', companyId='sintetica-pgdas';
function App(){
 const [cenario,setCenario]=React.useState('externa');
 const api=React.useMemo(()=>{
  const incerto=cenario==='incerto', pendente=cenario==='pendente';
  const fluxo={transmissao:{estado:incerto?'RESULTADO_INCERTO':'TRANSMITIDA',confirmada:!incerto&&!pendente,origem:pendente||incerto?null:'EXTERNA',numeroDeclaracao:pendente||incerto?null:'202610-SINTETICA'},documentos:{guia:{estado:cenario==='zero'?'NAO_DEVIDO':'PENDENTE'},extrato:{estado:pendente||incerto?'PENDENTE':'DISPONIVEL'}},pagamento:{estado:'NAO_CONFIRMADO'}};
  let marcada=false;
  const dados=()=>({estado:incerto?'erro_transmissao':'calculada',regime:'SIMPLES',cadastroCompleto:true,faturamento:{total:10000,interno:10000,externo:0},regimeApuracao:'COMPETENCIA',atividades:[],entregaPgdas:{declaradaForaEm:marcada?'2026-11-18':null},fluxoPgdas:fluxo});
  return {getFechamento:async()=>({ok:true,dados:dados()}),getApuracaoSnapshot:async()=>({snapshot:null}),getRelatorioFaturamento:async()=>({relatorio:null}),registrarEntregaPgdasExterna:async()=>{marcada=true;return {ok:true};},recuperarDocumentosPgdas:async()=>({ok:false,partial:true,documentos:fluxo.documentos}),syncPgdasCircular:async()=>({ok:false,message:'Consulta externa bloqueada nesta inspeção'}),conferirTransmissaoFechamento:async()=>({ok:true,result:{confirmada:false,mensagem:'Resultado ainda incerto'}})};
 },[cenario]);
 return h('main',{style:{padding:16}},h('p',null,'INSPEÇÃO LOCAL · dados sintéticos · rede externa bloqueada'),h('label',null,'Cenário de teste ',h('select',{value:cenario,onChange:e=>setCenario(e.target.value)},['externa','pendente','incerto','zero'].map(v=>h('option',{key:v,value:v},v)))),h('h1',null,'Apuração · Empresa sintética'),h(ApuracaoV2Tab,{key:cenario,api,companyId,competencia:pa,razao:'Empresa sintética',panel:{pendencias:[]},feedback:{notifyError:()=>{}},myRole:'ACCOUNTANT'}));
}
ReactDom.createRoot(document.getElementById('root')).render(h(App));`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const results = [], errors = [], blocked = [];
try {
 const page = await browser.newPage();
 page.on('pageerror', e => errors.push(e.message));
 await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) { blocked.push(url.origin); return route.abort(); }
  if (url.pathname === '/src/dev/reforma.jsx') return route.fulfill({ contentType: 'application/javascript', body: fixture });
  return route.continue();
 });
 await page.goto(base + '/reforma-dev.html');
 await page.getByText('Apuração · Empresa sintética', { exact: true }).waitFor();
 async function capture(name,width){
  await page.setViewportSize({width,height:1000});
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,controlsOutside:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width && (r.left<0||r.right>innerWidth+1);}).length}));
  await page.screenshot({path:dir+'/'+name+'-'+width+'.png',fullPage:!['registro-externo','recuperacao'].includes(name)});
  results.push({name,width,...metrics});
  assert.equal(metrics.overflow,false,name); assert.equal(metrics.controlsOutside,0,name);
 }
 for(const width of [1440,390]){
  for(const state of ['externa','incerto','zero','pendente']){
   await page.getByLabel('Cenário de teste').selectOption(state);
   await page.getByRole('button',{name:'Recuperar DAS e extrato'}).waitFor();
   await capture(state,width);
  }
  await page.getByRole('button',{name:'Registrar apuração realizada fora da Altan'}).click();
  await page.getByRole('dialog',{name:'Registrar apuração externa'}).waitFor();
  for(let i=0;i<8;i++){
   await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))),true,'Foco contido no diálogo');
  }
  await capture('registro-externo',width);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Recuperar DAS e extrato'}).click();
  await page.getByRole('dialog',{name:'Recuperar DAS e extrato'}).waitFor();
  await capture('recuperacao',width);
  await page.keyboard.press('Escape');
 }
 assert.deepEqual(errors,[]);
 await writeFile(dir+'/results.json',JSON.stringify({results,errors,blocked,transport:'somente fixtures locais'},null,2));
 console.log(JSON.stringify({captures:results.length,errors,blocked,dir}));
} catch(error) {
 await writeFile(dir+'/failure.json',JSON.stringify({error:error.message,errors,blocked},null,2));
 throw error;
} finally { await browser.close(); }
