import { prisma } from "../../infrastructure/db/prisma.js";
import { resolverVinculoPorTelefone } from "./ContatoWhatsappService.js";
import { empresasAutorizadas } from "./selecaoEmpresaWhatsapp.js";
import { garantirConversa, janelaDaConversa } from "./ConversaWhatsappService.js";
import { enviarMensagemRastreada } from "./SaidaWhatsappService.js";
import { WhatsappCloudClient } from "./WhatsappCloudClient.js";
import { sessaoDoContato } from "../assistente/sessaoDoContato.js";
import { executarFerramenta, definicoes } from "../assistente/ferramentas/index.js";

const recusa = () => Object.assign(new Error("O contexto da consulta de guias mudou."), { codigo: "CONTEXTO_ALTERADO" });

/** Consulta explicitamente agregada. Nunca prepara/executa ato nem altera o emissor de rascunho. */
export async function consultarGuiasDoResponsavel({ registro, recibo, conferirLease, client = prisma, cloud = null, agora = new Date(),
  piloto = [], telefonesPiloto = [], resolverVinculo = resolverVinculoPorTelefone, conferirJanela = janelaDaConversa,
  executar = executarFerramenta, log = console }) {
  const telefone = registro.conversa.telefoneE164;
  const conferir = async (portalClientId) => {
    await conferirLease();
    const atendimento = await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: recibo.atendimentoId } });
    const origem = await client.conversaWhatsapp.findUnique({ where: { id: registro.conversa.id } });
    if (!atendimento || atendimento.versao !== recibo.versao || atendimento.atendidaPor || atendimento.atendidaDesde
      || new Date(atendimento.expiraEm).getTime() <= Date.now() || !origem || origem.excluidaEm
      || (atendimento.automacaoInvalidadaEm && registro.mensagem.registradaEm <= atendimento.automacaoInvalidadaEm)
      || (origem.automacaoInvalidadaEm && registro.mensagem.registradaEm <= origem.automacaoInvalidadaEm)) throw recusa();
    const acesso = empresasAutorizadas(await resolverVinculo(telefone, { client }));
    const empresa = acesso.empresas.find(e => e.portalClientId === portalClientId);
    if (acesso.bloqueado || acesso.userId !== atendimento.userId || !empresa || !recibo.resultado?.empresas?.includes(portalClientId)) throw recusa();
    if ((await conferirJanela(origem.id, new Date())).situacao !== "ABERTA") throw recusa();
    const contatos = await client.contatoWhatsapp.findMany({ where: { portalClientId, ativo: true, OR: [{ telefoneE164: telefone }, { waId: telefone }] }, take: 2,
      select: { id: true, nome: true, userId: true, permissoesAssistente: true } });
    const contato = contatos.length === 1 ? contatos[0] : null;
    const vinculoRbac = contato?.userId ? await client.companyClientUser.findUnique({ where: { companyId_userId: { companyId: portalClientId, userId: contato.userId } } }) : null;
    const sessao = sessaoDoContato({ portalClientId, contato, vinculoRbac });
    if (!sessao.ok || sessao.userId !== atendimento.userId) throw recusa();
    return { empresa, sessao, liberado: definicoes(sessao).some(f => f.name === "quanto_devo") };
  };
  const whatsapp = cloud || new WhatsappCloudClient({ log });
  for (const portalClientId of recibo.resultado?.empresas || []) {
    const { empresa, sessao, liberado } = await conferir(portalClientId);
    const conversa = await garantirConversa({ telefone, portalClientId, client });
    const turnoIaId = `guias-todas:${registro.mensagem.id}:${portalClientId}`;
    const anterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: "out" } });
    if (anterior) continue; // Saída incerta fica registrada; nunca reenvia automaticamente.
    let resultado;
    const habilitado = telefonesPiloto.includes(telefone) || piloto.includes(portalClientId);
    if (!habilitado) resultado = { ok: false, mensagem: "A equipe atende as guias desta empresa; a consulta automática ainda não está habilitada." };
    else if (!liberado) resultado = { ok: false, mensagem: "O acesso deste contato não permite consultar guias desta empresa. A equipe pode conferir o cadastro." };
    else {
      try { resultado = await executar("quanto_devo", {}, { sessao, conversa, prisma: client, agora, janela: { aberta: true }, log }); }
      catch { resultado = { ok: false, mensagem: "Não consegui consultar as guias desta empresa agora. As outras consultas continuam separadamente." }; }
    }
    const linhas = (resultado.guias || []).slice(0, 10).map(g => `• ${g.tipo} · competência ${g.competencia || "não informada"} · ${g.valorFormatado || "valor não informado"} · vencimento ${g.vencimento || "não informado"}`);
    const corpo = [`Empresa: ${empresa.razao} · CNPJ ${empresa.cnpj}`, "",
      resultado.ok ? "Guias liberadas em aberto:" : resultado.mensagem,
      ...(resultado.ok ? linhas.length ? linhas : [resultado.observacao || "Não encontrei guias liberadas em aberto."] : []),
      (resultado.guias || []).length > 10 ? "Há mais guias no portal desta empresa." : null,
    ].filter(v => v !== null && v !== undefined).join("\n");
    await enviarMensagemRastreada({ conversa, corpo, autor: "SISTEMA", turnoIaId, client,
      antesDeEnviar: async () => { const atual = await conferir(portalClientId); if (liberado !== atual.liberado) throw recusa(); },
      enviar: () => whatsapp.enviarTexto({ telefone, texto: corpo }) });
  }
  await client.mensagemWhatsapp.updateMany({ where: { id: registro.mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
  return { tratadoContexto: true, motivo: "GUIAS_TODAS_EMPRESAS" };
}
