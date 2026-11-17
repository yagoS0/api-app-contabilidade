// Política pura B3.3a; nenhuma saída autoriza transporte.
import { createHash } from 'node:crypto';
import { determinarPoliticaDeclaratoriaFs12, indiceCompetenciaFs12 } from './politicaDeclaratoriaFs12.js';
import { validarSerieManualFs12 } from './serieManualFs12.js';

export const VERSAO_PLANEJAMENTO_REMESSA_FS12 = 'PGDAS-2026-B3.3a.v1';
const texto = v => typeof v === 'string' && v.trim().length > 0;
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const canonical = v => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
// Serialização dos contratos B31/B32. Digest não autentica procedência.
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const copia = v => JSON.parse(JSON.stringify(v));
const escopo = (a, b) => a && b && ['portalClientId', 'companyId', 'competencia'].every(k => a[k] === b[k]);
const instante = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const civil = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && instante(`${v}T00:00:00.000Z`);

/** Fatos JSON fornecidos pelo servidor; não autentica usuário nem origem remota.
 * Sem leitor/produtor, payload, callbacks ou relógio. homologado é ignorado.
 */
export function planejarRemessaFs12(entrada = {}) {
  const { identidade: i, contexto = {}, revisaoManual: r, revisaoVigente, calculoExistente: c, historicoOficial: h } = entrada ?? {};
  const politica = determinarPoliticaDeclaratoriaFs12(contexto);
  const impedimentos = new Set(['PROTOCOLO_REMESSA_NAO_HOMOLOGADO', 'ORIGEM_OFICIAL_PRODUTIVA_INDISPONIVEL', ...politica.impedimentos]);
  const resultado = {
    versaoPolitica: VERSAO_PLANEJAMENTO_REMESSA_FS12,
    politicaFiscal: { versao: politica.versao, situacao: politica.situacao, regra: politica.regra },
    janelaFiscal: politica.janela ? copia(politica.janela) : null,
    mesesComProvaOficial: [], mesesPropostos: null, analiseCandidata: null,
    autorizaEfeitoFiscal: false,
    fontes: { fundamento: { ...politica.fundamento }, caracterizacao: 'docs/modules/pgdas-2026-b33-fontes.json',
      revisaoManual: null, vinculoCalculo: null, historiaMensal: [] },
  };
  const fim = () => ({ ...resultado, impedimentos: [...impedimentos].sort() });
  if (!i || !texto(i.portalClientId) || !texto(i.companyId) || typeof i.cnpj !== 'string' || !/^\d{14}$/.test(i.cnpj)
    || indiceCompetenciaFs12(i.competencia) === null || i.companyId !== contexto?.empresaId
    || i.competencia !== contexto?.competenciaApuracao || !civil(i.dataAbertura)
    || i.dataAbertura.slice(0, 7) !== contexto?.inicioAtividade || i.dataAbertura.slice(0, 7) > i.competencia) {
    impedimentos.add('IDENTIDADE_OU_CONTEXTO_INCOMPATIVEL'); return fim();
  }
  if (contexto.cadastro && (contexto.cadastro.id !== i.companyId
    || contexto.cadastro.dataAbertura !== `${i.dataAbertura}T00:00:00.000Z`)) {
    impedimentos.add('CADASTRO_ABERTURA_DIVERGENTE'); return fim();
  }
  if (i.competencia <= '2026-10') impedimentos.add('PERIODO_HISTORICO_SEM_ALTERACAO_DE_DESPACHO');
  if (i.dataAbertura.slice(0, 7) === i.competencia) impedimentos.add('PROTOCOLO_INICIO_PROPRIO_PA_PENDENTE');
  if (i.dataAbertura.slice(8) !== '01' && politica.janela?.competencias.includes(contexto.inicioAtividade))
    impedimentos.add('PROTOCOLO_ABERTURA_MEIO_MES_PENDENTE');
  if (politica.situacao !== 'EXIGIDA') return fim();
  let serie;
  try { serie = validarSerieManualFs12(contexto, r?.serie).serie; }
  catch (error) { impedimentos.add(error.code || 'FS12_SERIE_INVALIDA'); return fim(); }
  if (!r || !escopo(r, i) || r.origem !== 'MANUAL_APURACAO' || !texto(r.id)
    || !Number.isSafeInteger(r.revisao) || r.revisao < 1 || !texto(r.autorId) || !instante(r.confirmadoEm)
    || r.politicaVersao !== politica.versao || !sha(r.serieHash) || r.serieHash !== hash(serie)
    || !sha(r.contextoRevisao) || r.contextoRevisao !== hash(contexto)
    || !r.contexto || hash(r.contexto) !== hash(contexto)) {
    impedimentos.add('REVISAO_MANUAL_INCOMPATIVEL'); return fim();
  }
  // Referência da última confirmação, obtida independentemente do snapshot analisado.
  // Consistência não substitui a leitura/autorização atual do futuro coordenador.
  if (!escopo(revisaoVigente, i) || !['id', 'revisao', 'serieHash', 'contextoRevisao',
    'politicaVersao', 'autorId', 'confirmadoEm'].every(k => revisaoVigente[k] === r[k])) {
    impedimentos.add('REVISAO_MANUAL_NAO_VIGENTE_OU_NAO_COMPROVADA'); return fim();
  }
  resultado.fontes.revisaoManual = { id: r.id, revisao: r.revisao, serieHash: r.serieHash,
    contextoRevisao: r.contextoRevisao, politicaVersao: r.politicaVersao, origem: r.origem };
  // null explicita que ainda não existe cálculo; omissão é informação insuficiente.
  if (c !== null) {
    const v = c?.vinculo, snapshot = c?.calculoConfirmado, ref = snapshot?.fs12;
    if (!c || !texto(c.calculoId) || !v || !texto(v.id) || !escopo(v, i)
      || v.calculoId !== c.calculoId || v.revisaoFs12 !== r.revisao || v.contextoHash !== r.contextoRevisao
      || v.politicaVersao !== r.politicaVersao || !snapshot || snapshot.calculoId !== c.calculoId
      || snapshot.portalClientId !== i.portalClientId || snapshot.competencia !== i.competencia
      || snapshot.contribuinteCnpj !== i.cnpj
      || !ref || ref.revisaoId !== r.id || ref.revisao !== r.revisao
      || ref.contextoHash !== r.contextoRevisao || ref.politicaVersao !== r.politicaVersao
      || !sha(v.calculoHash) || hash(snapshot) !== v.calculoHash
      || !v.calculoConfirmado || hash(v.calculoConfirmado) !== v.calculoHash) {
      impedimentos.add('VINCULO_B32_INCOMPATIVEL_OU_AUSENTE'); return fim();
    }
    resultado.fontes.vinculoCalculo = { id: v.id, calculoId: v.calculoId, calculoHash: v.calculoHash };
  }
  if (!h || !escopo(h, i) || h.cnpj !== i.cnpj
    || !['COMPROVADA', 'PARCIAL', 'DESCONHECIDA', 'DIVERGENTE', 'INDISPONIVEL'].includes(h.estado) || !Array.isArray(h.meses)) {
    impedimentos.add('HISTORIA_OFICIAL_AUSENTE_OU_INVALIDA'); return fim();
  }
  if (!['COMPROVADA', 'PARCIAL'].includes(h.estado)) { impedimentos.add(`HISTORIA_OFICIAL_${h.estado}`); return fim(); }
  const porMes = new Map(), invalidos = new Set(), janela = politica.janela.competencias;
  const vigencias = Array.isArray(h.declaracoesVigentes) ? h.declaracoesVigentes : [];
  for (const m of h.meses) {
    const p = m?.proveniencia;
    if (!m || !escopo(m, i) || m.cnpj !== i.cnpj || !janela.includes(m.mes)
      || !Number.isSafeInteger(m.valorCentavos) || m.valorCentavos < 0
      || !texto(m.numeroDeclaracao) || !texto(m.versaoDeclaracao)
      || !p || p.tipo !== 'SERIE_MENSAL_OFICIAL' || !texto(p.referencia) || !sha(p.conteudoHash) || !instante(p.obtidoEm)) {
      impedimentos.add('PROVA_MENSAL_INVALIDA');
      if (janela.includes(m?.mes)) invalidos.add(m.mes);
      continue;
    }
    const atuais = vigencias.filter(v => v && escopo(v, i) && v.cnpj === i.cnpj
      && v.numeroDeclaracao === m.numeroDeclaracao);
    if (atuais.length !== 1 || atuais[0].versaoDeclaracao !== m.versaoDeclaracao
      || !texto(atuais[0].referencia) || !sha(atuais[0].conteudoHash) || !instante(atuais[0].verificadoEm)) {
      invalidos.add(m.mes); impedimentos.add('VERSAO_OFICIAL_NAO_VIGENTE_OU_NAO_COMPROVADA'); continue;
    }
    if (porMes.has(m.mes)) { invalidos.add(m.mes); impedimentos.add('PROVA_MENSAL_DUPLICADA_OU_AMBIGUA'); }
    else porMes.set(m.mes, m);
  }
  const analise = serie.map(local => {
    const oficial = invalidos.has(local.mes) ? null : porMes.get(local.mes);
    if (!oficial) return { mes: local.mes, situacao: 'SEM_PROVA_SUFICIENTE' };
    resultado.mesesComProvaOficial.push(copia(oficial));
    resultado.fontes.historiaMensal.push({ mes: oficial.mes, numeroDeclaracao: oficial.numeroDeclaracao,
      versaoDeclaracao: oficial.versaoDeclaracao, proveniencia: copia(oficial.proveniencia) });
    const igual = local.valorCentavos === oficial.valorCentavos;
    if (!igual) impedimentos.add('VALOR_OFICIAL_DIVERGENTE');
    return { mes: local.mes, situacao: igual ? 'CONCORDANTE' : 'DIVERGENTE',
      valorManualCentavos: local.valorCentavos, valorOficialCentavos: oficial.valorCentavos };
  });
  if (h.estado === 'PARCIAL' || resultado.mesesComProvaOficial.length !== janela.length) impedimentos.add('HISTORIA_OFICIAL_INCOMPLETA');
  resultado.analiseCandidata = { finalidade: 'COMPARACAO_NAO_LIBERADORA', meses: analise };
  return fim();
}
