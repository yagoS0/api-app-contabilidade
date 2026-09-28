import { IA_LEADS_OPENAI, IA_LEADS_TELEFONES_PILOTO, IA_LEADS_CANAIS_PILOTO, IA_LEADS_TETO_TOTAL_CENTAVOS, OPENAI_API_KEY } from '../../config.js';
import { autorizarChamadaIa, concluirChamadaIa } from './GuardaIaService.js';
import { LeadsOpenAIClient, RESERVA_LEADS_CENTAVOS, prepararPedidoLead } from './LeadsOpenAIClient.js';
import { MODELO_LEADS } from './interpretacaoLeadIa.js';

export async function interpretarMensagemLead({ texto, intencao, campoEsperado, resumo, conversaId, mensagemId, telefone, canalId, client, deps = {} }) {
  if (!(deps.flag ?? IA_LEADS_OPENAI)) return null;
  const piloto = deps.piloto ?? IA_LEADS_TELEFONES_PILOTO;
  if (!piloto.includes(String(telefone || '').replace(/\D/g, ''))) return null;
  const canais = deps.canais ?? IA_LEADS_CANAIS_PILOTO;
  if (!canalId || !canais.includes(canalId)) return null;
  const tetoAcumuladoCentavos = deps.tetoTotalCentavos ?? IA_LEADS_TETO_TOTAL_CENTAVOS;
  if (!Number.isSafeInteger(tetoAcumuladoCentavos) || tetoAcumuladoCentavos <= 0) return { estado: 'FALLBACK', motivo: 'TETO_PILOTO_INVALIDO' };
  const entrada = { texto, intencao, campoEsperado, ...(resumo ? { resumo } : {}) };
  try { prepararPedidoLead(entrada); } catch { return { estado: 'FALLBACK', motivo: 'ENTRADA_FORA_DO_LIMITE' }; }
  let guarda;
  try {
    guarda = await (deps.autorizar || autorizarChamadaIa)({ conversaId, mensagemId, finalidade: 'comercial_whatsapp', client,
      chave: deps.chave ?? OPENAI_API_KEY, modelo: MODELO_LEADS, reservaCentavos: RESERVA_LEADS_CENTAVOS, tetoAcumuladoCentavos });
  } catch { return { estado: 'FALLBACK', motivo: 'GUARDA_INDISPONIVEL' }; }
  if (!guarda.ok) return { estado: 'FALLBACK', motivo: guarda.motivo };
  let resposta, falha;
  try { resposta = await (deps.assistente || new LeadsOpenAIClient({ chave: deps.chave ?? OPENAI_API_KEY })).interpretar(entrada); }
  catch (e) { falha = e; }
  try {
    await (deps.concluir || concluirChamadaIa)(guarda.contexto, {
      usage: resposta?.usage || falha?.usage, usageCompleto: Boolean(resposta?.usage || falha?.usage),
      iteracoes: 1, stopReason: falha ? 'erro' : 'completed', erroCodigo: falha ? falha.codigo || 'OPENAI_ERRO' : null,
    }, { client });
  } catch { return { estado: 'FALLBACK', motivo: 'REGISTRO_INDISPONIVEL' }; }
  return falha ? { estado: 'FALLBACK', motivo: falha.codigo || 'OPENAI_ERRO' }
    : { estado: 'APLICADA', modelo: MODELO_LEADS, interpretacao: resposta.interpretacao };
}
