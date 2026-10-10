import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { exigirEscopo, procuracaoHabilitaSitfis } from './ComercialService.js';
import { exigirGestor } from './RecursosComerciaisService.js';
import { OnboardingError } from './OnboardingService.js';
import { encerrado } from './LeadService.js';
import { resolverConversaEnvioComercial } from './CanalEnvioComercialService.js';
import { exigirConversaDoCaso, capturarIdentidadeComercial, conferirIdentidadeComercial, assumirEnvioComercial } from './ContextoComercialService.js';
import { gerarPdfSitfisTabela } from '../fiscal/serpro/gerarPdfSitfisTabela.js';
import { getSerproRuntimeSettings } from '../fiscal/serpro/SerproRuntimeSettings.js';
import { janelaDaConversa } from '../whatsapp/ConversaWhatsappService.js';
import { whatsappPorCanal } from '../whatsapp/CanalWhatsappService.js';
import { enviarMensagemRastreada } from '../whatsapp/SaidaWhatsappService.js';
import { adquirirLease, renovarLease, liberarLease } from '../whatsapp/WhatsappLeaseService.js';
import { obterConsumoAtendimentoComercial } from './ConsumoAtendimentoComercial.js';

const erro = (code, message) => new OnboardingError(code, message, 409);
const canonico = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(canonico(value)).digest('hex');
const dataBR = value => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
const estadosEnvio = { enviado: 'ENVIADO', entregue: 'ENVIADO', lido: 'ENVIADO', enviando: 'ENVIANDO', indeterminado: 'INCERTO', falhou: 'FALHOU' };

// A tabela usa somente a análise do lead. Não cria empresa, vínculo fiscal ou consulta.
export function criarRelatorioFiscalLead({ db = prisma, cloud = null, gerarPdf = gerarPdfSitfisTabela,
  procuradorAtual = async () => (await getSerproRuntimeSettings()).certificate.document,
  consumo = obterConsumoAtendimentoComercial, janela = janelaDaConversa,
  enviarRastreada = enviarMensagemRastreada,
  transportePara = whatsappPorCanal, leases = { adquirir: adquirirLease, renovar: renovarLease, liberar: liberarLease },
  agora = () => new Date() } = {}) {
  async function contexto(id, user, analiseId = null, client = db) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, client);
    if (encerrado(ficha)) throw erro('atendimento_encerrado', 'O atendimento está encerrado.');
    const caso = await client.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
    if (!caso?.representanteVerificadoEm || caso.autorizacao?.cnpj !== ficha.cnpj) throw erro('representante_nao_verificado', 'Confira o representante e o CNPJ deste atendimento.');
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: caso.conversaId } });
    await exigirConversaDoCaso(caso, conversa, client);
    if (caso.autorizacao.estado !== 'ATIVA' || !procuracaoHabilitaSitfis(caso.autorizacao.prova, agora())) throw erro('procuracao_nao_verificada', 'Verifique uma procuração vigente para SITFIS antes de acessar o relatório.');
    const procurador = String(await procuradorAtual() || '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(procurador) || procurador !== String(caso.autorizacao.prova.procuradorCnpj || '').replace(/\D/g, '')) throw erro('procurador_alterado', 'O procurador configurado mudou. Verifique a autorização novamente.');
    const analise = await client.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!analise || analiseId && analise.id !== analiseId || !analise.documentoCifrado || !analise.resultado?.relatorioDisponivel || !analise.resultado?.leitura?.relatorio) throw erro('tabela_fiscal_indisponivel', 'Conclua a leitura do relatório fiscal atual antes de preparar a tabela.');
    const cnpjNoRelatorio = String(analise.resultado.leitura.relatorio.contribuinte?.cnpj || '').replace(/\D/g, '');
    if (cnpjNoRelatorio && cnpjNoRelatorio !== ficha.cnpj) throw erro('relatorio_cnpj_divergente', 'O documento contém outro CNPJ. Confira o relatório original antes de continuar.');
    const chave = hash({ analiseId: analise.id, analiseCriadaEm: analise.createdAt, razaoSocial: ficha.dados?.razaoSocial || null, cnpj: ficha.cnpj, resultado: analise.resultado,
      documento: analise.documentoCifrado, representante: caso.representanteVerificadoEm,
      evidencia: caso.evidenciaRepresentante, autorizacao: caso.autorizacao,
      interlocutorId: caso.interlocutorId || null, conversaId: caso.conversaId,
      vinculoNumeroId: conversa.vinculoNumeroId || null, telefone: conversa.telefoneE164 });
    return { ficha, caso, conversa, analise, chave };
  }
  async function revisaoDo(ctx, client = db) {
    return client.onboardingEvento.findFirst({ where: { onboardingId: ctx.ficha.id, tipo: 'FISCAL_TABELA_REVISADA', dados: { path: ['chave'], equals: ctx.chave } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }
  async function envioDo(chave, conversaId) {
    const saidas = await db.mensagemWhatsapp.findMany({ where: { direcao: 'out', ...(conversaId ? { conversaId } : {}), referenciaComercial: { path: ['relatorioFiscalChave'], equals: chave } }, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], take: 30,
      select: { id: true, conversaId: true, statusEnvio: true } });
    const saida = saidas.find(s => ['enviando', 'indeterminado'].includes(s.statusEnvio))
      || saidas.find(s => ['enviado', 'entregue', 'lido'].includes(s.statusEnvio)) || saidas[0];
    return { estado: estadosEnvio[saida?.statusEnvio] || 'NAO_ENVIADO', conversaId: saida?.conversaId || null, mensagemId: saida?.id || null };
  }
  async function carregar(id, user) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const caso = await db.atendimentoLead.findFirst({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' } });
    const consumoAtual = await consumo({ db, onboardingId: id, conversaId: caso?.conversaId, desde: caso?.createdAt || ficha.createdAt, ate: caso?.encerradoEm || undefined });
    let ctx;
    try { ctx = await contexto(id, user); }
    catch (e) { if (!(e instanceof OnboardingError)) throw e; return { relatorios: [], consumo: consumoAtual, bloqueio: { codigo: e.code, mensagem: e.message } }; }
    const revisao = await revisaoDo(ctx);
    return { relatorios: [{ id: ctx.analise.id, cnpj: ctx.ficha.cnpj, createdAt: ctx.analise.createdAt, status: ctx.analise.status,
      tabelaDisponivel: true, conteudoHash: ctx.chave, revisadoEm: revisao?.createdAt || null, revisadoPor: revisao?.atorId || null,
      envio: await envioDo(ctx.chave) }], consumo: consumoAtual };
  }
  async function pdfDo(ctx) {
    return gerarPdf({ relatorio: ctx.analise.resultado.leitura.relatorio,
      empresa: { razao: ctx.ficha.dados?.razaoSocial || ctx.analise.resultado.leitura.relatorio.contribuinte?.nome, cnpj: ctx.ficha.cnpj },
      escritorio: 'ALTAN',
      consultadaEm: dataBR(ctx.analise.resultado.consultadoEm || ctx.analise.createdAt),
      relatorioDe: ctx.analise.resultado.leitura.relatorio.emitidoEm || null });
  }
  async function tabela(id, analiseId, user, conteudoHash) {
    const ctx = await contexto(id, user, analiseId);
    if (!conteudoHash || conteudoHash !== ctx.chave) throw erro('relatorio_alterado', 'O relatório mudou. Recarregue a análise antes de abrir a tabela.');
    const pdf = await pdfDo(ctx);
    if ((await contexto(id, user, analiseId)).chave !== ctx.chave) throw erro('relatorio_alterado', 'O relatório ou a autorização mudou durante a preparação.');
    return pdf;
  }
  async function revisar(id, analiseId, user, body = {}) {
    if (!Number.isInteger(body.versao)) throw erro('formulario_alterado', 'Recarregue a ficha antes de confirmar a revisão.');
    return db.$transaction(async tx => {
      const ctx = await contexto(id, user, analiseId, tx);
      if (ctx.ficha.versao !== body.versao) throw erro('formulario_alterado', 'A ficha mudou. Confira o relatório novamente.');
      if (!body.conteudoHash || body.conteudoHash !== ctx.chave) throw erro('relatorio_alterado', 'O relatório mudou. Abra e confira a tabela atual antes de revisar.');
      const trava = await tx.onboarding.updateMany({ where: { id, versao: body.versao, cnpj: ctx.ficha.cnpj }, data: { updatedAt: agora() } });
      if (!trava.count) throw erro('formulario_alterado', 'A ficha mudou. Confira o relatório novamente.');
      const anterior = await revisaoDo(ctx, tx);
      const registro = anterior || await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'FISCAL_TABELA_REVISADA', atorId: user.id,
        dados: { analiseId, cnpj: ctx.ficha.cnpj, chave: ctx.chave } } });
      const jornada = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'JORNADA_SITFIS_CONFERIDA', dados: { path: ['analiseId'], equals: analiseId } } });
      if (!jornada) await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'JORNADA_SITFIS_CONFERIDA', atorId: user.id,
        dados: { analiseId, cnpj: ctx.ficha.cnpj, revisaoFiscalId: registro.id } } });
      return { revisadoEm: registro.createdAt, revisadoPor: registro.atorId };
    });
  }
  async function enviar(id, analiseId, user, body = {}) {
    const ctx = await contexto(id, user, analiseId);
    if (!await revisaoDo(ctx)) throw erro('relatorio_nao_revisado', 'Revise a tabela fiscal antes de enviar.');
    const c = await resolverConversaEnvioComercial({ caso: ctx.caso, conversaId: body.conversaId, db });
    const identidade = await capturarIdentidadeComercial(c, db);
    const lease = await leases.adquirir(`fiscal-lead:${id}`, { client: db });
    if (!lease) throw erro('envio_em_andamento', 'Já existe um envio fiscal em andamento.');
    try {
      const conferir = async () => {
        if (!await leases.renovar(lease, { client: db })) throw erro('envio_em_andamento', 'A reserva expirou. Confira o histórico.');
        const atual = await contexto(id, user, analiseId);
        if (atual.chave !== ctx.chave || !await revisaoDo(atual)) throw erro('relatorio_alterado', 'O relatório, representante ou autorização mudou. Revise novamente.');
        const destino = await resolverConversaEnvioComercial({ caso: atual.caso, conversaId: c.id, db });
        if (destino.telefoneE164 !== c.telefoneE164 || destino.canalId !== c.canalId || destino.vinculoNumeroId !== c.vinculoNumeroId) throw erro('destino_alterado', 'O destinatário mudou durante o envio.');
        await conferirIdentidadeComercial(destino, identidade, db);
        if ((await janela(c.id)).situacao !== 'ABERTA') throw erro('FORA_DA_JANELA', 'Aguarde uma mensagem deste contato para enviar o relatório.');
      };
      await conferir();
      const anterior = await envioDo(ctx.chave);
      if (['INCERTO', 'ENVIANDO'].includes(anterior.estado)) throw erro('envio_incerto', 'Existe um envio sem confirmação. Confira o histórico antes de repetir.');
      if (anterior.estado === 'ENVIADO') return { jaEnviado: true, envio: anterior };
      const pdf = await pdfDo(ctx);
      await conferir();
      const transporte = await transportePara(c, { cloud, client: db });
      await assumirEnvioComercial(c, user, identidade, db);
      const legenda = `Situação fiscal · CNPJ ${ctx.ficha.cnpj} · tabela conferida pelo escritório`;
      const out = await enviarRastreada({ conversa: c, tipo: 'document', corpo: legenda, autor: 'HUMANO', client: db,
        referenciaComercial: { tipo: 'FISCAL_TABELA_LEAD', relatorioFiscalChave: ctx.chave, onboardingId: id, analiseId },
        antesDeEnviar: conferir,
        enviar: () => transporte.enviarDocumento({ telefone: c.telefoneE164, conteudo: pdf, mimeType: 'application/pdf', nomeArquivo: 'situacao-fiscal-tabela.pdf', legenda }) });
      return { enviado: true, envio: { estado: 'ENVIADO', conversaId: c.id, mensagemId: out.mensagem?.id || null } };
    } finally { await leases.liberar(lease, { client: db }); }
  }
  return { carregar, tabela, revisar, enviar };
}
