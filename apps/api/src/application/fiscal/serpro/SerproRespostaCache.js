import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { contextoSerproAtual } from "./serproCallContext.js";

// Somente documentos de consultas conhecidas. Nunca transmissão, pagamento ou SITFIS.
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
export function podeReutilizarResposta(payload) { return DOCUMENTOS.has(payload?.pedidoDados?.idServico); }
export async function lerResposta(payload, rota, client = prisma) {
  if (!podeReutilizarResposta(payload)) return null;
  const chave = chaveResposta(payload, rota);
  // Invalidar antes do envio impede reaproveitar versão anterior se a atualização falhar.
  if (contextoSerproAtual().atualizar === true) {
    await client.serproRespostaCache.deleteMany({ where: { chave } });
    return null;
  }
  const row = await client.serproRespostaCache.findUnique({ where: { chave } });
  return row && new Date(row.expiraEm).getTime() > Date.now() ? row.resposta : null;
}
export async function guardarResposta(payload, rota, response, client = prisma) {
  if (!podeReutilizarResposta(payload) || response.status !== 200 || response.data == null) return;
  // O consumidor continua validando o conteúdo: até ausência/recusa conhecida pode ser
  // reaproveitada por uma hora, evitando busca repetida sem mudança de contexto.
  const chave = chaveResposta(payload, rota);
  const data = { resposta: JSON.parse(JSON.stringify(response.data)), expiraEm: new Date(Date.now() + 60 * 60 * 1000) };
  await client.serproRespostaCache.upsert({ where: { chave }, create: { chave, ...data }, update: data });
  // Expiração lógica é verificada na leitura; remover resíduos não pode invalidar a resposta salva.
  try { await client.serproRespostaCache.deleteMany({ where: { expiraEm: { lte: new Date() } } }); } catch { /* próxima gravação retoma a limpeza */ }
}
