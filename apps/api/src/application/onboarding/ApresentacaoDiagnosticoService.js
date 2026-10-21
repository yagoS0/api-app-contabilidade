import { hashApresentacao, conferenciaPdfVigente } from './IdentidadeApresentacao.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { exigirEscopo, criarServicoComercial } from './ComercialService.js';
import { exigirGestor } from './RecursosComerciaisService.js';
import { OnboardingError } from './OnboardingService.js';
import { carregarEvidenciasJornada } from './JornadaLeadService.js';
import { encerrado } from './LeadService.js';
import { apresentarDiagnostico, gerarApresentacaoDiagnosticoPdf } from './ApresentacaoDiagnosticoPdf.js';
import { resolverConversaEnvioComercial } from './CanalEnvioComercialService.js';
import { capturarIdentidadeComercial, conferirIdentidadeComercial, assumirEnvioComercial } from './ContextoComercialService.js';
import { janelaDaConversa } from '../whatsapp/ConversaWhatsappService.js';
import { whatsappPorCanal } from '../whatsapp/CanalWhatsappService.js';
import { enviarMensagemRastreada } from '../whatsapp/SaidaWhatsappService.js';
import { adquirirLease, renovarLease, liberarLease } from '../whatsapp/WhatsappLeaseService.js';

const erro = (code, message) => new OnboardingError(code, message, 409);
const enviados = new Set(['enviado', 'entregue', 'lido']);

// GETs only project/generate already-saved evidence. No provider queries or writes.
export function criarApresentacaoDiagnostico({ db = prisma, jornada = carregarEvidenciasJornada, gerarPdf = gerarApresentacaoDiagnosticoPdf,
  fiscal = criarServicoComercial({ db }),
  janela = janelaDaConversa, transportePara = whatsappPorCanal, enviarRastreada = enviarMensagemRastreada,
  leases = { adquirir: adquirirLease, renovar: renovarLease, liberar: liberarLease } } = {}) {
  async function contexto(id, user, diagnosticoId = null, banco = db) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, banco);
    if (encerrado(ficha)) throw erro('atendimento_encerrado', 'O atendimento está encerrado.');
    const j = await jornada(ficha, banco), diagnostico = j.diagnostico;
    if (!diagnostico || diagnosticoId && diagnosticoId !== diagnostico.id || j.diagnosticoPendencias?.length) throw erro('diagnostico_alterado', 'Conclua e confira o diagnóstico atual antes de preparar a apresentação.');
    const fiscal = diagnostico.dados?.analiseId ? j.analises?.find(a => a.id === diagnostico.dados.analiseId && a.cnpj === ficha.cnpj && a.tipo === 'SITFIS' && a.status === 'CONCLUIDA') : null;
    if (diagnostico.dados?.analiseId && (!fiscal?.resultado?.relatorioDisponivel || !fiscal.resultado?.leitura?.relatorio)) throw erro('relatorio_indisponivel', 'O relatório vinculado ao diagnóstico está indisponível. Revise a análise.');
    const cnpjFiscal = String(fiscal?.resultado?.leitura?.relatorio?.contribuinte?.cnpj || '').replace(/\D/g, '');
    if (cnpjFiscal && cnpjFiscal !== ficha.cnpj) throw erro('relatorio_cnpj_divergente', 'O relatório fiscal pertence a outro CNPJ.');
    const documento = apresentarDiagnostico({ ficha, diagnostico, fiscal });
    const chave = hashApresentacao(ficha, diagnostico, fiscal);
    return { ficha, diagnostico, documento, chave, fiscal, conferencia: j.devolutiva?.conferenciaPdf || null };
  }
  async function envioDo(chave) {
    const saidas = await db.mensagemWhatsapp.findMany({ where: { direcao: 'out', referenciaComercial: { path: ['apresentacaoChave'], equals: chave } },
      orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], select: { id: true, conversaId: true, statusEnvio: true } });
    const saida = saidas.find(s => ['enviando', 'indeterminado'].includes(s.statusEnvio)) || saidas.find(s => enviados.has(s.statusEnvio)) || saidas[0];
    return { estado: !saida ? 'NAO_ENVIADO' : enviados.has(saida.statusEnvio) ? 'ENVIADO' : ({ enviando: 'ENVIANDO', indeterminado: 'INCERTO', falhou: 'FALHOU' }[saida.statusEnvio] || 'INCERTO'), mensagemId: saida?.id || null, conversaId: saida?.conversaId || null };
  }
  function conferirHash(ctx, esperado) { if (!esperado || esperado !== ctx.chave) throw erro('apresentacao_alterada', 'A apresentação mudou. Abra a versão atual antes de continuar.'); }
  async function carregar(id, user) {
    const ctx = await contexto(id, user);
    return { diagnosticoId: ctx.diagnostico.id, conteudoHash: ctx.chave, versao: ctx.ficha.versao, conferencia: ctx.conferencia, envio: await envioDo(ctx.chave) };
  }
  async function conferir(id, diagnosticoId, user, body = {}) {
    exigirGestor(user);
    if (body.confirmado !== true || !Number.isInteger(body.versao)) throw erro('conferencia_invalida', 'Confirme explicitamente a conferência do PDF atual.');
    return db.$transaction(async tx => {
      await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro('formulario_alterado', 'A ficha mudou. Confira novamente a apresentação.');
      const ctx = await contexto(id, user, diagnosticoId, tx); conferirHash(ctx, body.conteudoHash);
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'JORNADA_DEVOLUTIVA_CONFERIDA', dados: { path: ['diagnosticoId'], equals: diagnosticoId } }, orderBy: { createdAt: 'desc' } });
      if (conferenciaPdfVigente(anterior, ctx.ficha, ctx.diagnostico, ctx.fiscal)) return { conferencia: anterior, jaConferida: true };
      const conferencia = await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'JORNADA_DEVOLUTIVA_CONFERIDA', atorId: user.id,
        dados: { origem: 'PDF_CONTADOR', diagnosticoId, conteudoHash: ctx.chave, fichaVersao: ctx.ficha.versao, cadastroRevisao: ctx.ficha.dados?.cadastroRevisao || 0, enviadoAoCliente: false } } });
      return { conferencia };
    });
  }
  async function documento(id, diagnosticoId, user, conteudoHash) {
    const ctx = await contexto(id, user, diagnosticoId); conferirHash(ctx, conteudoHash);
    const pdf = await gerarPdf(ctx.documento);
    conferirHash(await contexto(id, user, diagnosticoId), conteudoHash);
    return pdf;
  }
  async function enviar(id, diagnosticoId, user, body = {}) {
    const ctx = await contexto(id, user, diagnosticoId); conferirHash(ctx, body.conteudoHash);
    const provaFiscal = ctx.diagnostico.dados?.analiseId ? await fiscal.conferirEnvioFiscal(id, ctx.diagnostico.dados.analiseId, user) : null;
    const caso = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
    const c = await resolverConversaEnvioComercial({ caso, conversaId: body.conversaId, db });
    const destinoOriginal = { telefoneE164: c.telefoneE164, canalId: c.canalId, vinculoNumeroId: c.vinculoNumeroId };
    const identidade = await capturarIdentidadeComercial(c, db);
    const lease = await leases.adquirir(`apresentacao-lead:${id}`, { client: db });
    if (!lease) throw erro('envio_em_andamento', 'Já existe um envio da apresentação em andamento.');
    try {
      const conferir = async () => {
        if (!await leases.renovar(lease, { client: db })) throw erro('envio_em_andamento', 'A reserva expirou. Confira o envio antes de repetir.');
        conferirHash(await contexto(id, user, diagnosticoId), ctx.chave);
        if (provaFiscal && await fiscal.conferirEnvioFiscal(id, ctx.diagnostico.dados.analiseId, user) !== provaFiscal) throw erro('relatorio_alterado', 'A autorização ou o relatório fiscal mudou. Confira novamente.');
        const atualCaso = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
        if (atualCaso?.id !== caso.id) throw erro('atendimento_alterado', 'O atendimento mudou durante a preparação.');
        const destino = await resolverConversaEnvioComercial({ caso: atualCaso, conversaId: c.id, db });
        if (destino.telefoneE164 !== destinoOriginal.telefoneE164 || destino.canalId !== destinoOriginal.canalId || destino.vinculoNumeroId !== destinoOriginal.vinculoNumeroId) throw erro('destino_alterado', 'O destinatário mudou durante a preparação.');
        await conferirIdentidadeComercial(destino, identidade, db);
        if ((await janela(c.id)).situacao !== 'ABERTA') throw erro('FORA_DA_JANELA', 'Aguarde uma mensagem deste contato para enviar a apresentação.');
      };
      await conferir();
      const anterior = await envioDo(ctx.chave);
      if (['INCERTO', 'ENVIANDO'].includes(anterior.estado)) throw erro('envio_incerto', 'Existe um envio sem confirmação. Confira o histórico antes de repetir.');
      if (anterior.estado === 'ENVIADO') return { jaEnviado: true, envio: anterior };
      const pdf = await gerarPdf(ctx.documento); await conferir();
      const transporte = await transportePara(c, { client: db });
      await assumirEnvioComercial(c, user, identidade, db);
      const legenda = 'Apresentação da empresa e dos serviços propostos · ALTAN';
      const out = await enviarRastreada({ conversa: c, tipo: 'document', corpo: legenda, autor: 'HUMANO', client: db,
        referenciaComercial: { tipo: 'APRESENTACAO_DIAGNOSTICO', onboardingId: id, diagnosticoId, apresentacaoChave: ctx.chave, parte: 'APRESENTACAO', fichaVersao: ctx.ficha.versao,
          cadastroRevisao: ctx.ficha.dados?.cadastroRevisao || 0, diagnosticoContexto: ctx.diagnostico.dados?.contexto },
        antesDeEnviar: conferir,
        enviar: ({ antesDeEnviar } = {}) => transporte.enviarDocumento({ telefone: c.telefoneE164, conteudo: pdf, mimeType: 'application/pdf', nomeArquivo: 'apresentacao-altan.pdf', legenda, antesDeEnviar }) });
      return { enviado: true, envio: { estado: 'ENVIADO', conversaId: c.id, mensagemId: out.mensagem?.id || null } };
    } finally { await leases.liberar(lease, { client: db }); }
  }
  return { carregar, documento, enviar, conferir };
}
