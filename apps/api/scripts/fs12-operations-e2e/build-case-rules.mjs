import fs from 'node:fs/promises';
import path from 'node:path';
import {configuration,json} from './common.mjs';
const cfg=await configuration(process.argv[2]),caseId=process.argv[3],phase=process.argv[4]||'simulation';
const seed=JSON.parse(await fs.readFile(path.join(cfg.output,'seed.json'),'utf8'));
const cases=JSON.parse(await fs.readFile(new URL('./cases.json',import.meta.url),'utf8')).cases;
const company=seed.companies.find(c=>c.caseId===caseId),scenario=cases.find(c=>c.id===caseId);
if(!company||!scenario)throw Error('Caso não encontrado');
if(!['simulation','transmission','known-rejection','hold','drop','documental-sem-causa','history'].includes(phase))throw Error('Fase desconhecida');
if(caseId==='T156.4' && phase==='history')throw Error('Não gerar extrato anterior à constituição; usar formulário individual com contexto de abertura.');
const competencia=process.argv[5]||'2026-11';if(!['2026-11','2026-12'].includes(competencia))throw Error('SomentePA11/12;2027 écasodeguarda semremessa');
const [year,month]=competencia.split('-').map(Number),reference=new Date(Date.UTC(year,month-2,1));
const pa=phase==='history'?reference.toISOString().slice(0,7).replace('-',''):competencia.replace('-',''),number='00000000'+pa+'001';
const result={status:200,dados:JSON.stringify([{idDeclaracao:number,cnpjCompleto:company.cnpj,periodoApuracao:pa,dataHoraTransmissao:`${pa}25120000`,valoresDevidos:[{codigoTributo:1010,valor:scenario.receitaAtual===0?0:10}]}]),mensagens:caseId==='T157.1'?[{codigo:'[Aviso-PGDASD-MSG_ISN_030]',texto:'Paráfrase sintética para ensaio: alteração da folha pode afetar períodos posteriores. Aviso não bloqueante.'}]:[]};
const absent={status:200,dados:'',mensagens:[{codigo:'[EntradaIncorreta-PGDASD-MSG_ISN_005]',texto:'Não há declaração transmitida para o período informado.'}]};
const index={status:200,dados:JSON.stringify({anoCalendario:2026,periodo:{periodoApuracao:Number(pa),operacoes:[{tipoOperacao:'Declaração Original',indiceDeclaracao:{numeroDeclaracao:number}}]}}),mensagens:[{codigo:'Sucesso-PGDASD'}]};
const rules=[{name:'ADN fim de distribuição sintético explícito',service:'ADN_DFE',cnpj:company.cnpj,status:200,response:{StatusProcessamento:'NENHUM_DOCUMENTO_LOCALIZADO',LoteDFe:[]}}];
if(phase==='history'){
 const {default:PDFDocument}=await import('pdfkit');
 const text=['DOCUMENTO SINTETICO - ENSAIO LOCAL - SEM VALIDADE FISCAL',`CNPJ: ${company.cnpj}`,'Período de Apuração (PA): '+String(reference.getUTCMonth()+1).padStart(2,'0')+'/'+reference.getUTCFullYear(),'2.2.1) Mercado Interno'];
 for(let i=12;i>=1;i--){const d=new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()-i,1));text.push(`${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()} 1.000,00`);}
 text.push('2.2.2) Mercado Externo');for(let i=12;i>=1;i--){const d=new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()-i,1));text.push(`${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()} 0,00`);}
 text.push('2.3) Informações','Receita Bruta do PA (RPA) - Competência 1.000,00 0,00 1.000,00');
 const pdf=await new Promise(resolve=>{const doc=new PDFDocument({compress:false}),chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.fontSize(9).text(text.join('\n'));doc.end();});
 await fs.writeFile(path.join(cfg.output,`${caseId}-${competencia}-historico-sintetico.pdf`),pdf);
 rules.push({service:'CONSDECLARACAO13',cnpj:company.cnpj,periodoApuracao:pa,response:index},{service:'CONSULTIMADECREC14',cnpj:company.cnpj,periodoApuracao:pa,response:{status:200,dados:JSON.stringify({numeroDeclaracao:number,cnpjCompleto:company.cnpj,periodoApuracao:pa,declaracao:{nomeArquivo:'dec-pgdasd-'+number+'.pdf',pdf:pdf.toString('base64')},recibo:{nomeArquivo:'recibo-pgdasd-'+number+'.pdf',pdf:pdf.toString('base64')}}),mensagens:[]}});
}else{
 rules.push({service:'CONSDECLARACAO13',cnpj:company.cnpj,periodoApuracao:pa,response:phase==='documental-sem-causa'?index:absent});
 if(phase!=='documental-sem-causa')rules.push({name:`${caseId} ${phase}`,path:'/Declarar',service:'TRANSDECLARACAO11',cnpj:company.cnpj,periodoApuracao:pa,indicadorTransmissao:phase==='transmission',hold:phase==='hold',drop:phase==='drop',status:phase==='known-rejection'?400:200,response:phase==='known-rejection'?{status:400,dados:'',mensagens:[{codigo:'[EntradaIncorreta-PGDASD-MSG_ISN_029]',texto:'Paráfrase sintética para ensaio: informe a série obrigatória; serão considerados os valores reenviados.'}]}:result});
}
await json(path.join(cfg.output,`${caseId}-${competencia}-${phase}-rules.json`),{rules});
await json(path.join(cfg.output,`${caseId}-${competencia}-${phase}-witness.json`),{caseId,competencia,periodoApuracaoResposta:pa,phase,synthetic:true,impostoFakeNaoHomologado:true,sourceContracts:['SerproPgdasdService.js TRANSDECLARACAO11/CONSDECLARACAO13','SerproPgdasDeclaracaoService.js CONSULTIMADECREC14','indiceDeclaracao.test.js índice/negativa','fs12B33Contrato.test.js envelope/retorno','AdnNacionalClient.js StatusProcessamento/LoteDFe'],limitation:'Fixture de contrato local. Não atesta resposta nem comportamento de serviço fiscal remoto; documentos são insumos sintéticos apenas.'});
