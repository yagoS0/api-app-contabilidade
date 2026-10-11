// Regras locais da NT009 / Anexo VI. Não substitui cadastros externos nem o autorizador.
import { TABELAS_NOVEMBRO } from './tabelasNovembro.data.js';
import { falhar, unico, somente, ordenar } from './xmlEstruturaOffline.js';
import { diaFiscal } from '../regimeDaCompetencia.js';
import { MUNICIPIOS_IBGE } from '@contabilidade/shared/municipios-ibge';
const filhos = n => Array.from(n.childNodes).filter(c => c.nodeType === 1);
const campo = (n,k) => unico(n,k,false)?.textContent ?? null;
const exige = (ok,codigo,mensagem) => { if (!ok) falhar(codigo,mensagem); };
const vigente = (inicio,fim,dia) => dia>=inicio&&(!fim||dia<=fim);
export function classificacaoNovembro(cst,codigo,competencia) {
 const c=TABELAS_NOVEMBRO.classes.find(c=>c.codigo===codigo&&c.cst===cst);
 exige(c&&vigente(c.inicio,c.fim,competencia)&&vigente(c.inicioCst,c.fimCst,competencia),'CLASSIFICACAO_INVALIDA','Classificação/CST incompatível, não permitida em NFS-e ou fora de vigência.');
 return c;
}
export function validarTributacaoNovembro(ibs,trib,competencia) {
 const c=classificacaoNovembro(campo(trib,'CST'),campo(trib,'cClassTrib'),competencia);
 const g=unico(trib,'gIBSCBS',false), op=campo(ibs,'cIndOp');
 exige(Boolean(op)===c.ind_gIBSCBS,c.ind_gIBSCBS?'E0860':'E0859','Confira a ocorrência de cIndOp pelo indicador de tributação.');
 exige(Boolean(g)===c.ind_gIBSCBS,c.ind_gIBSCBS?'E0960':'E0961','Confira a ocorrência de gIBSCBS pelo indicador de tributação.');
 const operacao=op?TABELAS_NOVEMBRO.operacoes.find(o=>o.codigo===op):null;
 exige(!op||operacao,'INDOP_INVALIDO','Operação não permitida para NFS-e no Anexo VII v1.03.00.');
 if(g){
  somente(g,['cCredPres','gTribRegular','gDif']);
  const regular=unico(g,'gTribRegular',false),dif=unico(g,'gDif',false);
  exige(Boolean(regular)===c.tribRegular,c.tribRegular?'E0965':'E0964','Confira o grupo de tributação regular.');
  exige(Boolean(dif)===c.diferimento,c.diferimento?'E0972':'E0971','Confira o grupo de diferimento.');
  // cCredPres exige catálogo e regras próprios, sem inferir direito ao crédito pelo indicador.
  exige(!campo(g,'cCredPres'),'CREDITO_PRESUMIDO_PENDENTE','Crédito presumido ainda depende de validação específica.');
  if(regular){somente(regular,['CSTReg','cClassTribReg']);classificacaoNovembro(campo(regular,'CSTReg'),campo(regular,'cClassTribReg'),competencia);ordenar(regular,['CSTReg','cClassTribReg']);}
  if(dif){somente(dif,['pDifUF','pDifMun','pDifCBS']);for(const nome of ['pDifUF','pDifMun','pDifCBS'])exige(decimal(campo(dif,nome))<=10000n,'DIFERIMENTO_INVALIDO','Percentual de diferimento deve estar entre zero e cem.');ordenar(dif,['pDifUF','pDifMun','pDifCBS']);}
  ordenar(g,['cCredPres','gTribRegular','gDif']);
 }
 return {classificacao:c,operacao};
}
// Centavos/pontos percentuais: sem arredondamentos binários em limites fiscais.
export function decimal(v) {
 exige(typeof v==='string'&&/^\d{1,15}(\.\d{1,2})?$/.test(v),'DECIMAL_INVALIDO','Esperado decimal não negativo com até duas casas.');
 const [inteiro,fracao='']=v.split('.');return BigInt(inteiro)*100n+BigInt(fracao.padEnd(2,'0'));
}
export function validarAjustesNovembro(valores,servico,competencia) {
 const ajuste=unico(valores,'vAjusteBC',false);if(!ajuste)return;
 somente(ajuste,['pAjusteBCISSQN','vAjusteBCISSQN','documentos']);
 const vServ=decimal(campo(unico(valores,'vServPrest'),'vServ'));
 const descontos=unico(valores,'vDescCondIncond',false);
 const desconto=descontos?decimal(campo(descontos,'vDescIncond')||'0'):0n;
 const p=campo(ajuste,'pAjusteBCISSQN'),v=campo(ajuste,'vAjusteBCISSQN'),docs=unico(ajuste,'documentos',false);
 exige(!(p!==null&&v!==null),'AJUSTE_DUPLICADO','Escolha valor ou percentual para o ajuste direto.');
 exige(p!==null||v!==null||docs,'AJUSTE_VAZIO','Informe o ajuste ou seus documentos.');
 exige(desconto<=vServ,'E0427','Desconto excede o serviço.');
 if(p!==null)exige(decimal(p)>0n&&decimal(p)<=10000n,'E0453','Percentual de ajuste deve ser maior que zero e até cem.');
 const direto=p!==null?((vServ-desconto)*decimal(p)+5000n)/10000n:v!==null?decimal(v):0n;
 exige(direto+desconto<=vServ,'E0427','Ajuste e desconto excedem o serviço.');
 if(docs){
  somente(docs,['docAjusteBC']);const lista=filhos(docs);exige(lista.length>=1&&lista.length<=1000,'DOCUMENTOS_INVALIDOS','Informe de um a mil documentos.');
  for(const d of lista){
   somente(d,['tpAjusteBC','xTpAjusteBC','vTotDoc','vAjusteAplic','dtEmiDoc','dtCompDoc','dFeNacional','docFiscalOutro','docOutro','fornec']);
   const tipo=campo(d,'tpAjusteBC');
   exige(['1','2','3','4','5','6','7','8','9','99','101','102','103','104','105','199'].includes(tipo),'TIPO_AJUSTE_INVALIDO','Tipo de ajuste não previsto.');
   exige(!((p!==null||v!==null)&&['2','5','6','7','8','9','99'].includes(tipo)),'E0462','Este ajuste documental não pode coexistir com ajuste direto.');
   exige(!/^(0601|0602)/.test(servico)||['9','199'].includes(tipo),'E0463','Atividade admite apenas profissional parceiro ou tipo 199.');
   const descricao=campo(d,'xTpAjusteBC');exige(['99','199'].includes(tipo)?Boolean(descricao?.trim())&&! (descricao.length>150):descricao===null,['99','199'].includes(tipo)?'E0465':'E0464','Confira a descrição do tipo de ajuste.');
   const aplicado=decimal(campo(d,'vAjusteAplic'));exige(aplicado<=vServ,'E0467','Ajuste excede serviço.');exige(aplicado<=decimal(campo(d,'vTotDoc')),'E0469','Ajuste excede documento.');
   const emissao=campo(d,'dtEmiDoc'),comp=campo(d,'dtCompDoc');
   exige((!emissao||diaFiscal(emissao))&&(!comp||diaFiscal(comp)),'DATA_DOCUMENTO_INVALIDA','Data documental inválida.');
   exige(!emissao||!comp||emissao>=comp,'E0472','Emissão documental anterior à competência.');
   const refs=['dFeNacional','docFiscalOutro','docOutro'].filter(k=>unico(d,k,false));exige(refs.length===1,'DOCUMENTO_AMBIGUO','Escolha exatamente uma referência documental.');
   exige(!['101','103','104','199'].includes(tipo)||refs[0]!=='docOutro','E0479','Este ajuste exige documento fiscal.');
   if(refs[0]==='docFiscalOutro')exige(comp&&comp<'2026-01-01','E0476','Outro documento fiscal exige competência anterior a 2026.');
   if(refs[0]==='dFeNacional'){
    const ref=unico(d,'dFeNacional');somente(ref,['tipoChaveDFe','xTipoChaveDFe','chaveDFe']);
    const t=campo(ref,'tipoChaveDFe'),key=campo(ref,'chaveDFe');exige(['1','2','3','9'].includes(t),'TIPO_DFE_INVALIDO','Tipo de DF-e inválido.');
    exige(t==='9'?Boolean(key)&&key.length<=50:new RegExp('^\\d{'+(t==='1'?50:44)+'}$').test(key||''),'E0460','Chave com formato incompatível com DF-e.');
    exige(t!=='9'||Boolean(campo(ref,'xTipoChaveDFe')?.trim()),'E0470','Descreva o outro DF-e.');
   }
  }
 }
 ordenar(ajuste,['pAjusteBCISSQN','vAjusteBCISSQN','documentos']);
}
const municipios = new Set(MUNICIPIOS_IBGE.map(m=>String(m[0])));
export function validarMunicipio(codigo,codErro){exige(municipios.has(codigo),codErro,'Município ausente da tabela IBGE.');}
export function validarEventoNovembro(serv,codigo) {
 const evento=unico(serv,'atvEvento',false),obrigatorio=/^(12|1710)/.test(codigo);
 exige(!obrigatorio||evento,'E0390','Informe a atividade/evento.');exige(!evento||obrigatorio||codigo==='990101','E0392','Grupo evento não permitido para este serviço.');
 if(!evento)return;
 somente(evento,['xNome','dtIni','dtFim','cMun','idAtvEvt','end']);
 const inicio=campo(evento,'dtIni'),fim=campo(evento,'dtFim');exige(diaFiscal(inicio)&&diaFiscal(fim)&&inicio<=fim,'DATAS_EVENTO_INVALIDAS','Confira o período do evento.');
 exige(Boolean(campo(evento,'xNome')?.trim()),'EVENTO_SEM_NOME','Informe o nome do evento.');
 const mun=campo(evento,'cMun');if(mun){exige(/^(1213|1710)/.test(codigo),'E0393','Município do evento não permitido neste serviço.');exige(mun!==campo(unico(serv,'locPrest'),'cLocPrestacao'),'E0394','Informe município de evento apenas se diferente da prestação.');validarMunicipio(mun,'E0395');}
 exige(Boolean(campo(evento,'idAtvEvt'))!==Boolean(unico(evento,'end',false)),'EVENTO_IDENTIFICACAO_INVALIDA','Escolha identificação ou endereço do evento.');
 ordenar(evento,['xNome','dtIni','dtFim','cMun','idAtvEvt','end']);
}
export function municipioIncidencia1705(toma,dest) {
 const cnpjT=campo(toma,'CNPJ'),cnpjD=dest&&campo(dest,'CNPJ'),cpfT=campo(toma,'CPF'),cpfD=dest&&campo(dest,'CPF');
 const mesmo=Boolean(cnpjT&&cnpjD&&cnpjT.slice(0,8)===cnpjD.slice(0,8)||cpfT&&cpfD&&cpfT===cpfD);
 const pessoa=mesmo?dest:toma,end=unico(pessoa,'end',false),nac=end&&unico(end,'endNac',false),mun=nac&&campo(nac,'cMun');validarMunicipio(mun,'E1321');return mun;
}
export function validarEnderecosNovembro(inf,operacao,codigo){
 const toma=unico(inf,'toma'),dest=unico(inf,'dest',false);
 for(const [tipo,pessoa] of [['toma',toma],['dest',dest]]){
  if(!pessoa)continue;
  const end=unico(pessoa,'end',false),nac=end&&unico(end,'endNac',false),ext=end&&unico(end,'endExt',false);
  exige(!(nac&&ext),'ENDERECO_AMBIGUO','Escolha endereço nacional ou exterior.');
  const obrigatorio=tipo==='toma'?Boolean(campo(pessoa,'CNPJ')):operacao?.local==='Endereço do Destinatário';
  exige(!obrigatorio||nac,tipo==='toma'?'E0235':'E0919','Endereço nacional obrigatório nesta operação.');
  if(nac){validarMunicipio(campo(nac,'cMun'),tipo==='toma'?'MUNICIPIO_TOMADOR_INVALIDO':'E0920');exige(/^\d{8}$/.test(campo(nac,'CEP')||''),'CEP_INVALIDO','CEP deve conter oito dígitos.');for(const k of ['xLgr','nro','xBairro'])exige(Boolean(campo(end,k)?.trim()),'ENDERECO_INCOMPLETO','Complete o endereço nacional.');}
 }
 return codigo==='170501'?municipioIncidencia1705(toma,dest):null;
}
