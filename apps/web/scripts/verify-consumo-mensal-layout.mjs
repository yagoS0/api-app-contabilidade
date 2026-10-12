import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = new URL('../../../test-evidence/consumo-mensal/', import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(process.env.REFORMA_PREVIEW_URL || 'http://127.0.0.1:5201/reforma-dev.html');
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByText('Conferência e pagamentos da competência', { exact: true }).click();
  await page.getByText('Demonstração: registros mensais indisponíveis; nenhum ato oficial será realizado.').waitFor();
  await page.getByText('Base declarada e cobertura documental', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Salvar base declarada' }).isDisabled(), true);
  // Fixture exclusivamente no navegador desta inspeção. Produto continua recusando gravações.
  await page.route('**/src/api/mock/apuracaoConsumoMock.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function criarApuracaoConsumoMock() {
      let versao = 0, estado = 'EM_CONFERENCIA', guias = [], pagamentos = [], alocacoes = [], historico = [];
      const evidencia = { referencia:'INSPEÇÃO LOCAL SIMULADA',sha256:'a'.repeat(64),descricao:'Documento fictício para inspeção de layout' };
      const dto = ctx => ({ok:true,...ctx,contextoHash:'b'.repeat(64),versao,estado,estabelecimentos:[{id:'local',razao:'Empresa fictícia da inspeção'}],podeConferir:true,pendenciasCalculadas:[],capacidades:{editar:true,conferirLocal:true,emitirGuia:false,confirmarOficial:false,consultarPagamento:false},valoresOficiais:null,dados:{valoresDeclarados:{debitosCentavos:'10000',creditosCentavos:'2500'},tratamento:{tipo:'REGULAR_PADRAO'},cobertura:{inicio:ctx.competencia+'-01',fim:ctx.competencia+'-30',estabelecimentoIds:['local'],recursos:['DEBITOS','CREDITOS'],evidencia},pendencias:[],guias,pagamentos,alocacoes}});
      return {
        async getBaseApuracaoConsumo(id,ctx) {return {ok:true,...ctx,podeEditar:false,contribuinte:null,capacidades:{}};},
        async getMensalConsumo(id,ctx) {return dto(ctx);},
        async getHistoricoMensalConsumo(id,ctx) {return {ok:true,...ctx,historico,truncado:false};},
        async registrarAcaoMensalConsumo(id,p) {
          if(p.acao==='CONFERIR_LOCAL') estado='CONFERIDA_LOCAL';
          if(p.acao==='REGISTRAR_GUIA') guias=[{...p.dados,id:'guia-ficticia',alocadoCentavos:'0',saldoCentavos:p.dados.valorCentavos}];
          if(p.acao==='REGISTRAR_PAGAMENTO') pagamentos=[{...p.dados,id:'pagamento-ficticio',alocadoCentavos:'0',saldoCentavos:p.dados.valorCentavos}];
          if(p.acao==='ALOCAR') {alocacoes=[{...p.dados,id:'alocacao-ficticia'}];guias=guias.map(g=>({...g,alocadoCentavos:p.dados.valorCentavos,saldoCentavos:String(BigInt(g.valorCentavos)-BigInt(p.dados.valorCentavos))}));pagamentos=pagamentos.map(g=>({...g,alocadoCentavos:p.dados.valorCentavos,saldoCentavos:String(BigInt(g.valorCentavos)-BigInt(p.dados.valorCentavos))}));}
          versao++;historico.unshift({id:String(versao),versao,acao:p.acao,createdAt:'2026-10-12T12:00:00Z'});return dto({tributo:p.tributo,ambiente:p.ambiente,competencia:p.competencia});
        }
      };
    }
  ` }));
  await page.reload();
  await page.getByText('Preparação da apuração IBS/CBS', { exact: true }).click();
  await page.getByText('Conferência e pagamentos da competência', { exact: true }).click();
  await page.getByText(/Versão 0/).waitFor();
  const prova = async prefixo => {
    await page.getByLabel('Referência documental · '+prefixo,{exact:true}).fill('INSPEÇÃO LOCAL SIMULADA');
    await page.getByLabel('SHA-256 do documento · '+prefixo,{exact:true}).fill('a'.repeat(64));
    await page.getByLabel('Descrição da evidência · '+prefixo,{exact:true}).fill('Documento fictício, não é evidência fiscal.');
  };
  await page.getByText('Conferência do escritório', {exact:true}).click();
  await page.getByLabel('Motivo · conferência', {exact:true}).fill('INSPEÇÃO LOCAL SIMULADA');await prova('conferência');
  await page.getByLabel(/Conferi os documentos/).check();await page.getByRole('button',{name:'Conferir localmente',exact:true}).click();await page.getByText(/Versão 1/).waitFor();
  await page.getByText('Guias registradas manualmente (0)',{exact:true}).click();
  await page.getByLabel('Referência da guia',{exact:true}).fill('Guia fictícia — INSPEÇÃO LOCAL');await page.getByLabel('Valor da guia (R$)',{exact:true}).fill('100,00');await page.getByLabel('Vencimento da guia',{exact:true}).fill('2026-10-30');await prova('guia');await page.getByRole('button',{name:'Registrar guia declarada',exact:true}).click();await page.getByText(/Versão 2/).waitFor();
  await page.getByText('Pagamentos e extinções declarados (0)',{exact:true}).click();
  await page.getByLabel('Referência do pagamento',{exact:true}).fill('Pagamento fictício — INSPEÇÃO LOCAL');await page.getByLabel('Valor do pagamento (R$)',{exact:true}).fill('40,00');await page.getByLabel('Data do pagamento ou extinção',{exact:true}).fill('2026-10-12');await prova('pagamento');await page.getByRole('button',{name:'Registrar pagamento ou extinção',exact:true}).click();await page.getByText(/Versão 3/).waitFor();
  await page.getByText('Alocação local de pagamentos',{exact:true}).click();await page.getByLabel('Guia a vincular').selectOption('guia-ficticia');await page.getByLabel('Pagamento a vincular').selectOption('pagamento-ficticio');await page.getByLabel('Valor a alocar (R$)',{exact:true}).fill('25,00');await page.getByRole('button',{name:'Registrar alocação local',exact:true}).click();await page.getByText(/Versão 4/).waitFor();
  for (const nome of ['Guias registradas manualmente (1)','Pagamentos e extinções declarados (1)','Alocação local de pagamentos','Histórico auditável da competência']) await page.getByText(nome,{exact:true}).click();
  await page.getByText(/Saldo local: R\$ 75,00/).waitFor();await page.getByText(/Disponível localmente: R\$ 15,00/).waitFor();
  const painel = page.getByRole('region',{name:'Acompanhamento mensal IBS CBS'});
  await painel.evaluate(el => {const p=document.createElement('p');p.textContent='INSPEÇÃO LOCAL SIMULADA — todos os valores e documentos abaixo são fictícios.';el.prepend(p);});
  for(const [name,width] of [['desktop',1440],['mobile',390]]) {
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
    await painel.screenshot({path:new URL(name+'.png',dir).pathname.replace(/^\/(\w:)/,'$1')});
  }
  assert.deepEqual(errors,[]);console.log('PASS: mock offline; fixture rotulada percorreu conferência, guia, pagamento e alocação parcial; desktop/celular sem overflow ou erros JS.');
} finally {await browser.close();}
