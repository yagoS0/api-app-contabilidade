import { OnboardingError } from './OnboardingService.js';
import { resolverConversaEnvioComercial } from './CanalEnvioComercialService.js';
import { capturarIdentidadeComercial, conferirIdentidadeComercial, assumirEnvioComercial } from './ContextoComercialService.js';
import { janelaDaConversa } from '../whatsapp/ConversaWhatsappService.js';
import { whatsappPorCanal } from '../whatsapp/CanalWhatsappService.js';
import { enviarMensagemRastreada } from '../whatsapp/SaidaWhatsappService.js';
import { adquirirLease, renovarLease, liberarLease } from '../whatsapp/WhatsappLeaseService.js';

const erro = (code, message) => new OnboardingError(code, message, 409);
const sucesso = new Set(['enviado', 'entregue', 'lido']);
export function criarEnvioVinculadoComercial({ db, janela = janelaDaConversa, transportePara = whatsappPorCanal, enviarRastreada = enviarMensagemRastreada,
  leases = { adquirir: adquirirLease, renovar: renovarLease, liberar: liberarLease } }) {
  async function estado(chave) {
    const saidas = await db.mensagemWhatsapp.findMany({ where: { direcao: 'out', referenciaComercial: { path: ['envioComercialChave'], equals: chave } }, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], select: { id: true, conversaId: true, statusEnvio: true } });
    const saida = saidas.find(s => !sucesso.has(s.statusEnvio) && s.statusEnvio !== 'falhou') || saidas.find(s => sucesso.has(s.statusEnvio)) || saidas[0];
    return { estado: !saida ? 'NAO_ENVIADO' : sucesso.has(saida.statusEnvio) ? 'ENVIADO' : saida.statusEnvio === 'falhou' ? 'FALHOU' : 'INCERTO', mensagemId: saida?.id || null, conversaId: saida?.conversaId || null };
  }
  async function enviar({ id, user, chave, conversaId, referencia, conferirContexto, preparar }) {
    await conferirContexto();
    const caso = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
    const c = await resolverConversaEnvioComercial({ caso, conversaId, db });
    const destinoOriginal = { telefoneE164: c.telefoneE164, canalId: c.canalId, vinculoNumeroId: c.vinculoNumeroId };
    const identidade = await capturarIdentidadeComercial(c, db);
    const lease = await leases.adquirir(`envio-comercial:${id}:${referencia.tipo}`, { client: db });
    if (!lease) throw erro('envio_em_andamento', 'Há um envio em andamento. Confira o histórico.');
    try {
      const conferir = async () => {
        if (!await leases.renovar(lease, { client: db })) throw erro('envio_em_andamento', 'A reserva expirou. Confira o envio antes de repetir.');
        await conferirContexto();
        const atualCaso = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
        if (atualCaso?.id !== caso.id) throw erro('atendimento_alterado', 'O atendimento mudou.');
        const atual = await resolverConversaEnvioComercial({ caso: atualCaso, conversaId: c.id, db });
        if (atual.telefoneE164 !== destinoOriginal.telefoneE164 || atual.canalId !== destinoOriginal.canalId || atual.vinculoNumeroId !== destinoOriginal.vinculoNumeroId) throw erro('destino_alterado', 'O destinatário mudou.');
        await conferirIdentidadeComercial(atual, identidade, db);
        if ((await janela(c.id)).situacao !== 'ABERTA') throw erro('FORA_DA_JANELA', 'Aguarde uma mensagem deste contato antes do envio.');
      };
      await conferir();
      const anterior = await estado(chave);
      if (anterior.estado === 'INCERTO') throw erro('envio_incerto', 'Existe um envio sem confirmação. Confira antes de repetir.');
      if (anterior.estado === 'ENVIADO') return { jaEnviado: true, envio: anterior };
      const conteudo = await preparar(); await conferir();
      const transporte = await transportePara(c, { client: db });
      await assumirEnvioComercial(c, user, identidade, db);
      const out = await enviarRastreada({ conversa: c, tipo: conteudo.pdf ? 'document' : 'text', corpo: conteudo.texto, autor: 'HUMANO', client: db,
        referenciaComercial: { ...referencia, onboardingId: id, envioComercialChave: chave }, antesDeEnviar: conferir,
        enviar: ({ antesDeEnviar } = {}) => conteudo.pdf
          ? transporte.enviarDocumento({ telefone: c.telefoneE164, conteudo: conteudo.pdf, mimeType: 'application/pdf', nomeArquivo: conteudo.nome, legenda: conteudo.texto, antesDeEnviar })
          : transporte.enviarTexto({ telefone: c.telefoneE164, texto: conteudo.texto, antesDeEnviar }) });
      return { enviado: true, envio: { estado: 'ENVIADO', mensagemId: out.mensagem?.id || null, conversaId: c.id } };
    } finally { await leases.liberar(lease, { client: db }); }
  }
  return { estado, enviar };
}
