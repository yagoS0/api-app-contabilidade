import { prisma } from "../../infrastructure/db/prisma.js";
import { WHATSAPP_COLETA_COMERCIAL } from "../../config.js";
import { coletarComercialWhatsapp } from "../onboarding/ColetaComercialWhatsappService.js";
import { comLeaseDoAtendimento } from "./AtendimentoResponsavelWhatsappService.js";
import { janelaDaConversa } from "./ConversaWhatsappService.js";
import { enviarMensagemRastreada } from "./SaidaWhatsappService.js";
import { whatsappPorCanal } from "./CanalWhatsappService.js";

/** Adaptador determinístico. O coletor persiste campos/recibo; só esta camada conhece transporte. */
export async function responderColetaComercial({ registro, item, agora = new Date(), client = prisma, cloud = null, flag = WHATSAPP_COLETA_COMERCIAL, piloto, coletar = coletarComercialWhatsapp, conferirJanela = janelaDaConversa } = {}) {
  if (!flag) return { tratado: false, motivo: "COLETA_DESLIGADA" };
  return comLeaseDoAtendimento({ conversa: registro.conversa, client }, async conferirLease => coletar({ registro, item, deps: {
    client, flag, agora, ...(piloto ? { piloto } : {}),
    enviar: async ({ conversa, texto, referenciaComercial, antesDeEnviar }) => {
      const turnoIaId = `coleta-comercial:${registro.mensagem.id}`;
      // Uma saída reservada, inclusive incerta, jamais é repetida no replay do webhook.
      if (await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: "out" } })) return;
      const conferir = async () => {
        await conferirLease();
        await antesDeEnviar();
        if ((await conferirJanela(conversa.id, new Date())).situacao !== "ABERTA") throw Object.assign(new Error("A janela deste canal encerrou. A equipe pode retomar o atendimento."), { codigo: "FORA_DA_JANELA" });
      };
      await conferir();
      const whatsapp = await whatsappPorCanal(conversa, { cloud, client });
      await enviarMensagemRastreada({ conversa, corpo: texto, autor: "SISTEMA", turnoIaId, referenciaComercial, client, antesDeEnviar: conferir,
        enviar: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto }) });
      await client.mensagemWhatsapp.updateMany({ where: { id: registro.mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
    },
  } }));
}
