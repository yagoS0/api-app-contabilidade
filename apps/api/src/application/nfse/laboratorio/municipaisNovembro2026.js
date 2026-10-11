// Conferência OFFLINE: parâmetros explícitos e conferidos, nunca inferidos da data da consulta.
import { TABELAS_NOVEMBRO } from './tabelasNovembro.data.js';
import { unico, falhar } from './xmlEstruturaOffline.js';
import { decimal, validarMunicipio } from './regrasNovembro2026.js';
import { diaFiscal } from '../regimeDaCompetencia.js';
const campo=(n,k)=>n?unico(n,k,false)?.textContent??null:null;
const filhos=n=>Array.from(n?.childNodes||[]).filter(c=>c.nodeType===1);
const exigir=(ok,code,msg)=>{if(!ok)falhar(code,msg);};
const especiais=new Set(['101','102','103','104','105','199']);
const regras=TABELAS_NOVEMBRO.ajustes;
const reais=c=>`${c/100n}.${String(c%100n).padStart(2,'0')}`;
const pendente=(codigo)=>({estado:'PENDENTE',pendencias:[codigo],validacaoMunicipalCompleta:false});

export function conferirAjustesMunicipais({inf,competencia,classificacao,contextoMunicipal,municipioIss1705}) {
 const cTribMun=campo(unico(unico(inf,'serv'),'cServ'),'cTribMun');
 exigir(cTribMun===null||(/^\d{3}$/.test(cTribMun)&&cTribMun!=='000'),'E0315','Complemento municipal deve ter três dígitos e não pode ser 000.');
 const valores=unico(inf,'valores'),ajuste=unico(valores,'vAjusteBC',false);
 if(!ajuste)return {estado:'SEM_AJUSTE',pendencias:[],validacaoMunicipalCompleta:false};
 const reg=unico(unico(inf,'prest'),'regTrib'),tribMun=unico(unico(valores,'trib'),'tribMun');
 const op=campo(reg,'opSimpNac'),regSN=campo(reg,'regApTribSN'),especial=campo(reg,'regEspTrib');
 const trib=campo(tribMun,'tribISSQN'),susp=unico(tribMun,'exigSusp',false);
 const codigo=campo(unico(unico(inf,'serv'),'cServ'),'cTribNac');
 const p=campo(ajuste,'pAjusteBCISSQN'),v=campo(ajuste,'vAjusteBCISSQN');
 const direto=p!==null||v!==null;
 const docs=filhos(unico(ajuste,'documentos',false));
 const comuns=docs.filter(d=>!especiais.has(campo(d,'tpAjusteBC')));
 const soEspeciais=!direto&&docs.length>0&&comuns.length===0;
 // O campo de ajuste cambial isolado segue o validador de comércio exterior.
 if(!direto&&!docs.length)return pendente('BASE_COMERCIO_EXTERIOR_PENDENTE');
 exigir(op!=='2','E0436','MEI não pode informar ajuste de base.');
 exigir(trib==='1'||soEspeciais,'E0435','Ajuste de ISS exige operação tributável; exceção documental não libera ajustes mistos.');
 exigir(especial==='0'||soEspeciais,'E0445','Regime especial não admite este ajuste de base.');
 exigir(!docs.length||classificacao.ind_gIBSCBS||(trib==='1'&&especial==='0'&&!susp&&['1','3'].includes(op)),
  'E0437','Documentos de ajuste não permitidos neste enquadramento sem tributação IBS/CBS.');
 const contexto=contextoMunicipal,par=contexto?.parametros;
 if(!par)return pendente('PARAMETROS_MUNICIPAIS_POR_COMPETENCIA');
 const municipio=municipioIss1705||contexto.municipioIncidencia;
 validarMunicipio(municipio,'MUNICIPIO_INCIDENCIA_INVALIDO');
 const prestador=campo(unico(inf,'prest'),'CNPJ')||campo(unico(inf,'prest'),'CPF');
 const municipal=campo(unico(unico(inf,'serv'),'cServ'),'cTribMun');
 exigir(contexto.municipioIncidencia===municipio&&par.municipio===municipio&&par.prestador===prestador
  &&par.codigoServicoNacional===codigo&&par.codigoServicoMunicipal===municipal&&par.ambiente==='homologacao',
 'PARAMETROS_ESCOPO_DIVERGENTE','Parâmetros de outro prestador, município, serviço ou ambiente.');
 exigir(par.conferido===true&&typeof par.referencia==='string'&&par.referencia.trim()
  &&diaFiscal(par.vigenciaInicio)&&(!par.vigenciaFim||diaFiscal(par.vigenciaFim))
  &&par.vigenciaInicio<=competencia&&(!par.vigenciaFim||competencia<=par.vigenciaFim),
 'PARAMETROS_VIGENCIA_NAO_CONFIRMADA','Confirme referência e vigência dos parâmetros para a competência.');
 if(typeof par.convenioAtivo!=='boolean')return pendente('CONVENIO_POR_COMPETENCIA');
 if(unico(tribMun,'BM',false))return pendente('BENEFICIO_MUNICIPAL_NAO_SUPORTADO');
 if(!par.convenioAtivo&&soEspeciais)return pendente('REPERCUSSAO_ISS_MUNICIPIO_NAO_CONVENIADO');
 if(op==='3'&&regSN!=='1')return pendente('REGIME_ISS_SIMPLES_FORA_DAS_A_CONFERIR'); // RN541 contém descrição/código contraditórios.
 if(!soEspeciais){
  if(op==='1')exigir(par.convenioAtivo,'E0449','Município sem convênio ativo não admite este ajuste.');
  if(op==='3')exigir(regras.excecoesSimples.includes(codigo),par.convenioAtivo?'E0455':'E0452','Serviço do Simples não admite este ajuste.');
  if(!par.convenioAtivo)return pendente('ADMISSAO_MUNICIPIO_NAO_CONVENIADO');
 }
 if(p!==null){if(typeof par.admitePercentual!=='boolean')return pendente('ADMISSAO_PERCENTUAL_AUSENTE');exigir(par.admitePercentual,'E0454','Município não admite ajuste percentual para este serviço.');}
 if(v!==null){if(typeof par.admiteValor!=='boolean')return pendente('ADMISSAO_VALOR_AUSENTE');exigir(par.admiteValor,'E0446','Município não admite ajuste monetário para este serviço.');}
 if(docs.length&&typeof par.admiteDocumentos!=='boolean')return pendente('ADMISSAO_DOCUMENTOS_AUSENTE');
 // Tipos 101..199 podem ser informados mesmo com vedação municipal. Isso não autoriza reduzir ISS.
 exigir(!comuns.length||par.admiteDocumentos,'AJUSTE_DOCUMENTAL_MUNICIPAL_VEDADO','Município não admite este ajuste documental.');
 const serv=decimal(campo(unico(valores,'vServPrest'),'vServ'));
 const descontos=unico(valores,'vDescCondIncond',false),desc=decimal(campo(descontos,'vDescIncond')||'0');
 exigir(desc<=serv,'E0427','Desconto excede o serviço.');
 let dedISS=p!==null?((serv-desc)*decimal(p)+5000n)/10000n:v!==null?decimal(v):0n;
 let dedIBS=0n;
 for(const doc of docs){
  const tipo=campo(doc,'tpAjusteBC'),r=regras.repercussao.find(r=>r.tipo===tipo);
  if(!r||competencia<r.inicio)return pendente('REPERCUSSAO_TIPO_AJUSTE_PENDENTE');
  const valor=decimal(campo(doc,'vAjusteAplic'));
  if(r.iss&&par.admiteDocumentos&&trib==='1'&&especial==='0')dedISS+=valor;
  if(r.ibscbs&&classificacao.ind_gIBSCBS)dedIBS+=valor;
 }
 exigir(desc+dedISS<=serv,'E0427','Somatório dos ajustes do ISS e desconto excede o serviço.');
 exigir(desc+dedIBS<=serv,'BASE_IBSCBS_NEGATIVA','Somatório dos ajustes do IBS/CBS e desconto excede o serviço.');
 const baseISS=serv-desc-dedISS;
 if(dedISS>0n&&op==='1'&&trib==='1'&&especial==='0'&&!susp&&!regras.excecoesCargaMinima.includes(codigo)){
  if(par.aliquotaIss==null)return pendente('ALIQUOTA_ISS_POR_COMPETENCIA');
  const aliquota=decimal(par.aliquotaIss);
  exigir(aliquota>=200n&&aliquota<=500n,'ALIQUOTA_ISS_INVALIDA','Confira alíquota nominal de ISS entre 2% e 5%.');
  exigir(baseISS*aliquota>=serv*200n,p!==null?'E0444':'E0447','Ajuste reduz carga do ISS abaixo do mínimo aplicável.');
 }
 return {estado:'CONFERIDO_LOCALMENTE',referencia:par.referencia,municipio,
  vigenciaInicio:par.vigenciaInicio,vigenciaFim:par.vigenciaFim||null,
  ajusteISS:reais(dedISS),ajusteIBSCBS:reais(dedIBS),baseISSAntesBeneficio:reais(baseISS),
  pendencias:['AUTENTICIDADE_PARAMETROS_E_CALCULO_AUTORIZADOR'],validacaoMunicipalCompleta:false};
}
