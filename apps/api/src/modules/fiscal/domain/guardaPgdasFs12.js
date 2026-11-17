import { indiceCompetenciaFs12 } from './politicaDeclaratoriaFs12.js';

const erro = (code, message) => Object.assign(new Error(message), { code, status: 422 });
const invalida = () => erro('FS12_COMPETENCIA_INVALIDA', 'Confira a competência da declaração antes de continuar.');

// B3.2 vincula evidência local; não homologa seleção nem transporte B3.3.
export function exigirDespachoPgdasFs12Permitido({ competencia } = {}) {
  if (indiceCompetenciaFs12(competencia) === null) throw invalida();
  if (competencia >= '2027-01') throw erro('FS12_HOMOLOGACAO_2027_PENDENTE', 'O contrato PGDAS-D de 2027 ainda depende de homologação. Nenhuma declaração foi enviada.');
  if (competencia >= '2026-11') throw erro('FS12_INTEGRACAO_B33_PENDENTE', 'A integração fiscal da FS12 ainda está pendente. A confirmação local não autoriza simular ou transmitir.');
}

function competenciaDoPa(pa) {
  if (!['string', 'number'].includes(typeof pa) || !/^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(String(pa))) throw invalida();
  const texto = String(pa);
  return `${texto.slice(0, 4)}-${texto.slice(4)}`;
}

export function exigirEnvelopePgdasFs12Permitido({ payload } = {}) {
  const pedido = payload?.pedidoDados;
  if (pedido?.idSistema !== 'PGDASD' || pedido?.idServico !== 'TRANSDECLARACAO11') return;
  let dados;
  try { dados = typeof pedido.dados === 'string' ? JSON.parse(pedido.dados) : pedido.dados; }
  catch { throw invalida(); }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw invalida();
  const temPa = Object.prototype.hasOwnProperty.call(dados, 'pa');
  const temLegado = Object.prototype.hasOwnProperty.call(dados, '_periodoApuracao');
  if (!temPa && !temLegado) throw invalida();
  const competencia = temPa ? competenciaDoPa(dados.pa) : competenciaDoPa(dados._periodoApuracao);
  if (temLegado && competenciaDoPa(dados._periodoApuracao) !== competencia) throw invalida();
  exigirDespachoPgdasFs12Permitido({ competencia });
}
