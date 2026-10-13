import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { contextoSerproAtual } from "./serproCallContext.js";

// Documentos conhecidos e simulação PGDAS-D explicitamente false. Nunca transmissão, pagamento ou SITFIS.
const DOCUMENTOS = new Set(["GERARDAS12", "GERARDASCOBRANCA17", "CONSULTIMADECREC14", "CONSDECCOMPLETA33", "GERARGUIA31"]);
export function jsonCanonico(value) {
  if (Array.isArray(value)) return value.map(jsonCanonico);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => {
    let item = value[key];
    if (key === "dados" && typeof item === "string") { try { item = JSON.parse(item); } catch { /* texto livre */ } }
    return [key, jsonCanonico(item)];
  }));
}
export function chaveResposta(payload, rota) {
  return crypto.createHash("sha256").update(`${rota}|${JSON.stringify(jsonCanonico(payload))}`).digest("hex");
}
export function ehSimulacaoPgdas(payload, rota) {
  if (rota !== '/Declarar' || payload?.pedidoDados?.idSistema !== 'PGDASD' || payload?.pedidoDados?.idServico !== 'TRANSDECLARACAO11') return false;
  let dados = payload.pedidoDados.dados;
  try { if (typeof dados === 'string') dados = JSON.parse(dados); } catch { return false; }
  return dados?.indicadorTransmissao === false;
}
export function podeReutilizarResposta(payload, rota) { return DOCUMENTOS.has(payload?.pedidoDados?.idServico) || ehSimulacaoPgdas(payload, rota); }
export async function lerResposta(payload, rota, client = prisma) {
  if (!podeReutilizarResposta(payload, rota)) return null;
  const chave = chaveResposta(payload, rota);
  const simulacao = ehSimulacaoPgdas(payload, rota);
  if (simulacao) {
    try {
      const assinaturaLegada = crypto.createHash('sha256').update(`${rota}|${JSON.stringify(payload)}`).digest('hex');
      const where = { assinatura: { in: [chave, assinaturaLegada] }, idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', rota };
      // A resposta salva não resolve sozinha uma reserva cujo registro ficou indeterminado.
      const pendente = await client.serproChamada.findFirst({ where: { ...where, status: { in: ['reservada', 'incerta'] } }, select: { id: true } });
      if (pendente) throw Object.assign(new Error('Esta simulação tem uma tentativa em andamento ou com registro indeterminado. Confira a tentativa anterior antes de continuar.'), { code: 'SERPRO_CHAMADA_EM_ANDAMENTO', status: 409 });
      const row = await client.serproRespostaCache.findUnique({ where: { chave } });
      if (row && new Date(row.expiraEm).getTime() > Date.now()) return row.resposta;
      const concluida = await client.serproChamada.findFirst({ where: { ...where, status: 'ok', httpStatus: 200 }, select: { id: true } });
      if (concluida) throw Object.assign(new Error('Esta simulação já recebeu uma resposta, mas ela não está mais disponível para recuperação automática. Recupere o cálculo salvo ou confira a tentativa anterior antes de solicitar uma nova simulação. Nenhuma nova consulta foi enviada.'), { code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL', status: 409 });
      return null;
    } catch (err) {
      if (['SERPRO_CHAMADA_EM_ANDAMENTO', 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL'].includes(err?.code)) throw err;
      throw Object.assign(new Error('Não foi possível conferir o registro da simulação anterior. Nenhuma nova consulta foi enviada. Restabeleça o registro antes de continuar.'), { code: 'SERPRO_MEDICAO_INDISPONIVEL', status: 503 });
    }
  }
  // Invalidar antes do envio impede reaproveitar versão anterior se a atualização falhar.
  if (contextoSerproAtual().atualizar === true) {
    await client.serproRespostaCache.deleteMany({ where: { chave } });
    return null;
  }
  const row = await client.serproRespostaCache.findUnique({ where: { chave } });
  return row && new Date(row.expiraEm).getTime() > Date.now() ? row.resposta : null;
}
export async function guardarResposta(payload, rota, response, client = prisma) {
  if (!podeReutilizarResposta(payload, rota) || response.status !== 200 || response.data == null) return;
  // O consumidor continua validando o conteúdo: até ausência/recusa conhecida pode ser
  // reaproveitada por uma hora, evitando busca repetida sem mudança de contexto.
  const chave = chaveResposta(payload, rota);
  const data = { resposta: JSON.parse(JSON.stringify(response.data)), expiraEm: new Date(Date.now() + 60 * 60 * 1000) };
  await client.serproRespostaCache.upsert({ where: { chave }, create: { chave, ...data }, update: data });
  // Expiração lógica é verificada na leitura; remover resíduos não pode invalidar a resposta salva.
  try { await client.serproRespostaCache.deleteMany({ where: { expiraEm: { lte: new Date() } } }); } catch { /* próxima gravação retoma a limpeza */ }
}
