import { prisma } from "../../infrastructure/db/prisma.js";
import { COMERCIAL_WEB_URL } from "../../config.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { exigirEscopo } from "./ComercialService.js";
import { criarPropostasComerciais } from "./PropostasComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { assinarMensagemHumana } from "../whatsapp/assinaturaAtendente.js";
import { janelaDaConversa } from "../whatsapp/ConversaWhatsappService.js";
import { whatsappPorCanal } from "../whatsapp/CanalWhatsappService.js";
import { adquirirLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { gerarPropostaPdf, propostaParaCliente } from "./PropostaComercialPdf.js";
import { exigirConversaDoCaso, capturarIdentidadeComercial, conferirIdentidadeComercial, assumirEnvioComercial } from "./ContextoComercialService.js";
import { exigirPropostaDefinitiva } from "./PoliticaJornadaComercial.js";
import { resolverConversaEnvioComercial } from "./CanalEnvioComercialService.js";
export async function enviarProposta(id, propostaId, user, {
  db = prisma,
  webUrl = COMERCIAL_WEB_URL,
  cloud = null,
  conversaId,
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
  const c = await resolverConversaEnvioComercial({ caso: lead, conversaId, db });
  if (!c || c.excluidaEm) throw new OnboardingError("conversa_indisponivel", "A conversa não está disponível.", 409);
  await exigirConversaDoCaso(lead, c, db);
  const identidade = await capturarIdentidadeComercial(c, db);
  const transporte = await whatsappPorCanal(c, { cloud, client: db });
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
      if (!proposta || !atual || atual.excluidaEm || atual.telefoneE164 !== c.telefoneE164 || atual.canalId !== c.canalId || atual.vinculoNumeroId !== c.vinculoNumeroId || String(atual.automacaoInvalidadaEm) !== String(c.automacaoInvalidadaEm)) throw new OnboardingError("atendimento_alterado", "Conversa ou proposta mudou durante o envio.", 409);
      const casoAtual = await db.atendimentoLead.findUnique({ where: { id: lead.id } });
      await exigirConversaDoCaso(casoAtual, atual, db);
      await resolverConversaEnvioComercial({ caso: casoAtual, conversaId: c.id, db });
      await conferirIdentidadeComercial(atual, identidade, db);
      const jornada = await exigirPropostaDefinitiva({ db, ficha: r, user });
      if (p.snapshot.diagnosticoId && jornada.diagnostico.id !== p.snapshot.diagnosticoId) throw new OnboardingError("diagnostico_alterado", "O diagnóstico mudou depois da aprovação da proposta.", 409);
      if ((await janela(c.id)).situacao !== "ABERTA") throw new OnboardingError("FORA_DA_JANELA", "A janela de resposta fechou. Aguarde uma mensagem do interessado ou use um modelo aprovado pela Meta.", 409);
    };
    await conferir();
    const {
      token
    } = await criarPropostasComerciais({
      db
    }).emitirLink(id, propostaId, user);
    const texto = assinarMensagemHumana(`Segue sua proposta de serviços em PDF, versão ${p.versao}, com as entregas e os valores. Para escolher a opção: ${webUrl}/proposta/publica#token=${token}\n\nDepois do aceite, prepararemos o contrato para assinatura.`, user, { limite: 1024 });
    const pdf = await gerarPropostaPdf(propostaParaCliente(p));
    await conferir();
    await assumirEnvioComercial(c, user, identidade, db);
    const out = await enviarMensagemRastreada({
      conversa: c,
      corpo: texto,
      tipo: "document",
      autor: "HUMANO",
      referenciaComercial: {
        tipo: "PROPOSTA",
        propostaId,
        versao: p.versao
      },
      client: db,
      antesDeEnviar: conferir,
      enviar: () => transporte.enviarDocumento({
        telefone: c.telefoneE164,
        conteudo: pdf,
        nomeArquivo: `proposta-altan-v${p.versao}.pdf`,
        legenda: texto
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
