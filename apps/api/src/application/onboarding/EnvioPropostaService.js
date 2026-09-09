import { prisma } from "../../infrastructure/db/prisma.js";
import { COMERCIAL_WEB_URL } from "../../config.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { exigirEscopo } from "./ComercialService.js";
import { criarPropostasComerciais } from "./PropostasComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { janelaDaConversa } from "../whatsapp/ConversaWhatsappService.js";
import { WhatsappCloudClient } from "../whatsapp/WhatsappCloudClient.js";
import { adquirirLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
export async function enviarProposta(id, propostaId, user, {
  db = prisma,
  webUrl = COMERCIAL_WEB_URL,
  cloud = new WhatsappCloudClient(),
  janela = janelaDaConversa
} = {}) {
  exigirGestor(user);
  const r = await exigirEscopo(id, user, db);
  if (!/^https:\/\/[^/]+/.test(webUrl)) throw new OnboardingError("endereco_comercial_ausente", "Configure o endereço HTTPS das propostas públicas.", 409);
  const p = await db.propostaComercial.findFirst({
    where: {
      id: propostaId,
      onboardingId: id,
      status: "APROVADA",
      revogadaEm: null,
      expiraEm: {
        gt: new Date()
      }
    }
  });
  if (!p || p.fichaVersao !== r.versao) throw new OnboardingError("proposta_indisponivel", "Gere e aprove a versão atual da proposta.", 409);
  const lead = await db.atendimentoLead.findFirst({
    where: {
      onboardingId: id,
      encerradoEm: null
    },
    include: {
      conversa: true
    }
  });
  const c = lead?.conversa;
  if (!c || c.portalClientId || c.excluidaEm) throw new OnboardingError("conversa_indisponivel", "A conversa de lead não está disponível.", 409);
  const lease = await adquirirLease(`proposta:${propostaId}`, {
    client: db
  });
  if (!lease) throw new OnboardingError("envio_em_andamento", "Já existe um envio desta proposta em andamento.", 409);
  try {
    const anterior = await db.mensagemWhatsapp.findFirst({
      where: {
        conversaId: c.id,
        direcao: "out",
        referenciaComercial: {
          path: ["propostaId"],
          equals: propostaId
        },
        statusEnvio: {
          not: "falhou"
        }
      }
    });
    if (anterior) throw new OnboardingError("envio_ja_registrado", "Já existe uma saída desta versão. Confira o histórico e o recibo antes de reenviar.", 409);
    const conferir = async () => {
      const atual = await db.conversaWhatsapp.findUnique({
        where: {
          id: c.id
        }
      });
      const proposta = await db.propostaComercial.findFirst({
        where: {
          id: propostaId,
          status: "APROVADA",
          revogadaEm: null,
          expiraEm: {
            gt: new Date()
          },
          onboarding: {
            versao: p.fichaVersao
          }
        }
      });
      if (!proposta || !atual || atual.excluidaEm || atual.portalClientId || String(atual.automacaoInvalidadaEm) !== String(c.automacaoInvalidadaEm)) throw new OnboardingError("atendimento_alterado", "Conversa ou proposta mudou durante o envio.", 409);
      if ((await janela(c.id)).situacao !== "ABERTA") throw new OnboardingError("FORA_DA_JANELA", "A janela de resposta fechou. Aguarde uma mensagem do interessado ou use um modelo aprovado pela Meta.", 409);
    };
    await conferir();
    const {
      token
    } = await criarPropostasComerciais({
      db
    }).emitirLink(id, propostaId, user);
    const texto = `Preparamos sua proposta de serviços, versão ${p.versao}. Confira as opções, o escopo e os valores: ${webUrl}/proposta/publica#token=${token}\n\nVocê pode escolher a opção pelo link. Depois vamos conferir o contrato para assinatura.`;
    await db.conversaWhatsapp.update({
      where: {
        id: c.id
      },
      data: {
        atendidaPor: user.id,
        atendidaDesde: new Date()
      }
    });
    const out = await enviarMensagemRastreada({
      conversa: c,
      corpo: texto,
      autor: "HUMANO",
      referenciaComercial: {
        tipo: "PROPOSTA",
        propostaId,
        versao: p.versao
      },
      client: db,
      antesDeEnviar: conferir,
      enviar: () => cloud.enviarTexto({
        telefone: c.telefoneE164,
        texto
      })
    });
    await db.propostaComercial.updateMany({
      where: {
        id: propostaId,
        status: "APROVADA"
      },
      data: {
        status: "ENVIADA",
        enviadaEm: new Date()
      }
    });
    return {
      mensagemId: out.mensagem.id,
      statusEnvio: out.mensagem.statusEnvio
    };
  } finally {
    await liberarLease(lease, {
      client: db
    });
  }
}
