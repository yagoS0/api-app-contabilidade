import { createHash } from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { contextoSerproAtual } from "./serproCallContext.js";

const prefixo = (companyId, competencia) => `pgdas_historico:${companyId}:${competencia}:`;
const hash = value => createHash("sha256").update(value).digest("hex");
const dinheiro = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
export function versaoPgdas(circular, companyId, competencia, hashes = null) {
  if (!circular?.pgdasNumeroDeclaracao) return null;
  const dados = {
    numeroDeclaracao: String(circular.pgdasNumeroDeclaracao),
    receitaBruta: dinheiro(circular.receitaBruta), dasTotal: dinheiro(circular.dasTotal),
    declaracaoFileId: circular.pgdasDeclaracaoFileId || null,
    reciboFileId: circular.pgdasReciboFileId || null,
  };
  const identidade = { companyId, competencia, numero: dados.numeroDeclaracao,
    receita: dados.receitaBruta, das: dados.dasTotal,
    documentos: hashes || [dados.declaracaoFileId, dados.reciboFileId] };
  const id = !hashes && /^[a-f0-9]{64}$/.test(circular.metadata?.pgdasHistoricoId || "")
    ? circular.metadata.pgdasHistoricoId : hash(JSON.stringify(identidade));
  return { id, ...dados };
}

export async function registrarVersaoPgdas({ circular, companyId, competencia, hashes = null, legado = false }, db = prisma) {
  const versao = versaoPgdas(circular, companyId, competencia, hashes);
  if (!versao) return null;
  // A versão já referenciada foi persistida antes da atualização da circular.
  if (!hashes && circular.metadata?.pgdasHistoricoId === versao.id) return versao.id;
  const ctx = contextoSerproAtual();
  const value = { ...versao, companyId, competencia, legado,
    observadaEm: new Date().toISOString(), consultadaEm: circular.serproLastSyncAt ? new Date(circular.serproLastSyncAt).toISOString() : null,
    origem: legado ? "REGISTRO_ANTERIOR" : (ctx.origem || "CONSULTA_PGDAS"), userId: legado ? null : (ctx.userId || null) };
  // Chave única por conteúdo: concorrência/repetição não sobrescreve a evidência anterior.
  await db.appSetting.upsert({ where: { key: prefixo(companyId, competencia) + versao.id },
    create: { key: prefixo(companyId, competencia) + versao.id, value }, update: {} });
  return versao.id;
}

export const hashDocumentoPgdas = buffer => buffer ? hash(buffer) : null;

export async function listarHistoricoPgdas(companyId, competencia, db = prisma) {
  const [registros, circular, snapshot] = await Promise.all([
    db.appSetting.findMany({ where: { key: { startsWith: prefixo(companyId, competencia) } }, orderBy: [{ createdAt: "desc" }, { key: "desc" }], select: { value: true }, take: 501 }),
    db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } }),
    db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } }, select: { estado: true, numeroDeclaracao: true } }),
  ]);
  const atual = versaoPgdas(circular, companyId, competencia);
  const versoes = registros.slice(0, 500).reverse().map(r => r.value).filter(v => v?.companyId === companyId && v?.competencia === competencia);
  if (atual && !versoes.some(v => v.id === atual.id)) versoes.push({ ...atual, legado: true, observadaEm: null, consultadaEm: circular.serproLastSyncAt || null, origem: "REGISTRO_ATUAL" });
  const numeros = [...new Set(versoes.map(v => v.numeroDeclaracao))];
  return { competencia, atualId: atual?.id || null, mudancaDetectada: numeros.length > 1,
    estadoInterno: snapshot?.estado || "aberta", numeroDeclaracaoInterna: snapshot?.numeroDeclaracao || null,
    entregaSemTransmissaoInterna: !!atual && !snapshot?.numeroDeclaracao,
    declaracaoDiferenteDaInterna: !!atual && !!snapshot?.numeroDeclaracao && String(snapshot.numeroDeclaracao) !== atual.numeroDeclaracao,
    ultimaConsultaEm: circular?.serproLastSyncAt || null, ultimaConsultaStatus: circular?.serproSyncStatus || null,
    limitado: registros.length > 500,
    versoes: versoes.map(v => ({ id: v.id, numeroDeclaracao: v.numeroDeclaracao, receitaBruta: v.receitaBruta, dasTotal: v.dasTotal,
      observadaEm: v.observadaEm, consultadaEm: v.consultadaEm, legado: v.legado, origem: v.origem,
      temDeclaracao: !!v.declaracaoFileId, temRecibo: !!v.reciboFileId, atual: v.id === atual?.id })).reverse() };
}

export async function arquivoHistoricoPgdas(companyId, competencia, id, tipo, db = prisma) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const registro = await db.appSetting.findUnique({ where: { key: prefixo(companyId, competencia) + id } });
  let versao = registro?.value;
  if (!versao) {
    const circular = await db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const atual = versaoPgdas(circular, companyId, competencia);
    if (atual?.id === id) versao = { ...atual, companyId, competencia };
  }
  if (versao?.companyId !== companyId || versao?.competencia !== competencia) return null;
  return tipo === "recibo" ? versao.reciboFileId : versao.declaracaoFileId;
}
