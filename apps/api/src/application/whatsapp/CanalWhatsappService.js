import { prisma } from "../../infrastructure/db/prisma.js";
import * as config from "../../config.js";
import { WhatsappCloudClient } from "./WhatsappCloudClient.js";

export const CANAL_PRINCIPAL = "principal";
const erro = (codigo, message) => Object.assign(new Error(message), { codigo, code: codigo });
const idDoCanal = ref => typeof ref === "string" ? ref : ref?.canalId || CANAL_PRINCIPAL;
export const identidadeWhatsappV2Ativa = () => config.WHATSAPP_IDENTIDADE_V2 === true;
export const multicanalWhatsappAtivo = () => config.WHATSAPP_MULTICANAL === true;

/** O registro é do escritório. Nenhum id ou segredo do navegador vira configuração de rede. */
export async function configuracaoDoCanal(ref = CANAL_PRINCIPAL, { client = prisma, env = process.env } = {}) {
  const id = idDoCanal(ref);
  if (id !== CANAL_PRINCIPAL && !multicanalWhatsappAtivo()) throw erro("CANAL_DESABILITADO", "Este canal ainda não está habilitado.");
  const usaRegistro = identidadeWhatsappV2Ativa() || multicanalWhatsappAtivo() || id !== CANAL_PRINCIPAL;
  const registro = usaRegistro ? await client.canalWhatsapp.findUnique({ where: { id } }) : null;
  if (usaRegistro && !registro) throw erro("CANAL_NAO_CONFIGURADO", "O número de atendimento precisa ser configurado.");
  if (registro?.ativo === false) throw erro("CANAL_DESABILITADO", "Este canal foi desativado.");
  if (id === CANAL_PRINCIPAL) {
    return {
      id, chave: registro?.chave || CANAL_PRINCIPAL, finalidade: registro?.finalidade || "PRINCIPAL",
      phoneNumberId: registro?.phoneNumberId || config.WHATSAPP_PHONE_NUMBER_ID,
      wabaId: registro?.wabaId || config.WHATSAPP_WABA_ID,
      token: config.WHATSAPP_TOKEN,
    };
  }
  const referencia = String(registro.referenciaCredencial || "");
  if (!/^WHATSAPP_(?:[A-Z0-9_]+_)?TOKEN$/.test(referencia)) throw erro("CANAL_SEM_CREDENCIAL", "A credencial deste canal precisa ser configurada no servidor.");
  const token = String(env[referencia] || "").trim();
  if (!registro.phoneNumberId || !registro.wabaId || !token) throw erro("CANAL_SEM_CREDENCIAL", "O número de atendimento está sem configuração completa.");
  return { id, chave: registro.chave, finalidade: registro.finalidade, phoneNumberId: registro.phoneNumberId, wabaId: registro.wabaId, token };
}

export async function whatsappPorCanal(ref = CANAL_PRINCIPAL, { cloud = null, client = prisma, log, fetchImpl } = {}) {
  // Injeção explícita para testes/offline. Produção nunca recebe transporte do HTTP.
  if (cloud) return cloud;
  const canal = await configuracaoDoCanal(ref, { client });
  return new WhatsappCloudClient({ fetchImpl, config: { phoneNumberId: canal.phoneNumberId, token: canal.token, ...(log ? { log } : {}) } });
}

/** Sem whitelist não há roteamento. O modo legado mantém apenas seu número configurado. */
export async function resolverCanalEntrada(canalProvedorId, { wabaProvedorId = null, client = prisma } = {}) {
  if (multicanalWhatsappAtivo() && !identidadeWhatsappV2Ativa()) throw erro("MULTICANAL_REQUER_IDENTIDADE", "Habilite a identificação por vigência antes de usar outro número.");
  const provedor = String(canalProvedorId || "").trim();
  if (!multicanalWhatsappAtivo() && !identidadeWhatsappV2Ativa()) {
    if (provedor && config.WHATSAPP_PHONE_NUMBER_ID && provedor !== config.WHATSAPP_PHONE_NUMBER_ID) throw erro("CANAL_DIVERGENTE", "Evento recebido para outro canal empresarial.");
    return { id: CANAL_PRINCIPAL, legado: true };
  }
  if (!provedor) throw erro("CANAL_AUSENTE", "O evento não informa o número empresarial de origem.");
  const principal = await configuracaoDoCanal(CANAL_PRINCIPAL, { client });
  let canal = principal;
  if (provedor !== principal.phoneNumberId) {
    if (!multicanalWhatsappAtivo()) throw erro("CANAL_DIVERGENTE", "Evento recebido para outro canal empresarial.");
    const registro = await client.canalWhatsapp.findUnique({ where: { phoneNumberId: provedor } });
    if (!registro) throw erro("CANAL_DIVERGENTE", "O evento pertence a um número não cadastrado.");
    canal = await configuracaoDoCanal(registro.id, { client });
  }
  if (wabaProvedorId && canal.wabaId && canal.wabaId !== wabaProvedorId) throw erro("CONTA_WHATSAPP_DIVERGENTE", "A conta do evento não corresponde ao canal cadastrado.");
  return { id: canal.id, phoneNumberId: canal.phoneNumberId, wabaId: canal.wabaId, legado: false };
}

/** Callback de outro remetente não altera prova de uma saída. Legado é sempre principal. */
export async function conferirCanalDoRecibo({ providerMessageId, canalProvedorId, wabaProvedorId, client = prisma }) {
  if (!identidadeWhatsappV2Ativa() && !multicanalWhatsappAtivo()) return;
  const canal = await resolverCanalEntrada(canalProvedorId, { wabaProvedorId, client });
  const mensagem = await client.mensagemWhatsapp.findUnique({ where: { providerMessageId }, include: { conversa: true } });
  if (mensagem && idDoCanal(mensagem.conversa) !== canal.id) throw erro("RECIBO_CANAL_DIVERGENTE", "O recibo não pertence ao canal da mensagem.");
  if (!mensagem && client.envioGuiaTentativa) {
    const tentativa = await client.envioGuiaTentativa.findUnique({ where: { providerMessageId } });
    if (tentativa && idDoCanal(tentativa) !== canal.id) throw erro("RECIBO_CANAL_DIVERGENTE", "O recibo não pertence ao canal do envio.");
  }
}

/** Mesmo número em outra vigência ou canal não pode abrir a janela deste interlocutor. */
export function filtroSegmentosDoCanal(conversa) {
  return {
    ...(!conversa.vinculoNumeroId ? { telefoneE164: conversa.telefoneE164 } : {}),
    ...(conversa.canalId ? { canalId: conversa.canalId } : { canalId: null }),
    ...(conversa.vinculoNumeroId ? { vinculoNumeroId: conversa.vinculoNumeroId } : { vinculoNumeroId: null }),
  };
}
