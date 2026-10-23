import { prisma } from '../../../infrastructure/db/prisma.js';
import { camposGuru, erroGuru, hashGuru, normalizarCobrancaManual, textoGuru } from './cobrancaManual.js';
import { randomUUID } from 'node:crypto';
import { criarGuruHttpClient } from './GuruHttpClient.js';
import { normalizarTransacaoGuru, periodoGuru } from './transacaoGuru.js';
import { filtrosGuru, filtrarGuru, resumoGuru, notasDoRegistroGuru, projetarNotaGuru, documentoGuru, contextoNotasGuru, carregarNotaGuru } from './guruNotasVinculadas.js';
import { gerarDanfse } from '../danfse/gerarDanfse.js';
import { gerarDanfseDaNota } from '../danfse/danfseDaNotaDoPortal.js';

// Este serviço não importa NfseService/transportes, não cria ServiceInvoice, lote,
// recorrência ou DPS. A preparação nunca é uma autorização para o emissor existente.
export function criarGuruConferencia({ db = prisma, env = process.env, now = () => new Date(), http = criarGuruHttpClient() } = {}) {
  function contexto(companyId) {
    const ambientePermitido = ['development', 'test'].includes(env.NODE_ENV)
      || (env.NODE_ENV === 'production' && env.GURU_CONFERENCIA_PRODUCTION_ENABLED === 'true');
    if (!ambientePermitido
      || !env.GURU_CONFERENCIA_COMPANY_ID || !env.GURU_CONFERENCIA_ACCOUNT_ID) {
      throw erroGuru('guru_piloto_desabilitado', 403);
    }
    if (companyId !== env.GURU_CONFERENCIA_COMPANY_ID) throw erroGuru('guru_empresa_fora_piloto', 403);
    return { companyId: textoGuru(companyId), contaGuru: textoGuru(env.GURU_CONFERENCIA_ACCOUNT_ID) };
  }

  async function autorizar(tx, companyId, userId) {
    const ctx = contexto(companyId);
    if (typeof userId !== 'string' || !userId) throw erroGuru('unauthorized', 401);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
    // Mesma política admin/contador da carteira; cliente e API key não participam.
    if (!user || user.status !== 'active' || !['admin', 'contador'].includes(user.role)) throw erroGuru('forbidden', 403);
    if (!await tx.company.findUnique({ where: { id: companyId }, select: { id: true } })) throw erroGuru('company_not_found', 404);
    return ctx;
  }

  const prefixo = ctx => `guru-conferencia:v1:${hashGuru([ctx.companyId, ctx.contaGuru])}:`;
  const chave = (ctx, id) => prefixo(ctx) + id;
  function verificarRegistro(value, ctx, id) {
    if (!value || value.schema !== 1 || value.companyId !== ctx.companyId || value.contaGuru !== ctx.contaGuru
      || value.id !== id || value.modo !== 'CONFERENCIA' || value.emissaoBloqueada !== true) {
      throw erroGuru('guru_registro_inconsistente', 409);
    }
    // O piloto só conhece seus próprios atos. Guru/eNotas podem ter emitido fora
    // do Altan. Retirar também a afirmação antiga ao reler/repetir um WIP, sem
    // escrever durante GET nem transformar ausência de consulta em prova fiscal.
    const { nota, ...registro } = value;
    return { ...registro, emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA' };
  }
  async function travar(tx, key) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }
  const operacaoKey = ctx => `guru-importacao:v1:${hashGuru([ctx.companyId, ctx.contaGuru])}`;
  function conexao() {
    return env.GURU_CONFERENCIA_IMPORT_ENABLED === 'true' && env.GURU_CONFERENCIA_CREDENTIAL_SCOPE === 'EXCLUSIVE_PILOT'
      && typeof env.GURU_CONFERENCIA_USER_TOKEN === 'string' && !!env.GURU_CONFERENCIA_USER_TOKEN
      && !/\s/.test(env.GURU_CONFERENCIA_USER_TOKEN);
  }
  const configuracaoHash = () => hashGuru([env.NODE_ENV, env.GURU_CONFERENCIA_PRODUCTION_ENABLED, env.GURU_CONFERENCIA_COMPANY_ID,
    env.GURU_CONFERENCIA_ACCOUNT_ID, env.GURU_CONFERENCIA_IMPORT_ENABLED,
    env.GURU_CONFERENCIA_CREDENTIAL_SCOPE, env.GURU_CONFERENCIA_USER_TOKEN]);

  return {
    async listar({ companyId, userId, query = {} }) {
      const filtros = filtrosGuru(query), { pagina } = filtros;
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId);
        const where = { key: { startsWith: prefixo(ctx) } };
        const rows = await tx.appSetting.findMany({ where, orderBy: { key: 'asc' } });
        const filtradas = filtrarGuru(rows.map(row => verificarRegistro(row.value, ctx, row.key.slice(prefixo(ctx).length))), filtros);
        // WIP anterior não guardava a chave no vínculo. Ler só identidades para
        // deduplicar fontes legadas, sem carregar XML fora da página nem regravar histórico.
        const antigos = [...new Set(filtradas.flatMap(i => (i.notasVinculadas || []).filter(v => !v.identidadeFiscal).map(v => v.notaId)))];
        let paraResumo = filtradas;
        if (antigos.length) {
          const identidades = new Map(), ctxNotas = await contextoNotasGuru(tx, companyId);
          const serviceIds = antigos.filter(id => !id.startsWith('portal:'));
          const portalIds = antigos.filter(id => id.startsWith('portal:')).map(id => id.slice(7));
          if (serviceIds.length) for (const nota of await tx.serviceInvoice.findMany({ where: { companyId, id: { in: serviceIds } }, select: { id: true, chaveAcesso: true } })) identidades.set(nota.id, nota.chaveAcesso);
          if (ctxNotas.portalClientId && portalIds.length) for (const nota of await tx.portalInvoice.findMany({ where: { clientId: ctxNotas.portalClientId, id: { in: portalIds } }, select: { id: true, chaveAcesso: true } })) identidades.set(`portal:${nota.id}`, nota.chaveAcesso);
          paraResumo = filtradas.map(i => ({ ...i, notasVinculadas: (i.notasVinculadas || []).map(v => ({ ...v, identidadeFiscal: v.identidadeFiscal || identidades.get(v.notaId) })) }));
        }
        const items = [], cache = new Map();
        for (const item of filtradas.slice((pagina - 1) * 20, pagina * 20)) items.push({ ...item, notas: await notasDoRegistroGuru(tx, item, cache) });
        const total = filtradas.length;
        const op = await tx.appSetting.findUnique({ where: { key: operacaoKey(ctx) } });
        const operacao = op?.value || null;
        const ocupada = operacao?.estado === 'EM_ANDAMENTO' && Date.parse(operacao.expiraEm) > now().getTime();
        return { items, resumo: resumoGuru(paraResumo), filtros,
          total, pagina, tamanhoPagina: 20, conexao: conexao() ? 'CONFIGURADA_NAO_VERIFICADA' : 'DESCONECTADA',
          ocupada, ultimaImportacao: operacao ? { ...operacao, estado: operacao.estado === 'EM_ANDAMENTO' && !ocupada ? 'INTERROMPIDA' : operacao.estado } : null };
      }, { isolationLevel: 'RepeatableRead' });
    },

    async importar({ companyId, userId, body, revalidarAcesso = async () => {} }) {
      const periodo = periodoGuru(body);
      const ctx = await autorizar(db, companyId, userId);
      if (!conexao()) throw erroGuru('guru_desconectado', 409);
      const configHash = configuracaoHash(), key = operacaoKey(ctx), execucaoId = randomUUID();
      const inicio = now();
      const operacao = { companyId, contaGuru: ctx.contaGuru, execucaoId, periodo, atorId: userId,
        inicio: inicio.toISOString(), expiraEm: new Date(inicio.getTime() + 240000).toISOString(), estado: 'EM_ANDAMENTO' };
      await db.$transaction(async tx => {
        await travar(tx, key);
        await autorizar(tx, companyId, userId);
        const row = await tx.appSetting.findUnique({ where: { key } });
        if (row?.value.estado === 'EM_ANDAMENTO' && Date.parse(row.value.expiraEm) > now().getTime()) throw erroGuru('guru_importacao_ocupada', 409);
        if (row?.value.estado === 'EM_ANDAMENTO') {
          const anterior = { ...row.value, estado: 'INTERROMPIDA', fim: now().toISOString(), gravadas: 0 };
          const auditKey = `${key}:${row.value.execucaoId}`;
          const audit = await tx.appSetting.findUnique({ where: { key: auditKey } });
          if (!audit) await tx.appSetting.create({ data: { key: auditKey, value: anterior } });
          else if (audit.value.estado === 'EM_ANDAMENTO') {
            await tx.appSetting.update({ where: { key: auditKey }, data: { value: anterior } });
          }
        }
        await tx.appSetting.upsert({ where: { key }, create: { key, value: operacao }, update: { value: operacao } });
        await tx.appSetting.create({ data: { key: `${key}:${execucaoId}`, value: operacao } });
      });
      const revalidar = async tx => {
        await autorizar(tx, companyId, userId);
        await revalidarAcesso();
        if (configuracaoHash() !== configHash || !conexao()) throw erroGuru('guru_configuracao_alterada', 409);
        const op = await tx.appSetting.findUnique({ where: { key } });
        if (op?.value.execucaoId !== execucaoId || Date.parse(operacao.expiraEm) <= now().getTime()) throw erroGuru('guru_importacao_interrompida', 409);
      };
      let lidas = 0, paginas = 0, totalOrigem = null;
      try {
        const registros = new Map(), cursors = new Set();
        let cursor = null;
        for (;;) {
          await revalidar(db);
          const pagina = await http.pagina({ token: env.GURU_CONFERENCIA_USER_TOKEN, periodo, cursor });
          await revalidar(db);
          paginas += 1;
          if (paginas === 1) totalOrigem = pagina.total;
          if (totalOrigem > 1000 || lidas + pagina.data.length > 1000) throw erroGuru('guru_limite_importacao', 409);
          for (const raw of pagina.data) {
            const dados = normalizarTransacaoGuru(raw);
            if (registros.has(dados.transacaoId)) throw erroGuru('guru_pagina_repetida', 409);
            registros.set(dados.transacaoId, dados); lidas += 1;
          }
          if (!pagina.hasMore) break;
          if (!pagina.data.length || !pagina.nextCursor || cursors.has(pagina.nextCursor)) throw erroGuru('guru_pagina_repetida', 409);
          if (paginas >= 20) throw erroGuru('guru_limite_importacao', 409);
          cursors.add(pagina.nextCursor); cursor = pagina.nextCursor;
        }
        if (totalOrigem !== null && totalOrigem !== lidas) throw erroGuru('guru_total_divergente', 409);
        return await db.$transaction(async tx => {
          await travar(tx, key);
          await revalidar(tx);
          let criadas = 0, repetidas = 0, conflitos = 0;
          // Ordenação estável das travas: importações/manuais/conferências usam a mesma identidade.
          for (const dados of [...registros.values()].sort((a, b) => a.transacaoId.localeCompare(b.transacaoId))) {
            const id = hashGuru(dados.transacaoId), itemKey = chave(ctx, id), hash = hashGuru(dados);
            await travar(tx, itemKey);
            const row = await tx.appSetting.findUnique({ where: { key: itemKey } });
            const instante = now().toISOString();
            if (row) {
              const item = verificarRegistro(row.value, ctx, id);
              if (!item.conflito && item.hash === hash && item.origem === 'GURU_API') { repetidas += 1; continue; }
              conflitos += 1;
              if (item.conflito?.hash === hash) continue;
              const versao = item.versao + 1;
              // Conteúdo anterior/conferência continuam no histórico. Divergência não é aprovação.
              const evento = { evento: 'ORIGEM_DIVERGENTE', atorId: userId, instante, versao, hash,
                anterior: { dados: item.dados, hash: item.hash, conferencia: item.conferencia || null }, dados };
              await tx.appSetting.update({ where: { key: itemKey }, data: { value: { ...item,
                estado: 'CONFLITO', versao, conferencia: null, conflito: { hash, dados, instante },
                historico: [...item.historico, evento] } } });
              continue;
            }
            const item = { schema: 1, ...ctx, id, hash, modo: 'CONFERENCIA', estado: 'PREPARADA', versao: 1,
              origem: 'GURU_API', dados, conexaoGuru: 'CREDENCIAL_SEGREGADA_CONFIGURADA', emissaoBloqueada: true,
              emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA', entrega: 'NAO_REALIZADA', baixaContabil: 'NAO_REALIZADA',
              pendencias: ['MAPEAMENTO_FISCAL_NAO_VALIDADO', 'BENEFICIO_PENDENTE_VIGENCIA', 'EMISSAO_BLOQUEADA_NESTE_PILOTO'],
              criadaEm: instante, criadaPor: userId, periodoOrigem: periodo,
              historico: [{ evento: 'IMPORTADA', atorId: userId, instante, versao: 1, hash, periodo, execucaoId }] };
            await tx.appSetting.create({ data: { key: itemKey, value: item } }); criadas += 1;
          }
          await revalidar(tx);
          const resultado = { ...operacao, estado: 'CONCLUIDA', fim: now().toISOString(), lidas, paginas, totalOrigem, criadas, repetidas, conflitos };
          await tx.appSetting.update({ where: { key }, data: { value: resultado } });
          // A tentativa nasce na reserva; seu desfecho fica fora da listagem.
          await tx.appSetting.update({ where: { key: `${key}:${execucaoId}` }, data: { value: resultado } });
          return resultado;
        }, { isolationLevel: 'ReadCommitted', timeout: 30000 });
      } catch (error) {
        const code = /^guru_[a-z_]+$/.test(error?.code || '') ? error.code : 'guru_importacao_falhou';
        await db.$transaction(async tx => {
          await travar(tx, key);
          const row = await tx.appSetting.findUnique({ where: { key } });
          const resultado = { ...operacao, estado: 'FALHOU', fim: now().toISOString(), lidas, paginas, totalOrigem, gravadas: 0, erro: code };
          if (row?.value.execucaoId === execucaoId) await tx.appSetting.update({ where: { key }, data: { value: resultado } });
          const auditKey = `${key}:${execucaoId}`;
          const audit = await tx.appSetting.findUnique({ where: { key: auditKey } });
          // A reserva seguinte já pode ter encerrado esta tentativa. Preservar
          // INTERROMPIDA e sua evidência, sem duplicação nem alteração de B.
          if (audit?.value.estado === 'EM_ANDAMENTO') {
            await tx.appSetting.update({ where: { key: auditKey }, data: { value: resultado } });
          }
        });
        throw erroGuru(code, error?.status || 500);
      }
    },
    async preparar({ companyId, userId, body }) {
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId);
        const dados = normalizarCobrancaManual(body);
        const id = hashGuru(dados.transacaoId);
        const key = chave(ctx, id);
        await travar(tx, key);
        await autorizar(tx, companyId, userId);
        const anterior = await tx.appSetting.findUnique({ where: { key } });
        const hash = hashGuru(dados);
        if (anterior) {
          const item = verificarRegistro(anterior.value, ctx, id);
          if (item.hash !== hash) throw erroGuru('guru_transacao_divergente_conferir_origem', 409);
          return { item, repetida: true };
        }
        const instante = now().toISOString();
        const item = { schema: 1, ...ctx, id, hash, modo: 'CONFERENCIA', estado: 'PREPARADA', versao: 1,
          origem: 'GURU_REGISTRO_MANUAL', dados, conexaoGuru: 'NAO_REALIZADA', emissaoBloqueada: true,
          emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA',
          entrega: 'NAO_REALIZADA', baixaContabil: 'NAO_REALIZADA',
          pendencias: ['MAPEAMENTO_FISCAL_NAO_VALIDADO', 'EMISSAO_BLOQUEADA_NESTE_PILOTO'],
          criadaEm: instante, criadaPor: userId,
          historico: [{ evento: 'PREPARADA', atorId: userId, instante, versao: 1, hash }] };
        // Estado e auditoria são um único documento atômico. Sem migração/backfill.
        await tx.appSetting.create({ data: { key, value: item } });
        return { item, repetida: false };
      }, { isolationLevel: 'ReadCommitted' });
    },

    async obter({ companyId, userId, id }) {
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId);
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw erroGuru('guru_id_invalido');
        const row = await tx.appSetting.findUnique({ where: { key: chave(ctx, id) } });
        if (!row) throw erroGuru('guru_preparacao_nao_encontrada', 404);
        const item = verificarRegistro(row.value, ctx, id);
        return item.notasVinculadas?.length ? { ...item, notas: await notasDoRegistroGuru(tx, item) } : item;
      }, { isolationLevel: 'RepeatableRead' });
    },

    async buscarNotas({ companyId, userId, query = {} }) {
      camposGuru(query, ['busca', 'pagina']);
      const busca = String(query.busca || '').trim(), pagina = Number(query.pagina || 1);
      if (busca.length > 120 || !Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw erroGuru('guru_filtro_invalido');
      return db.$transaction(async tx => {
        await autorizar(tx, companyId, userId);
        const ctx = await contextoNotasGuru(tx, companyId);
        const pesquisa = numero => busca ? { OR: [numero, 'tomadorNome', 'tomadorDoc'].map(campo => ({ [campo]: { contains: busca, mode: 'insensitive' } })) } : {};
        const whereService = { companyId, ...pesquisa('numeroNfse') };
        const wherePortal = { clientId: ctx.portalClientId, type: 'NFSE', papel: 'EMIT', ...pesquisa('numero') };
        const countService = await tx.serviceInvoice.count({ where: whereService });
        const countPortal = ctx.portalClientId ? await tx.portalInvoice.count({ where: wherePortal }) : 0;
        const offset = (pagina - 1) * 20;
        const services = offset < countService ? await tx.serviceInvoice.findMany({ where: whereService, select: { id: true }, orderBy: { id: 'asc' }, skip: offset, take: 20 }) : [];
        const portals = ctx.portalClientId && services.length < 20 ? await tx.portalInvoice.findMany({ where: wherePortal, select: { id: true }, orderBy: { id: 'asc' }, skip: Math.max(0, offset - countService), take: 20 - services.length }) : [];
        const items = [];
        for (const id of [...services.map(n => n.id), ...portals.map(n => `portal:${n.id}`)]) {
          const nota = await carregarNotaGuru(tx, ctx, id);
          if (nota) items.push(projetarNotaGuru(nota));
        }
        return { items, total: countService + countPortal, pagina, tamanhoPagina: 20 };
      }, { isolationLevel: 'RepeatableRead' });
    },

    async obterNota({ companyId, userId, notaId }) {
      return db.$transaction(async tx => {
        await autorizar(tx, companyId, userId);
        textoGuru(notaId);
        const nota = await carregarNotaGuru(tx, await contextoNotasGuru(tx, companyId), notaId);
        if (!nota) throw erroGuru('guru_nota_nao_encontrada', 404);
        return projetarNotaGuru(nota);
      }, { isolationLevel: 'RepeatableRead' });
    },

    async vincularNota({ companyId, userId, id, body }) {
      camposGuru(body, ['versao', 'hash', 'notaId', 'notaHash', 'confirmada']);
      if (body.confirmada !== true || !Number.isSafeInteger(body.versao) || body.versao < 1
        || !/^[a-f0-9]{64}$/.test(body.hash || '') || !/^[a-f0-9]{64}$/.test(body.notaHash || '')
        || !/^[a-f0-9]{64}$/.test(id || '')) throw erroGuru('guru_conferencia_invalida');
      textoGuru(body.notaId);
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId), key = chave(ctx, id);
        await travar(tx, key);
        // Serializa alterações da linha fiscal. Eventos/novas substitutas são lidos
        // novamente antes da gravação; toda projeção posterior reconfere sua revisão.
        const nota = await carregarNotaGuru(tx, await contextoNotasGuru(tx, companyId), body.notaId, true);
        await autorizar(tx, companyId, userId);
        const row = await tx.appSetting.findUnique({ where: { key } });
        if (!row) throw erroGuru('guru_preparacao_nao_encontrada', 404);
        const item = verificarRegistro(row.value, ctx, id);
        if (item.versao !== body.versao || item.hash !== body.hash || item.estado === 'CONFLITO') throw erroGuru('guru_revisao_desatualizada', 409);
        if (!nota) throw erroGuru('guru_nota_nao_encontrada', 404);
        const projecao = projetarNotaGuru(nota);
        if (projecao.hash !== body.notaHash) throw erroGuru('guru_revisao_desatualizada', 409);
        if (!projecao.vinculavel) throw erroGuru('guru_documento_fiscal_invalido', 409);
        const anterior = (item.notasVinculadas || []).find(v => v.notaId === nota.id);
        if (anterior?.notaHash === body.notaHash && anterior.vendaHash === item.hash && anterior.vendaVersao === item.versao) {
          return { item: { ...item, notas: await notasDoRegistroGuru(tx, item) }, repetida: true };
        }
        const vinculo = { notaId: nota.id, identidadeFiscal: projecao.identidadeFiscal, notaHash: projecao.hash, vendaHash: item.hash, vendaVersao: item.versao,
          atorId: userId, instante: now().toISOString(), origem: 'MANUAL' };
        // Vínculos não mudam a revisão da venda: várias notas podem cobrir a mesma revisão.
        // A trava serializa inclusões; cada vínculo tem hash próprio e auditoria no mesmo JSON.
        const proximo = { ...item, notasVinculadas: [...(item.notasVinculadas || []).filter(v => v.notaId !== nota.id), vinculo],
          historico: [...item.historico, { evento: 'NOTA_VINCULADA', ...vinculo, anterior: anterior || null }] };
        const atual = await carregarNotaGuru(tx, await contextoNotasGuru(tx, companyId), body.notaId);
        if (!atual || projetarNotaGuru(atual).hash !== projecao.hash) throw erroGuru('guru_revisao_desatualizada', 409);
        await tx.appSetting.update({ where: { key }, data: { value: proximo } });
        return { item: { ...proximo, notas: await notasDoRegistroGuru(tx, proximo) }, repetida: false };
      }, { isolationLevel: 'ReadCommitted' });
    },

    async documentoNota({ companyId, userId, id, notaId, formato }) {
      if (!['xml', 'danfse'].includes(formato)) throw erroGuru('guru_formato_invalido');
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId);
        if (!/^[a-f0-9]{64}$/.test(id || '')) throw erroGuru('guru_id_invalido');
        const row = await tx.appSetting.findUnique({ where: { key: chave(ctx, id) } });
        if (!row) throw erroGuru('guru_preparacao_nao_encontrada', 404);
        const item = verificarRegistro(row.value, ctx, id);
        const notas = await notasDoRegistroGuru(tx, item);
        if (!notas.some(n => n.id === notaId && n.conferencia === 'CONFERIDA')) throw erroGuru('guru_revisao_desatualizada', 409);
        const nota = await carregarNotaGuru(tx, await contextoNotasGuru(tx, companyId), notaId);
        const xml = documentoGuru(nota);
        if (!xml) throw erroGuru('guru_documento_fiscal_invalido', 409);
        // Mesmo gerador local do DANFSe existente, sem pdfUrl, redirect ou transporte.
        const bytes = formato === 'xml' ? Buffer.from(xml) : nota.fonte === 'PortalInvoice'
          ? (await gerarDanfseDaNota({ client: tx, portalClientId: nota.portalClientId, notaId: notaId.slice(7) })).pdf
          : (await gerarDanfse({ xml })).pdf;
        return { bytes, tipo: formato === 'xml' ? 'application/xml' : 'application/pdf',
          nome: `nota-${notaId.replace(/[^\w-]/g, '')}.${formato === 'xml' ? 'xml' : 'pdf'}` };
      }, { isolationLevel: 'RepeatableRead' });
    },

    async conferir({ companyId, userId, id, body }) {
      return db.$transaction(async tx => {
        const ctx = await autorizar(tx, companyId, userId);
        camposGuru(body, ['versao', 'hash', 'confirmada']);
        if (body.confirmada !== true || !Number.isSafeInteger(body.versao) || body.versao < 1
          || typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash)
          || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw erroGuru('guru_conferencia_invalida');
        const key = chave(ctx, id);
        await travar(tx, key);
        await autorizar(tx, companyId, userId);
        const row = await tx.appSetting.findUnique({ where: { key } });
        if (!row) throw erroGuru('guru_preparacao_nao_encontrada', 404);
        let item = verificarRegistro(row.value, ctx, id);
        if (item.estado === 'CONFLITO') {
          if (body.versao !== item.versao || body.hash !== item.conflito?.hash) throw erroGuru('guru_revisao_desatualizada', 409);
          item = { ...item, dados: item.conflito.dados, hash: item.conflito.hash, origem: 'GURU_API',
            estado: 'PREPARADA', conflito: null };
        }
        if (item.hash !== body.hash) throw erroGuru('guru_revisao_desatualizada', 409);
        // Replay apenas do comando exato e pelo mesmo autor, sem nova auditoria.
        if (item.estado === 'CONFERIDA' && item.conferencia.atorId === userId
          && item.conferencia.versaoOrigem === body.versao) return { item: item.notasVinculadas?.length ? { ...item, notas: await notasDoRegistroGuru(tx, item) } : item, repetida: true };
        if (item.versao !== body.versao || item.estado !== 'PREPARADA') throw erroGuru('guru_revisao_desatualizada', 409);
        const evento = { evento: 'CONFERIDA', atorId: userId, instante: now().toISOString(),
          versaoOrigem: item.versao, versao: item.versao + 1, hash: item.hash };
        const proximo = { ...item, estado: 'CONFERIDA', versao: evento.versao, conferencia: evento,
          historico: [...item.historico, evento] };
        await tx.appSetting.update({ where: { key }, data: { value: proximo } });
        return { item: proximo.notasVinculadas?.length ? { ...proximo, notas: await notasDoRegistroGuru(tx, proximo) } : proximo, repetida: false };
      }, { isolationLevel: 'ReadCommitted' });
    },

    async emitir({ companyId, userId }) {
      await autorizar(db, companyId, userId);
      throw erroGuru('guru_emissao_bloqueada_modo_conferencia', 409);
    },
  };
}
