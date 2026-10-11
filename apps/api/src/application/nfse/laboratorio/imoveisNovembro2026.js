// Operações imobiliárias e condomínios: consistência local, sem atribuir enquadramento fiscal.
import { unico, somente, ordenar, falhar } from './xmlEstruturaOffline.js';
import { decimal, validarMunicipio } from './regrasNovembro2026.js';
import { diaFiscal } from '../regimeDaCompetencia.js';
const campo=(n,k)=>n?unico(n,k,false)?.textContent??null:null;
const elementos=n=>Array.from(n.childNodes).filter(c=>c.nodeType===1);
const todos=(n,k)=>elementos(n).filter(c=>c.localName===k);
const exigir=(ok,code,msg)=>{if(!ok)falhar(code,msg);};
function ordenarRepetidos(n,ordem,repetidos){somente(n,ordem);for(const k of ordem){const lista=repetidos.includes(k)?todos(n,k):[unico(n,k,false)].filter(Boolean);for(const item of lista)n.appendChild(item);}}
function descricao(n,tipo,nome,outro){const v=campo(n,nome);exigir(tipo===outro?typeof v==='string'&&v.trim().length>0&&v.length<=150:v===null,'DESCRICAO_TIPO_INVALIDA','Descrição obrigatória somente para tipo Outro.');}
const soma=(lista,k)=>lista.reduce((t,n)=>t+decimal(campo(n,k)),0n);
const proporcional=(total,p)=> (total*p+5000n)/10000n;
export function conferirImoveisCondominios(inf){
 const serv=unico(inf,'serv'),cServ=unico(serv,'cServ'),codigo=campo(cServ,'cTribNac'),nbs=campo(cServ,'cNBS');
 const ibs=unico(inf,'IBSCBS'),imovel=unico(ibs,'imovel',false),cond=unico(ibs,'condominios',false);
 const locacao=codigo.startsWith('9903'),condominio=codigo.startsWith('9905');
 exigir(!condominio||cond,'CONDOMINIO_OBRIGATORIO','Subitem 99.05 exige grupo de condomínio.');
 exigir(!cond||condominio,'CONDOMINIO_NAO_PERMITIDO','Condomínio não permitido fora do subitem 99.05.');
 exigir(!(locacao||condominio)||imovel,'IMOVEL_OBRIGATORIO','Operação exige identificação do imóvel.');
 if(!imovel)return {estado:'NAO_APLICAVEL',pendencias:[]};
 exigir(locacao||condominio,'IMOVEL_CENARIO_NAO_PREPARADO','Esta etapa cobre locação e condomínio; obra e outras operações exigem validação própria.');
 somente(imovel,['cMun','gLocacao','gUnidImob']);validarMunicipio(campo(imovel,'cMun'),'E0929');
 const loc=unico(imovel,'gLocacao',false),unidades=todos(imovel,'gUnidImob');
 exigir(Boolean(loc)===locacao,locacao?'E0937':'E0936','Confira ocorrência de gLocacao.');
 exigir(unidades.length<=99,'UNIDADES_IMOBILIARIAS_LIMITE','Máximo de 99 unidades.');
 const valores=unico(inf,'valores'),vServ=decimal(campo(unico(valores,'vServPrest'),'vServ'));
 const descontos=unico(valores,'vDescCondIncond',false);
 const descIncond=decimal(campo(descontos,'vDescIncond')||'0'),descCond=decimal(campo(descontos,'vDescCond')||'0');
 exigir(descIncond<=vServ&&descCond<=vServ,'DESCONTO_EXCEDE_SERVICO','Desconto excede valor do serviço.');
 const pendencias=['ENQUADRAMENTO_IMOBILIARIO_E_CALCULO_AUTORIZADOR'];
 let total=0n;
 if(loc){
  exigir(['110021000','110022000'].includes(nbs),'NBS_LOCACAO_INVALIDA','Locação imobiliária exige NBS residencial ou não residencial previsto no Anexo VI.');
  somente(loc,['pCopropriedade','vTotOper','vDescIncondTot','vDescCondTot','dVencOrig']);
  const p=decimal(campo(loc,'pCopropriedade'));exigir(p<=10000n,'E0940','Copropriedade deve estar entre zero e cem.');
  total=decimal(campo(loc,'vTotOper'));
  exigir(vServ===proporcional(total,p),'VALOR_COPROPRIEDADE_DIVERGENTE','vServ deve corresponder à proporção do valor total.');
  for(const [nome,esperado] of [['vDescIncondTot',descIncond],['vDescCondTot',descCond]]){const v=decimal(campo(loc,nome)||'0');exigir(v<=total&&proporcional(v,p)===esperado,'DESCONTO_COPROPRIEDADE_DIVERGENTE','Confira desconto total e proporcional.');}
  const venc=campo(loc,'dVencOrig');exigir(venc===null||diaFiscal(venc),'VENCIMENTO_INVALIDO','Data de vencimento inválida.');
  ordenar(loc,['pCopropriedade','vTotOper','vDescIncondTot','vDescCondTot','dVencOrig']);
 }
 for(const unidade of unidades){
  somente(unidade,['inscImobFisc','cCIB','end','gAjusteBCLocImoveis']);
  const cib=campo(unidade,'cCIB'),end=unico(unidade,'end',false);
  exigir((cib!==null)!==Boolean(end),'IDENTIFICACAO_IMOVEL_INVALIDA','Escolha CIB ou endereço para a unidade.');
  if(cib!==null){exigir(/^[A-Za-z0-9]{8}$/.test(cib),'CIB_FORMATO_INVALIDO','CIB deve conter oito caracteres.');pendencias.push('CIB_DV_E_CADASTRO');}
  if(end){somente(end,['CEP','xLgr','nro','xCpl','xBairro']);exigir(/^\d{8}$/.test(campo(end,'CEP')||'')&&Boolean(campo(end,'xLgr')?.trim())&&Boolean(campo(end,'nro')?.trim()),'ENDERECO_IMOVEL_INVALIDO','Complete CEP, logradouro e número do imóvel.');ordenar(end,['CEP','xLgr','nro','xCpl','xBairro']);pendencias.push('CEP_MUNICIPIO_IMOVEL');}
  const ajustes=todos(unidade,'gAjusteBCLocImoveis');exigir(ajustes.length<=10,'AJUSTES_IMOVEL_LIMITE','Máximo de dez ajustes por unidade.');
  exigir(!ajustes.length||locacao,'E0939','Ajuste imobiliário exclusivo de locação.');
  for(const a of ajustes){somente(a,['tpAjusteBCLocImoveis','xTpAjusteBCLocImoveis','vAjusteBCLocImoveis']);const tipo=campo(a,'tpAjusteBCLocImoveis');exigir(['01','02','03','04','99'].includes(tipo),'TIPO_AJUSTE_IMOVEL_INVALIDO','Tipo de ajuste imobiliário inválido.');exigir(tipo!=='04'||nbs==='110021000','E0944','Redutor social exclusivo de imóvel residencial.');descricao(a,tipo,'xTpAjusteBCLocImoveis','99');exigir(decimal(campo(a,'vAjusteBCLocImoveis'))<=total,'E0966','Ajuste excede valor total da operação.');ordenar(a,['tpAjusteBCLocImoveis','xTpAjusteBCLocImoveis','vAjusteBCLocImoveis']);}
  ordenarRepetidos(unidade,['inscImobFisc','cCIB','end','gAjusteBCLocImoveis'],['gAjusteBCLocImoveis']);
 }
 ordenarRepetidos(imovel,['cMun','gLocacao','gUnidImob'],['gUnidImob']);
 if(cond){
  somente(cond,['dVencOrig','gCobranca','gDesconto']);exigir(diaFiscal(campo(cond,'dVencOrig')),'VENCIMENTO_INVALIDO','Condomínio exige data de vencimento válida.');
  const cobrancas=todos(cond,'gCobranca'),descs=todos(cond,'gDesconto');
  exigir(cobrancas.length>=1&&cobrancas.length<=20&&descs.length<=10,'CONDOMINIO_OCORRENCIA_INVALIDA','Confira limites de cobranças e descontos.');
  const vistos=new Set();
  for(const c of cobrancas){
   somente(c,['tpCobranca','xTpCobranca','vCobranca','gDetCobranca']);const tipo=campo(c,'tpCobranca');
   exigir(['01','02','03','04','05','99'].includes(tipo),'TIPO_COBRANCA_INVALIDO','Tipo de cobrança inválido.');exigir(tipo==='99'||!vistos.has(tipo),'COBRANCA_DUPLICADA','Não repita o tipo de cobrança, exceto Outro.');vistos.add(tipo);descricao(c,tipo,'xTpCobranca','99');
   const valor=decimal(campo(c,'vCobranca'));exigir(valor<=vServ,'COBRANCA_EXCEDE_SERVICO','Cobrança excede serviço.');const detalhes=todos(c,'gDetCobranca');exigir(detalhes.length<=20,'DETALHES_COBRANCA_LIMITE','Máximo de vinte detalhes.');
   for(const d of detalhes){somente(d,['tpDetCobranca','xTpDetCobranca','vDetCobranca']);const tipoDet=campo(d,'tpDetCobranca');exigir(/^(00[1-9]|0[12]\d|03[0-6]|999)$/.test(tipoDet||''),'TIPO_DETALHE_INVALIDO','Tipo de detalhe inválido.');descricao(d,tipoDet,'xTpDetCobranca','999');exigir(decimal(campo(d,'vDetCobranca'))<=valor,'DETALHE_EXCEDE_COBRANCA','Detalhe excede cobrança.');ordenar(d,['tpDetCobranca','xTpDetCobranca','vDetCobranca']);}
   if(detalhes.length){exigir(soma(detalhes,'vDetCobranca')===valor,'SOMA_DETALHES_DIVERGENTE','Cobrança deve corresponder à soma dos detalhes.');pendencias.push('CORRELACAO_COBRANCA_DETALHE');}
   ordenarRepetidos(c,['tpCobranca','xTpCobranca','vCobranca','gDetCobranca'],['gDetCobranca']);
  }
  exigir(soma(cobrancas,'vCobranca')===vServ,'SOMA_COBRANCAS_DIVERGENTE','vServ deve corresponder à soma das cobranças.');
  for(const d of descs){somente(d,['tpDesconto','vDesconto','xTpDesconto']);exigir(['1','2'].includes(campo(d,'tpDesconto')),'TIPO_DESCONTO_INVALIDO','Tipo de desconto inválido.');const descricao=campo(d,'xTpDesconto');exigir(Boolean(descricao?.trim())&&descricao.length<=150,'DESCONTO_SEM_DESCRICAO','Descreva o desconto.');decimal(campo(d,'vDesconto'));ordenar(d,['tpDesconto','vDesconto','xTpDesconto']);}
  exigir(soma(descs.filter(d=>campo(d,'tpDesconto')==='1'),'vDesconto')===descIncond&&soma(descs.filter(d=>campo(d,'tpDesconto')==='2'),'vDesconto')===descCond,'SOMA_DESCONTOS_DIVERGENTE','Confira somatório por tipo de desconto.');
  ordenarRepetidos(cond,['dVencOrig','gCobranca','gDesconto'],['gCobranca','gDesconto']);
 }
 return {estado:'CONFERIDO_LOCALMENTE',tipo:locacao?'LOCACAO':'CONDOMINIO',pendencias:[...new Set(pendencias)]};
}
