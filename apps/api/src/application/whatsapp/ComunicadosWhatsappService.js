import { randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { WhatsappCloudClient } from './WhatsappCloudClient.js';
import { criarModelosMeta } from './ModelosMetaService.js';
import { agruparDestinatarios, validarAviso, erroComunicado, modeloDoComunicado, conferirModelo, hashPrevia } from './comunicados.js';
import { garantirConversa } from './ConversaWhatsappService.js';
import { enviarMensagemRastreada } from './SaidaWhatsappService.js';
import { chaveLeaseResponsavel } from './AtendimentoResponsavelWhatsappService.js';
import { adquirirLease, renovarLease, liberarLease } from './WhatsappLeaseService.js';

const selectContato = { id: true, nome: true, telefoneE164: true, portalClientId: true, ativo: true, optInEm: true,
  portalClient: { select: { razao: true, cnpj: true } } };
const permitido = u => ['admin', 'contador'].includes(String(u?.role).toLowerCase()) && String(u?.status).toLowerCase() === 'active';
const final = c => ['CANCELADO', 'CONCLUIDO'].includes(c.status);

export function criarComunicadosWhatsapp({ client = prisma, meta = criarModelosMeta(), cloud = null,
  enviar = enviarMensagemRastreada, conversa = garantirConversa, lease = { adquirirLease, renovarLease, liberarLease } } = {}) {
  const transporte = cloud || new WhatsappCloudClient();
  async function carregar(id, visiveis) {
    const c = await client.comunicadoWhatsapp.findUnique({ where: { id }, include: { destinatarios: { orderBy: { telefone: 'asc' } } } });
    if (!c || !c.empresasIds.every(e => visiveis.includes(e))) throw erroComunicado('Comunicado não encontrado.', 404);
    return c;
  }
  async function audiencia(input, visiveis) {
    if (input.empresasIds !== undefined && !Array.isArray(input.empresasIds)) throw erroComunicado('Selecione uma lista de empresas.');
    const empresasIds = [...new Set(input.empresasIds || visiveis)].sort();
    if (!empresasIds.length || !empresasIds.every(e => typeof e === 'string' && visiveis.includes(e))) throw erroComunicado('Selecione empresas da sua carteira.');
    const contatos = await client.contatoWhatsapp.findMany({ where: { portalClientId: { in: empresasIds }, ativo: true }, select: selectContato });
    const grupos = agruparDestinatarios(contatos);
    if (input.telefones) {
      if (!Array.isArray(input.telefones) || !input.telefones.every(t => grupos.destinatarios.some(d => d.telefone === t))) throw erroComunicado('A lista de destinatários mudou. Atualize a prévia.', 409);
      grupos.destinatarios = grupos.destinatarios.filter(d => input.telefones.includes(d.telefone));
    }
    return { ...grupos, empresasIds, empresasSemContato: empresasIds.filter(e => !contatos.some(c => c.portalClientId === e)).length };
  }
  async function atuais(c) {
    const contatos = await client.contatoWhatsapp.findMany({ where: { id: { in: c.destinatarios.flatMap(d => d.contatosIds) }, portalClientId: { in: c.empresasIds }, ativo: true }, select: selectContato });
    const grupos = agruparDestinatarios(contatos).destinatarios;
    return c.destinatarios.map(d => ({ ...d, elegivel: grupos.some(g => g.telefone === d.telefone && g.contatosIds.some(id => d.contatosIds.includes(id))) }));
  }
  async function detalhe(id, visiveis) {
    const c = await carregar(id, visiveis), destinatarios = await atuais(c);
    const mensagens = await client.mensagemWhatsapp.findMany({ where: { turnoIaId: { in: destinatarios.map(d => `comunicado:${d.id}`) }, direcao: 'out' },
      select: { id: true, turnoIaId: true, statusEnvio: true, erroEnvioMensagem: true } });
    const porTurno = new Map(mensagens.map(m => [m.turnoIaId, m]));
    return { ...c, previaHash: hashPrevia(c, destinatarios), destinatarios: destinatarios.map(d => {
      const m = porTurno.get(`comunicado:${d.id}`);
      return { ...d, mensagemId: m?.id || d.mensagemId, entrega: m?.statusEnvio || null, erroEntrega: m?.erroEnvioMensagem || null };
    }) };
  }
  async function criar(input, visiveis, userId) {
    const dados = validarAviso(input);
    if (input.empresasIds !== undefined && !Array.isArray(input.empresasIds) || input.telefones !== undefined && !Array.isArray(input.telefones)) throw erroComunicado('Confira a lista de empresas e destinatários.');
    if (!/^[0-9a-f-]{36}$/i.test(input.idempotencia || '')) throw erroComunicado('Atualize a página para iniciar o comunicado.');
    const anterior = await client.comunicadoWhatsapp.findUnique({ where: { idempotencia: input.idempotencia }, include: { destinatarios: { select: { telefone: true } } } });
    if (anterior) {
      const igual = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
      if (anterior.criadoPor !== userId || anterior.corpo !== dados.corpo || anterior.titulo !== dados.titulo
        || !igual(input.empresasIds || visiveis, anterior.empresasIds)
        || input.telefones && !igual(input.telefones, anterior.destinatarios.map(d => d.telefone))
        || anterior.status === 'RASCUNHO' && anterior.categoria !== dados.categoria) throw erroComunicado('Essa prévia já foi salva. Abra um novo comunicado.', 409);
      return detalhe(anterior.id, visiveis);
    }
    const publico = await audiencia(input, visiveis);
    if (!publico.destinatarios.length) throw erroComunicado('Não há contatos habilitados para esse envio. Confira o cadastro e a autorização de WhatsApp.');
    const id = randomUUID();
    try {
      await client.comunicadoWhatsapp.create({ data: { id, ...dados, empresasIds: publico.empresasIds, criadoPor: userId,
        idempotencia: input.idempotencia, nomeMeta: `altan_aviso_${id.replaceAll('-', '')}`,
        destinatarios: { create: publico.destinatarios.map(({ telefone, nome, contatosIds, empresasIds }) => ({ telefone, nome, contatosIds, empresasIds })) } } });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      return criar(input, visiveis, userId);
    }
    return detalhe(id, visiveis);
  }
  async function registrarModelo(c, modelo) {
    if (!modelo || !conferirModelo(c, modelo)) throw erroComunicado('A Meta ainda não retornou este modelo com o mesmo texto. Aguarde e consulte novamente.', 409);
    if (!['MARKETING', 'UTILITY'].includes(modelo.category)) throw erroComunicado('A categoria retornada pela Meta não é compatível com este aviso.', 409);
    const aprovado = modelo.status === 'APPROVED';
    const status = aprovado ? (c.status === 'ENVIANDO' && c.categoria === modelo.category ? 'ENVIANDO' : 'APROVADO')
      : modelo.status === 'PENDING' ? 'EM_ANALISE' : 'PAUSADO';
    const r = await client.comunicadoWhatsapp.updateMany({ where: { id: c.id, status: c.status, updatedAt: c.updatedAt },
      data: { metaId: modelo.id, statusMeta: modelo.status, categoria: modelo.category, conferidoNaMetaEm: new Date(), status,
        motivo: aprovado ? null : modelo.status === 'PENDING' ? 'Aguardando aprovação da Meta.' : `A Meta retornou ${modelo.status}. O envio está bloqueado.` } });
    if (!r.count) throw erroComunicado('O comunicado mudou. Atualize a tela.', 409);
  }
  async function submeter(id, visiveis) {
    const c = await carregar(id, visiveis);
    if (c.status !== 'RASCUNHO') throw erroComunicado('Este comunicado já foi submetido. Use Consultar aprovação.', 409);
    const r = await client.comunicadoWhatsapp.updateMany({ where: { id, status: 'RASCUNHO' }, data: { status: 'SUBMETENDO', motivo: 'Consultando e submetendo o modelo à Meta.' } });
    if (!r.count) throw erroComunicado('A submissão já começou.', 409);
    try {
      let modelo = await meta.consultar(c.nomeMeta);
      if (!modelo) {
        const retorno = await meta.criar(modeloDoComunicado(c));
        await client.comunicadoWhatsapp.updateMany({ where: { id, status: 'SUBMETENDO' }, data: { metaId: retorno.id || null, status: 'EM_ANALISE', statusMeta: retorno.status || 'PENDING', motivo: 'Modelo submetido. Consulte a aprovação antes de enviar.' } });
      } else await registrarModelo(await carregar(id, visiveis), modelo);
    } catch (e) {
      // Não volta a RASCUNHO: resposta incerta pode ter criado o modelo. Nova tentativa só consulta.
      await client.comunicadoWhatsapp.updateMany({ where: { id, status: 'SUBMETENDO' }, data: { motivo: e.status ? e.message : 'Resposta da Meta não confirmada. Consulte a aprovação.' } });
      throw e;
    }
    return detalhe(id, visiveis);
  }
  async function consultar(id, visiveis) {
    const c = await carregar(id, visiveis);
    if (final(c) || c.status === 'RASCUNHO') return detalhe(id, visiveis);
    await registrarModelo(c, await meta.consultar(c.nomeMeta));
    return detalhe(id, visiveis);
  }
  async function confirmar(id, visiveis, hash, userId) {
    let c = await carregar(id, visiveis);
    if (c.status === 'ENVIANDO' || c.status === 'CONCLUIDO') return detalhe(id, visiveis);
    if (c.status !== 'APROVADO') throw erroComunicado('Aguarde a aprovação e revise os destinatários antes de enviar.', 409);
    const modelo = await meta.consultar(c.nomeMeta);
    if (!conferirModelo(c, modelo) || modelo.status !== 'APPROVED' || modelo.category !== c.categoria) {
      throw erroComunicado('O modelo ou a categoria mudou na Meta. Consulte a aprovação e revise novamente.', 409);
    }
    const ds = await atuais(c);
    if (hash !== hashPrevia(c, ds)) throw erroComunicado('A prévia mudou. Confira os destinatários e confirme novamente.', 409);
    if (!ds.some(d => d.status === 'PENDENTE' && d.elegivel)) throw erroComunicado('Não há destinatários pendentes habilitados para o envio.', 409);
    await client.$transaction(async tx => {
      const r = await tx.comunicadoWhatsapp.updateMany({ where: { id, status: 'APROVADO', updatedAt: c.updatedAt }, data: { status: 'ENVIANDO', confirmadoEm: new Date(), confirmadoPor: userId, motivo: null } });
      if (!r.count) throw erroComunicado('O comunicado mudou. Atualize a tela.', 409);
      await tx.destinatarioComunicadoWhatsapp.updateMany({ where: { comunicadoId: id, status: 'PENDENTE', id: { in: ds.filter(d => !d.elegivel).map(d => d.id) } },
        data: { status: 'EXCLUIDO', motivo: 'Cadastro ou autorização de WhatsApp mudou.', concluidoEm: new Date() } });
    });
    return detalhe(id, visiveis);
  }
  async function cancelar(id, visiveis) {
    await carregar(id, visiveis);
    await client.$transaction(async tx => {
      await tx.comunicadoWhatsapp.updateMany({ where: { id, status: { not: 'CONCLUIDO' } }, data: { status: 'CANCELADO', motivo: 'Cancelado pelo escritório. Envios já iniciados podem concluir.' } });
      await tx.destinatarioComunicadoWhatsapp.updateMany({ where: { comunicadoId: id, status: 'PENDENTE' }, data: { status: 'CANCELADO', concluidoEm: new Date() } });
    });
    return detalhe(id, visiveis);
  }
  async function processarUmaVez() {
    // Reserva sem desfecho nunca é reenviada automaticamente após reinício.
    await client.destinatarioComunicadoWhatsapp.updateMany({ where: { status: 'ENVIANDO', iniciadoEm: { lt: new Date(Date.now() - 15 * 60000) } },
      data: { status: 'INDETERMINADO', motivo: 'Envio interrompido. Confira o histórico antes de qualquer novo comunicado.', concluidoEm: new Date() } });
    const c = await client.comunicadoWhatsapp.findFirst({ where: { status: 'ENVIANDO' }, orderBy: { createdAt: 'asc' }, include: { destinatarios: true } });
    if (!c) return;
    const pausar = async motivo => client.comunicadoWhatsapp.updateMany({ where: { id: c.id, status: 'ENVIANDO', confirmadoEm: c.confirmadoEm }, data: { status: 'PAUSADO', motivo } });
    const ator = await client.user.findUnique({ where: { id: c.confirmadoPor || '' }, select: { role: true, status: true } });
    if (!permitido(ator)) { await pausar('O responsável pelo envio não tem mais acesso. A equipe precisa revisar.'); return; }
    const d = c.destinatarios.find(d => d.status === 'PENDENTE');
    if (!d) {
      if (!c.destinatarios.some(d => d.status === 'ENVIANDO')) await client.comunicadoWhatsapp.updateMany({ where: { id: c.id, status: 'ENVIANDO' }, data: { status: 'CONCLUIDO' } });
      return;
    }
    // Consulta antes de reservar o destinatário; indisponibilidade pausa, sem perder o contato.
    let modelo;
    try { modelo = await meta.consultar(c.nomeMeta); }
    catch { await pausar('Não foi possível conferir o modelo na Meta. Consulte a aprovação para continuar.'); return; }
    if (!conferirModelo(c, modelo) || modelo.status !== 'APPROVED' || modelo.category !== c.categoria) { await pausar('O modelo mudou ou não está aprovado. Consulte a aprovação antes de continuar.'); return; }
    const reserva = await client.destinatarioComunicadoWhatsapp.updateMany({ where: { id: d.id, status: 'PENDENTE', comunicado: { status: 'ENVIANDO', confirmadoEm: c.confirmadoEm } }, data: { status: 'ENVIANDO', iniciadoEm: new Date() } });
    if (!reserva.count) return;
    let trava, iniciouEnvio = false;
    const turnoIaId = `comunicado:${d.id}`;
    try {
      const contatos = async () => {
        const a = await client.user.findUnique({ where: { id: c.confirmadoPor || '' }, select: { role: true, status: true } });
        const vigente = await client.comunicadoWhatsapp.findUnique({ where: { id: c.id } });
        if (!permitido(a) || vigente?.status !== 'ENVIANDO' || vigente.categoria !== c.categoria
          || vigente.confirmadoEm?.getTime() !== c.confirmadoEm?.getTime() || vigente.confirmadoPor !== c.confirmadoPor) throw erroComunicado('O envio foi interrompido pelo escritório.', 409);
        const encontrados = await client.contatoWhatsapp.findMany({ where: { id: { in: d.contatosIds }, portalClientId: { in: d.empresasIds }, ativo: true, optInEm: { not: null }, telefoneE164: d.telefone }, select: selectContato });
        if (!encontrados.length) throw erroComunicado('O contato ou a autorização de WhatsApp mudou.', 409);
        return encontrados;
      };
      const validos = await contatos();
      const fio = await conversa({ telefone: d.telefone, portalClientId: validos[0].portalClientId, client });
      trava = await lease.adquirirLease(chaveLeaseResponsavel(fio), { client });
      if (!trava) {
        await client.destinatarioComunicadoWhatsapp.updateMany({ where: { id: d.id, status: 'ENVIANDO' }, data: { status: 'PENDENTE', iniciadoEm: null } });
        return;
      }
      const anterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: 'out' } });
      if (anterior) throw erroComunicado('Já existe um registro desta saída; confira o histórico.', 409);
      const resultado = await enviar({ conversa: fio, tipo: 'template', corpo: `${c.corpo}\n\nAltan Contabilidade`, autor: 'HUMANO', turnoIaId,
        referenciaComercial: { escopo: 'PESSOA', comunicadoId: c.id }, client,
        antesDeEnviar: async () => {
          if (!await lease.renovarLease(trava, { client })) throw erroComunicado('A reserva da conversa expirou.', 409);
          await contatos();
        },
        enviar: async () => { iniciouEnvio = true; return transporte.enviarTemplate({ telefone: d.telefone, template: c.nomeMeta, idioma: 'pt_BR' }); } });
      await client.destinatarioComunicadoWhatsapp.updateMany({ where: { id: d.id, status: 'ENVIANDO' }, data: { status: 'ENVIADO', mensagemId: resultado.mensagem?.id, concluidoEm: new Date() } });
    } catch (e) {
      const m = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: 'out' } }).catch(() => null);
      const aceito = ['enviado', 'entregue', 'lido'].includes(m?.statusEnvio);
      const httpStatus = e.httpStatus ?? e.traducao?.httpStatus;
      const incerto = iniciouEnvio && (e.indeterminado || !httpStatus) || m?.statusEnvio === 'indeterminado' || m?.statusEnvio === 'enviando';
      await client.destinatarioComunicadoWhatsapp.updateMany({ where: { id: d.id, status: 'ENVIANDO' }, data: {
        status: aceito ? 'ENVIADO' : incerto ? 'INDETERMINADO' : iniciouEnvio ? 'FALHOU' : 'EXCLUIDO', mensagemId: m?.id,
        motivo: aceito ? null : incerto ? 'Resultado não confirmado. Não haverá reenvio automático.' : e.status ? e.message : e.mensagemUsuario || 'Não foi possível enviar. Confira o cadastro e o histórico.', concluidoEm: new Date() } });
    } finally { if (trava) await lease.liberarLease(trava, { client }); }
  }
  return { audiencia, criar, detalhe, submeter, consultar, confirmar, cancelar, processarUmaVez,
    async listar(visiveis, cursor) {
      const rows = await client.comunicadoWhatsapp.findMany({ where: { empresasIds: { hasSome: visiveis } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { _count: { select: { destinatarios: true } } } });
      return { itens: rows.slice(0, 30).filter(c => c.empresasIds.every(e => visiveis.includes(e))), proximoCursor: rows.length > 30 ? rows[29].id : null };
    } };
}
