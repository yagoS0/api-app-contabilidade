import { prisma } from "../../../../infrastructure/db/prisma.js";
import { hashCalculo, validarCalculoConfirmado } from "./CalculoConfirmado.js";

const documento = value => String(value || "").replace(/\D/g, "");
const copia = value => JSON.parse(JSON.stringify(value));
const indisponivel = motivo => ({ calculoRecuperavel: null, calculoRecuperacaoMotivo: motivo });
const numeroValido = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

// Não refaz a simulação nem troca o formulário confirmado por sugestões atuais.
export function recuperarCalculo(snapshot, dadosAtuais = {}) {
  if (!snapshot) return indisponivel(null);
  if (!["calculada", "fechada"].includes(snapshot.estado)) return indisponivel("O estado atual da apuração não permite recuperar um cálculo para fechamento ou transmissão.");
  if (!numeroValido(snapshot.dasSimuladoSerpro)) return indisponivel("O resultado salvo não possui um valor válido de DAS simulado.");
  let vinculo;
  try {
    vinculo = validarCalculoConfirmado(snapshot, {
      portalClientId: dadosAtuais.portalClientId, competencia: dadosAtuais.competencia,
      calculoId: snapshot.idempotencyKey,
    });
  } catch {
    return indisponivel("Não foi possível comprovar a integridade do cálculo salvo. Confira os dados antes de calcular novamente.");
  }
  const salvo = { dasValor: Number(snapshot.dasSimuladoSerpro), rbt12: numeroValido(snapshot.rbt12) ? Number(snapshot.rbt12) : null,
    formulario: copia(vinculo.formulario), estado: snapshot.estado, calculadoEm: snapshot.updatedAt || null };
  const apenasLeitura = motivo => ({ ...indisponivel(motivo), calculoSalvo: salvo });
  if (!vinculo.contextoOrigem) return apenasLeitura("Resultado salvo disponível para consulta. Não pode fechar ou transmitir: a correspondência com os dados atuais não foi comprovada neste cálculo antigo.");
  const atual = dadosAtuais.contextoOrigem;
  if (!atual || atual.versao !== 1 || vinculo.contextoOrigem.versao !== 1 || !/^[a-f0-9]{64}$/.test(atual.hash || "")) {
    return apenasLeitura("Resultado salvo disponível para consulta. Não foi possível conferir os dados fiscais atuais para liberar fechamento ou transmissão.");
  }
  const cnpj = documento(dadosAtuais.cnpj);
  if (!cnpj || cnpj !== documento(vinculo.contribuinteCnpj) || cnpj !== documento(atual.contribuinteCnpj)
    || dadosAtuais.regimeApuracao !== vinculo.formulario.regimeApuracao || atual.regimeApuracao !== vinculo.formulario.regimeApuracao
    || hashCalculo(atual) !== hashCalculo(vinculo.contextoOrigem)) {
    return apenasLeitura("Resultado salvo disponível para consulta. Os dados fiscais mudaram desde a simulação; confira e calcule novamente antes de fechar ou transmitir.");
  }
  return { calculoRecuperavel: { calculoId: vinculo.calculoId, dasValor: salvo.dasValor, rbt12: salvo.rbt12,
    formulario: salvo.formulario, estado: salvo.estado }, calculoRecuperacaoMotivo: null };
}

// Fingerprint exclusivamente local; não consulta SERPRO, não atualiza caches e não usa memória
// da última competência como prova do formulário. Os lançamentos de folha são evidência de mudança,
// não uma substituição da base digitada pelo contador.
export async function contextoOrigemCalculo({ portalClientId, competencia }, db = prisma) {
  if (!portalClientId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(competencia))) throw new Error("Contexto de cálculo inválido.");
  const [ano, mes] = competencia.split("-").map(Number);
  const gte = new Date(Date.UTC(ano, mes - 13, 1));
  const lt = new Date(Date.UTC(ano, mes, 1));
  const pas = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 13 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const ler = async tx => {
    const portal = await tx.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true, companyId: true } });
    if (!portal) throw new Error("Empresa não encontrada para conferir o cálculo.");
    const [cadastro, company, notas, rbt, folha] = await Promise.all([
      tx.cadastroFiscal.findUnique({ where: { portalClientId }, select: { regime: true, regimeApuracao: true, dataOpcaoSN: true, cnaePrincipal: true, cnaesSecundarios: true, sublimiteICMSISS: true, usaFatorR: true, forcarTipoReceitaPorCnae: true, perfilAtividades: true } }),
      portal.companyId ? tx.company.findUnique({ where: { id: portal.companyId }, select: { cnpj: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true, cnaePrincipal: true, cnaesSecundarios: true } }) : null,
      tx.portalInvoice.findMany({ where: { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } }, select: { id: true, competencia: true, total: true, itens: { select: { id: true, valor: true, tipoReceita: true, flagST: true, flagMonofasico: true, flagExportacao: true } } } }),
      tx.rbtExtratoCache.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } }, select: { rbt12: true, detalhePorMes: true, origem: true } }),
      tx.accountingEntry.findMany({ where: { portalClientId, tipo: "FOLHA", competencia: { in: pas } }, select: { id: true, competencia: true, lines: { select: { tipo: true, valor: true, conta: true } } } }),
    ]);
    const ordenar = lista => [...lista].sort((a, b) => hashCalculo(a).localeCompare(hashCalculo(b)));
    const fatos = copia({ portalClientId, competencia, portal, cadastro, company, notas, rbt, folha });
    fatos.notas = ordenar(fatos.notas.map(n => ({ ...n, itens: ordenar(n.itens) })));
    fatos.folha = ordenar(fatos.folha.map(e => ({ ...e, lines: ordenar(e.lines) })));
    if (Array.isArray(fatos.rbt?.detalhePorMes)) fatos.rbt.detalhePorMes = ordenar(fatos.rbt.detalhePorMes);
    for (const fonte of [fatos.cadastro, fatos.company]) if (fonte?.cnaesSecundarios) fonte.cnaesSecundarios.sort();
    return { versao: 1, hash: hashCalculo(fatos), contribuinteCnpj: documento(portal.cnpj), regimeApuracao: cadastro?.regimeApuracao || "COMPETENCIA" };
  };
  return db.$transaction ? db.$transaction(ler, { isolationLevel: "RepeatableRead" }) : ler(db);
}
