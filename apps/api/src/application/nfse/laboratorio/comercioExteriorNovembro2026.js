// Comércio exterior da nota do prestador: validações locais, sem inferir câmbio ou exportação.
import { unico, somente, ordenar, falhar } from './xmlEstruturaOffline.js';
import { decimal } from './regrasNovembro2026.js';
import { diaFiscal } from '../regimeDaCompetencia.js';
const campo=(n,k)=>n?unico(n,k,false)?.textContent??null:null;
const exigir=(ok,codigo,msg)=>{if(!ok)falhar(codigo,msg);};
const pais=pessoa=>campo(pessoa&&unico(pessoa,'end',false)&&unico(unico(pessoa,'end'),'endExt',false),'cPais');
export function conferirComercioExterior({inf,competencia,referenciaMoedas}) {
 const serv=unico(inf,'serv'),ext=unico(serv,'comExt',false),loc=unico(serv,'locPrest');
 const valores=unico(inf,'valores'),tribMun=unico(unico(valores,'trib'),'tribMun');
 const ajuste=unico(valores,'vAjusteBC',false),ajusteExterior=campo(ajuste,'vAjusteBCIBSCBSComExt');
 const requer=Boolean(pais(unico(inf,'toma'))||pais(unico(inf,'interm',false))||campo(loc,'cPaisPrestacao')||campo(tribMun,'tribISSQN')==='3');
 exigir(!requer||ext,'E0330','Operação exterior exige o grupo comExt.');
 exigir(ajusteExterior===null||ext,'AJUSTE_EXTERIOR_SEM_COMEXT','Ajuste da base de comércio exterior exige comExt.');
 if(!ext)return {estado:'NAO_APLICAVEL',pendencias:[]};
 exigir(Boolean(campo(unico(serv,'cServ'),'cNBS')),'E0318','Informe NBS na operação exterior.');
 somente(ext,['mdPrestacao','vincPrest','tpMoeda','nFatura','vFatura','vServMoeda','mecAFComexP','mecAFComexT','movTempBens','nDUIMP','nDUE','mdic','nContCambio']);
 const modo=campo(ext,'mdPrestacao'),mov=campo(ext,'movTempBens');
 exigir(['1','2','3','4','5'].includes(modo),'E0333','Modo de prestação deve ser de 1 a 5.');
 exigir(['0','1','2','3','4','5','6','9'].includes(campo(ext,'vincPrest')),'VINCULO_EXTERIOR_INVALIDO','Confira vínculo entre as partes.');
 exigir(/^0[1-8]$/.test(campo(ext,'mecAFComexP')||''),'E0341','Confira mecanismo de apoio do prestador.');
 exigir(/^(0[1-9]|1\d|2[0-6])$/.test(campo(ext,'mecAFComexT')||''),'E0343','Confira mecanismo de apoio do tomador.');
 exigir(['1','2','3'].includes(mov),'E0345','Confira movimentação temporária de bens.');
 const duimp=campo(ext,'nDUIMP'),due=campo(ext,'nDUE');
 exigir(mov!=='2'||Boolean(duimp),'E0352','DUIMP obrigatória para movimento tipo 2.');
 exigir(mov!=='3'||Boolean(due),'E0356','DU-E obrigatória para movimento tipo 3.');
 exigir(mov!=='1'||(duimp===null&&due===null),'E0354','Não informe DUIMP ou DU-E quando não há movimento.');
 if(duimp!==null)exigir(/^[A-Za-z0-9]{15}$/.test(duimp),'DUIMP_FORMATO_INVALIDO','DUIMP deve conter 15 caracteres alfanuméricos.');
 if(due!==null)exigir(/^[A-Za-z0-9]{14}$/.test(due),'DUE_FORMATO_INVALIDO','DU-E deve conter 14 caracteres alfanuméricos.');
 exigir(['0','1'].includes(campo(ext,'mdic')),'MDIC_INVALIDO','Indicador MDIC deve ser zero ou um.');
 for(const nome of ['nFatura','nContCambio']){const valor=campo(ext,nome);if(valor!==null)exigir(/^\d{1,20}$/.test(valor),'IDENTIFICADOR_COMEX_INVALIDO','Confira identificação numérica da fatura/contrato.');}
 for(const nome of ['vFatura','vServMoeda']){const valor=campo(ext,nome);if(valor!==null)decimal(valor);}
 if(ajusteExterior!==null){exigir(/^-?\d{1,15}(\.\d{1,2})?$/.test(ajusteExterior),'AJUSTE_EXTERIOR_INVALIDO','Ajuste exterior deve ser decimal com até duas casas, podendo ser negativo.');}
 const moeda=campo(ext,'tpMoeda');exigir(/^\d{3}$/.test(moeda||''),'MOEDA_FORMATO_INVALIDO','Informe código BCB de três dígitos.');
 const pendencias=['ENQUADRAMENTO_COMERCIO_EXTERIOR','CAMBIO_E_BASES_AUTORIZADOR'];
 if(!referenciaMoedas)pendencias.push('MOEDA_BCB_POR_COMPETENCIA');
 else {
  exigir(referenciaMoedas.fonte==='BCB'&&typeof referenciaMoedas.referencia==='string'&&referenciaMoedas.referencia.trim()&&Array.isArray(referenciaMoedas.moedas),'FONTE_MOEDAS_INVALIDA','Informe referência da tabela BCB.');
  const entradas=referenciaMoedas.moedas.filter(m=>m.codigo===moeda&&diaFiscal(m.inicio)&&(!m.fim||diaFiscal(m.fim))&&m.inicio<=competencia&&(!m.fim||competencia<=m.fim));
  exigir(entradas.length===1,'MOEDA_VIGENCIA_INVALIDA','Moeda não possui uma única vigência BCB para esta competência.');
 }
 if(modo==='5')pendencias.push('PARCELA_CONSUMIDA_NO_PAIS_OU_EXPORTADA');
 ordenar(ext,['mdPrestacao','vincPrest','tpMoeda','nFatura','vFatura','vServMoeda','mecAFComexP','mecAFComexT','movTempBens','nDUIMP','nDUE','mdic','nContCambio']);
 return {estado:'CONFERIDO_LOCALMENTE',modo,moeda,referenciaMoedas:referenciaMoedas?.referencia||null,pendencias};
}
