import { diaFiscal } from '../regimeDaCompetencia.js';
import { unico, falhar } from './xmlEstruturaOffline.js';
const campo = (n,k) => n && unico(n,k,false)?.textContent;

// Evidências declaradas para conferência offline, não uma resposta presumida da RFB.
export function conferirCadastrosNovembro({ inf, competencia, evidencias = [] }) {
  if (!Array.isArray(evidencias)) falhar('EVIDENCIAS_CADASTRAIS_INVALIDAS', 'Informe uma lista de evidências cadastrais.');
  const pendencias = [], conferencias = [];
  const toma = unico(inf,'toma'), dest = unico(inf,'dest',false);
  const codigo = campo(unico(unico(inf,'serv'),'cServ'),'cTribNac');
  const mesmo = (campo(toma,'CNPJ') && campo(dest,'CNPJ') && campo(toma,'CNPJ').slice(0,8) === campo(dest,'CNPJ').slice(0,8))
    || (campo(toma,'CPF') && campo(toma,'CPF') === campo(dest,'CPF'));
  for (const [papel,pessoa] of [['toma',toma],['dest',dest]]) {
    if (!pessoa) continue;
    const documento = campo(pessoa,'CNPJ') || campo(pessoa,'CPF');
    const end = unico(pessoa,'end',false), nac = end && unico(end,'endNac',false);
    if (!documento || !nac) { pendencias.push(`CADASTRO_${papel.toUpperCase()}_NAO_COBERTO`); continue; }
    const registros = evidencias.filter(e => e?.documento === documento && e.papel === papel);
    const validos = registros.filter(e => e.fonte === 'RFB' && typeof e.referencia === 'string' && e.referencia.trim()
      && e.conferido === true && diaFiscal(e.vigenciaInicio) && (e.vigenciaFim == null || diaFiscal(e.vigenciaFim))
      && e.vigenciaInicio <= competencia && (e.vigenciaFim == null || e.vigenciaFim >= competencia));
    if (validos.length !== 1) { pendencias.push(`CADASTRO_${papel.toUpperCase()}_POR_COMPETENCIA`); continue; }
    const e = validos[0];
    if (e.existe === false) falhar(papel === 'dest' ? (campo(pessoa,'CNPJ') ? 'E0912' : 'E0914') : 'TOMADOR_INEXISTENTE_NA_COMPETENCIA', 'Documento inexistente na competência conforme evidência cadastral.');
    if (e.existe !== true) { pendencias.push(`CADASTRO_${papel.toUpperCase()}_EXISTENCIA_PENDENTE`); continue; }
    // A exceção 17.05 dispensa apenas a igualdade do município do destinatário com a RFB.
    if (papel === 'dest' && !(codigo === '170501' && mesmo)) {
      if (!e.municipio) { pendencias.push('MUNICIPIO_DESTINATARIO_RFB_PENDENTE'); continue; }
      if (e.municipio !== campo(nac,'cMun')) falhar(campo(pessoa,'CNPJ') ? 'E0921' : 'E0922', 'Município do destinatário diverge do cadastro na competência.');
    }
    conferencias.push({ papel, referencia: e.referencia, vigenciaInicio: e.vigenciaInicio, vigenciaFim: e.vigenciaFim || null });
    pendencias.push(`CEP_${papel.toUpperCase()}_POR_COMPETENCIA`);
  }
  return { estado: pendencias.length ? 'PENDENTE' : 'CONFERIDO_LOCALMENTE', conferencias, pendencias, autenticidadeVerificada: false };
}
