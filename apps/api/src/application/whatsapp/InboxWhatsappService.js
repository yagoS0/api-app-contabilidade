import { enriquecerMensagensWhatsapp, resumoMensagemHistorico } from './HistoricoArquivoWhatsappService.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/db/prisma.js';
import { avaliarJanela24h } from './janela24h.js';
import { classificarRelacionamento } from './ClassificacaoAtendimentoService.js';
import { mascararTelefone } from './WhatsappCloudClient.js';

const erro = (code, status = 400) => Object.assign(new Error(code), { code, status });
const include = { portalClient: { select: { id: true, razao: true, cnpj: true, apelidosWhatsapp: true } }, atendente: { select: { id: true, name: true, email: true } },
  atendimento: true, canalWhatsapp: true, vinculoNumero: { include: { interlocutor: true } } };
const chave = c => c.vinculoNumero?.interlocutorId || `legado:${c.atendimentoId || c.id}`;
const empresa = c => c?.portalClient ? { id: c.portalClientId, razao: c.portalClient.razao, cnpj: c.portalClient.cnpj, conversaId: c.id, apelidosWhatsapp: c.portalClient.apelidosWhatsapp || [] } : null;
const porMensagem = m => m.contexto?.conversaId || m.conversaId;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export function lerCursorInbox(cursor, assinatura) {
  if (!cursor) return null;
  try { const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (c.s !== assinatura || typeof c.id !== 'string' || !Number.isFinite(Date.parse(c.t))) throw new Error(); return c; }
  catch { throw erro('cursor_invalido'); }
}

// A listagem e os totais usam a mesma visibilidade, identidade e resolução de mensagens.
function consultaBaseInbox({ ids, operadorId, filtro = 'todas', empresaId = null, q = '' }) {
  // NOT IN (NULL) é desconhecido, não verdadeiro: com carteira vazia isso
  // deixaria recibos neutros de clientes restritos escaparem do NOT EXISTS.
  const empresasSql = ids.length ? Prisma.join(ids) : Prisma.sql`SELECT NULL::text WHERE false`;
  const busca = `%${String(q).trim().replace(/[\\%_]/g, '\\$&')}%`;
  const telefoneBusca = String(q).replace(/\D/g, '');
  const historico = filtro === 'historico', lixeira = filtro === 'lixeira';
  return Prisma.sql`
    WITH base AS (
      SELECT c.*, v."interlocutorId", COALESCE(v."interlocutorId", 'legado:' || COALESCE(c."atendimentoId",c.id)) AS grupo,
        p.razao, p.cnpj, p."apelidosWhatsapp"
      FROM conversas_whatsapp c LEFT JOIN vinculos_numero_interlocutor v ON v.id=c."vinculoNumeroId"
      LEFT JOIN "PortalClient" p ON p.id=c."portalClientId"
      WHERE ${lixeira ? Prisma.sql`c."excluidaEm" IS NOT NULL` : Prisma.sql`c."excluidaEm" IS NULL`}
        AND ${historico ? Prisma.sql`c."chaveEscopo" LIKE 'legado:%'` : Prisma.sql`c."chaveEscopo" NOT LIKE 'legado:%'`}
    ), vis AS (
      SELECT b.* FROM base b WHERE (
        b."portalClientId" IN (${empresasSql}) OR (b."portalClientId" IS NULL AND b."chaveEscopo" LIKE 'sem-empresa:%'
          AND NOT EXISTS (SELECT 1 FROM conversas_whatsapp x LEFT JOIN vinculos_numero_interlocutor xv ON xv.id=x."vinculoNumeroId"
            WHERE COALESCE(xv."interlocutorId",'legado:' || COALESCE(x."atendimentoId",x.id))=b.grupo AND x."portalClientId" IS NOT NULL AND x."portalClientId" NOT IN (${empresasSql}))
          AND NOT EXISTS (SELECT 1 FROM contatos_whatsapp co JOIN vinculos_numero_interlocutor vn ON vn.id=co."vinculoNumeroId"
            WHERE vn."interlocutorId"=b."interlocutorId" AND co."portalClientId" NOT IN (${empresasSql}))))
    ), grupos AS (
      SELECT grupo, MAX("createdAt") AS "criadoEm", MIN("interlocutorId") AS "interlocutorId",
        ARRAY_AGG(id ORDER BY ("portalClientId" IS NOT NULL) DESC,"updatedAt" DESC,id DESC) AS segmentos,
        BOOL_OR(${!q ? Prisma.sql`true` : Prisma.sql`COALESCE("nomePerfilProvedor",'') ILIKE ${busca} OR COALESCE(razao,'') ILIKE ${busca}
          OR COALESCE(cnpj,'') ILIKE ${busca} OR COALESCE(array_to_string("apelidosWhatsapp",' '),'') ILIKE ${busca}
          OR "telefoneE164" ILIKE ${busca} OR (${Boolean(telefoneBusca)} AND "telefoneE164" LIKE ${`%${telefoneBusca}%`})
          OR EXISTS (SELECT 1 FROM contatos_whatsapp co WHERE co."vinculoNumeroId"=vis."vinculoNumeroId" AND co."portalClientId" IN (${empresasSql}) AND co.nome ILIKE ${busca})`}) AS encontrou,
        BOOL_OR(${empresaId ? Prisma.sql`"portalClientId"=${empresaId}` : Prisma.sql`true`}) AS da_empresa,
        BOOL_OR(${filtro === 'atendidas-por-mim' ? Prisma.sql`"atendidaPor"=${operadorId}` : Prisma.sql`true`}) AS do_operador
      FROM vis GROUP BY grupo
    ), atividade AS (
      SELECT s.grupo, MAX(m."registradaEm") AS "ultimaMensagemEm",
        COUNT(*) FILTER (WHERE m.direcao='in' AND (s."lidaAteEm" IS NULL OR m."registradaEm">s."lidaAteEm"))::int AS total
      FROM mensagens_whatsapp m LEFT JOIN resolucoes_contexto_whatsapp r ON r."mensagemId"=m.id
      JOIN vis s ON s.id=COALESCE(r."conversaId",m."conversaId")
      GROUP BY s.grupo
    ), classificados AS (
      SELECT g.*, COALESCE(n."ultimaMensagemEm",g."criadoEm") AS instante,
        CASE WHEN EXISTS (SELECT 1 FROM contatos_whatsapp co JOIN vinculos_numero_interlocutor vn ON vn.id=co."vinculoNumeroId"
        WHERE vn."interlocutorId"=g."interlocutorId" AND vn."encerrouEm" IS NULL AND co.ativo=true AND co."portalClientId" IN (${empresasSql})) THEN 'CLIENTE'
        WHEN EXISTS (SELECT 1 FROM atendimentos_lead a WHERE a."interlocutorId"=g."interlocutorId" AND a."encerradoEm" IS NULL
          AND (a."onboardingId" IS NOT NULL OR a.triagem->'preatendimento'->>'intencao' IN ('ABERTURA','TRANSFERENCIA','INATIVA','PLANEJAMENTO','GESTAO'))) THEN 'LEAD'
        ELSE 'A_IDENTIFICAR' END AS relacionamento,
        COALESCE(n.total,0) AS "naoLidas"
      FROM grupos g LEFT JOIN atividade n ON n.grupo=g.grupo
      WHERE g.encontrou AND g.da_empresa AND g.do_operador
    )`;
}

/** Agrupa no SQL ANTES do cursor/limite. Só segmentos visíveis alimentam busca, contagem e prévia. */
export async function listarInboxWhatsapp({ visiveis, operadorId, filtro = 'todas', empresaId = null, relacionamento = '', q = '', naoLidas = false, cursor = null, limite = 100, client = prisma }) {
  const ids = [...new Set(visiveis || [])].sort();
  const lim = Math.min(200, Math.max(1, Number(limite) || 100));
  const assinatura = createHash('sha256').update(JSON.stringify({ ordem: 'ultima-mensagem', ids, operadorId, filtro, empresaId, relacionamento, q, naoLidas })).digest('hex').slice(0, 20);
  const c = lerCursorInbox(cursor, assinatura);
  if (empresaId && !ids.includes(empresaId)) return { conversas: [], temMais: false, proximoCursor: null, versaoContrato: 2, buscaConfigurada: true };
  if (empresaId && filtro === 'nao-vinculadas') throw erro('filtro_incompativel');
  const linhas = await client.$queryRaw(Prisma.sql`${consultaBaseInbox({ ids, operadorId, filtro, empresaId, q })}
    SELECT * FROM classificados WHERE ${relacionamento ? Prisma.sql`relacionamento=${relacionamento}` : Prisma.sql`true`}
      AND ${filtro === 'nao-vinculadas' ? Prisma.sql`relacionamento<>'CLIENTE'` : Prisma.sql`true`}
      AND ${naoLidas ? Prisma.sql`"naoLidas">0` : Prisma.sql`true`}
      AND ${c ? Prisma.sql`(instante < ${c.t}::timestamp OR (instante=${c.t}::timestamp AND grupo < ${c.id}))` : Prisma.sql`true`}
      ORDER BY instante DESC,grupo DESC LIMIT ${lim + 1}`);
  const temMais = linhas.length > lim, pagina = linhas.slice(0, lim);
  const segmentosIds = pagina.flatMap(g => g.segmentos);
  const segmentos = segmentosIds.length ? await client.conversaWhatsapp.findMany({ where: { id: { in: segmentosIds } }, include }) : [];
  const grupos = pagina.map(g => ({ ...g, segmentos: g.segmentos.map(id => segmentos.find(s => s.id === id)).filter(Boolean) }));
  const conversas = await resumirGrupos(grupos, { visiveis: ids, client });
  const ultimo = pagina.at(-1);
  return { conversas, temMais, proximoCursor: temMais ? encode({ id: ultimo.grupo, t: new Date(ultimo.instante).toISOString(), s: assinatura }) : null,
    versaoContrato: 2, buscaConfigurada: true };
}

/** Totais globais da carteira, sem busca, filtro de relacionamento, cursor ou limite. */
export async function resumoInboxWhatsapp(visiveis, { client = prisma } = {}) {
  const ids = [...new Set(visiveis || [])].sort();
  const [atual, historico, lixeira] = await Promise.all(['todas', 'historico', 'lixeira'].map(async filtro => {
    const [totais] = await client.$queryRaw(Prisma.sql`${consultaBaseInbox({ ids, filtro })}
      SELECT COUNT(*)::int AS "conversas",
        COUNT(*) FILTER (WHERE relacionamento<>'CLIENTE')::int AS "naoVinculadas",
        COUNT(*) FILTER (WHERE "naoLidas">0)::int AS "conversasNaoLidas",
        COALESCE(SUM("naoLidas"),0)::int AS "mensagensNaoLidas",
        COALESCE(SUM("naoLidas") FILTER (WHERE relacionamento='LEAD'),0)::int AS "leads",
        COALESCE(SUM("naoLidas") FILTER (WHERE relacionamento='CLIENTE'),0)::int AS "clientes",
        COALESCE(SUM("naoLidas") FILTER (WHERE relacionamento='A_IDENTIFICAR'),0)::int AS "aIdentificar"
      FROM classificados`);
    return totais;
  }));
  return { conversas: atual.conversas, naoVinculadas: atual.naoVinculadas, conversasNaoLidas: atual.conversasNaoLidas, mensagensNaoLidas: atual.mensagensNaoLidas,
    contagensNaoLidas: { TODOS: atual.mensagensNaoLidas, LEAD: atual.leads, CLIENTE: atual.clientes, A_IDENTIFICAR: atual.aIdentificar },
    historicoConversas: historico.conversas, historicoConversasNaoLidas: historico.conversasNaoLidas, historicoMensagensNaoLidas: historico.mensagensNaoLidas,
    lixeiraConversas: lixeira.conversas, lixeiraConversasNaoLidas: lixeira.conversasNaoLidas, lixeiraMensagensNaoLidas: lixeira.mensagensNaoLidas };
}

export function filtroMensagensIdentidade(segmentos) {
  const ids = segmentos.map(s => s.id);
  return { OR: [{ conversaId: { in: ids }, contexto: { is: null } }, { contexto: { is: { conversaId: { in: ids } } } },
    { conversaId: { in: segmentos.filter(s => !s.portalClientId).map(s => s.id) }, contexto: { is: { conversaId: null } } }] };
}

/** GET nunca cadastra contato, migra conversa ou marca leitura. */
export async function carregarGrupoIdentidade({ conversaId, visiveis, client = prisma }) {
  const origem = await client.conversaWhatsapp.findUnique({ where: { id: String(conversaId) }, include });
  if (!origem || (origem.portalClientId && !visiveis.includes(origem.portalClientId))) throw erro('conversa_nao_encontrada', 404);
  let todos = origem.vinculoNumeroId ? await client.conversaWhatsapp.findMany({ where: { vinculoNumero: { interlocutorId: origem.vinculoNumero.interlocutorId },
    excluidaEm: origem.excluidaEm ? { not: null } : null, ...(String(origem.chaveEscopo).startsWith('legado:') ? {} : { NOT: { chaveEscopo: { startsWith: 'legado:' } } }) }, include }) : [origem];
  const interlocutorId = origem.vinculoNumero?.interlocutorId || null;
  const [contatosFora, segmentosFora] = interlocutorId ? await Promise.all([
    client.contatoWhatsapp.count({ where: { vinculoNumero: { interlocutorId }, portalClientId: { notIn: visiveis } } }),
    client.conversaWhatsapp.count({ where: { vinculoNumero: { interlocutorId }, portalClientId: { not: null, notIn: visiveis } } }),
  ]) : [0,0];
  const completo = !contatosFora && !segmentosFora && todos.every(s => !s.portalClientId || visiveis.includes(s.portalClientId));
  const segmentos = todos.filter(s => s.portalClientId ? visiveis.includes(s.portalClientId) : completo && String(s.chaveEscopo).startsWith('sem-empresa:'));
  if (!segmentos.some(s => s.id === origem.id)) throw erro('conversa_nao_encontrada', 404);
  return { grupo: chave(origem), interlocutorId, origem, segmentos, completo };
}

async function resumirGrupos(grupos, { visiveis, client }) {
  if (!grupos.length) return [];
  const segmentos = grupos.flatMap(g => g.segmentos), ids = segmentos.map(s => s.id);
  const vinculos = [...new Set(segmentos.map(s => s.vinculoNumeroId).filter(Boolean))];
  const interlocutores = [...new Set(segmentos.map(s => s.vinculoNumero?.interlocutorId).filter(Boolean))];
  const [contatos, casos, mensagens, pendencias, fora] = await Promise.all([
    client.contatoWhatsapp.findMany({ where: { vinculoNumeroId: { in: vinculos }, portalClientId: { in: visiveis } } }),
    client.atendimentoLead.findMany({ where: { interlocutorId: { in: interlocutores }, encerradoEm: null }, include: { onboarding: { select: { id: true, origem: true, status: true } } } }),
    // DISTINCT ON é feito pelo banco por segmento, não uma leitura por linha da lista.
    client.$queryRaw(Prisma.sql`SELECT DISTINCT ON (COALESCE(r."conversaId",m."conversaId")) m.*, COALESCE(r."conversaId",m."conversaId") AS "segmentoEfetivo"
      FROM mensagens_whatsapp m LEFT JOIN resolucoes_contexto_whatsapp r ON r."mensagemId"=m.id
      WHERE COALESCE(r."conversaId",m."conversaId") IN (${Prisma.join(ids)}) ORDER BY COALESCE(r."conversaId",m."conversaId"),m."registradaEm" DESC,m.id DESC`),
    client.acaoPendenteWhatsapp.findMany({ where: { conversaId: { in: ids }, status: 'pendente', expiraEm: { gt: new Date() } }, orderBy: { expiraEm: 'desc' } }),
    client.vinculoNumeroInterlocutor.findMany({ where: { interlocutorId: { in: interlocutores }, OR: [
      { contatos: { some: { portalClientId: { notIn: visiveis } } } }, { conversas: { some: { portalClientId: { not: null, notIn: visiveis } } } },
    ] }, select: { interlocutorId: true } }),
  ]);
  // A janela usa o instante efetivo da entrada, não a ordem de chegada do webhook.
  // Sem vigência de identidade, legados só compartilham timestamps do mesmo telefone.
  const recebidas = await client.$queryRaw(Prisma.sql`SELECT DISTINCT ON (c."canalId",c."vinculoNumeroId",CASE WHEN c."vinculoNumeroId" IS NULL THEN c."telefoneE164" END)
      c."canalId",c."vinculoNumeroId",c."telefoneE164",m."ocorridaEmProvedor",m."registradaEm"
    FROM mensagens_whatsapp m JOIN conversas_whatsapp c ON c.id=m."conversaId" WHERE c.id IN (${Prisma.join(ids)}) AND m.direcao='in'
    ORDER BY c."canalId",c."vinculoNumeroId",CASE WHEN c."vinculoNumeroId" IS NULL THEN c."telefoneE164" END,
      LEAST(COALESCE(m."ocorridaEmProvedor",m."registradaEm"),m."registradaEm") DESC,m."registradaEm" DESC,m.id DESC`);
  const mensagensComCartao = await enriquecerMensagensWhatsapp(mensagens,{client,empresasPermitidas:visiveis});
  return grupos.map(g => {
    const vigente = s => !s.vinculoNumero?.encerrouEm;
    const maisRecente = lista => [...lista].sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt) || b.id.localeCompare(a.id))[0];
    // O detalhe conserva a escolha explícita enquanto o destinatário continuar vigente.
    // Na inbox, ter empresa não dá preferência ao telefone antigo de uma pessoa.
    const segmento = g.origem && vigente(g.origem) ? g.origem : maisRecente(g.segmentos.filter(vigente)) || g.origem || maisRecente(g.segmentos);
    const vinculo = segmento.vinculoNumero, interlocutor = vinculo?.interlocutor;
    const doGrupo = contatos.filter(c => g.segmentos.some(s => s.vinculoNumeroId === c.vinculoNumeroId));
    const caso = casos.find(a => a.interlocutorId === interlocutor?.id);
    const atual = segmento.atendimento;
    const propria = doGrupo.find(c => c.ativo && c.nome && c.vinculoNumeroId === segmento.vinculoNumeroId)
      || doGrupo.find(c => c.ativo && c.nome && g.segmentos.some(s => s.vinculoNumeroId === c.vinculoNumeroId && vigente(s)));
    const ultimas = mensagensComCartao.filter(m => g.segmentos.some(s => s.id === m.segmentoEfetivo)).sort((a,b) => new Date(b.registradaEm)-new Date(a.registradaEm) || b.id.localeCompare(a.id));
    const ultima = ultimas[0];
    const empresas = [...new Map(g.segmentos.filter(s => s.portalClientId).map(s => [s.portalClientId, empresa(s)])).values()];
    const completo = g.completo ?? !fora.some(s => s.interlocutorId === interlocutor?.id);
    const escoposNotas = interlocutor ? [ ...(completo ? [{ id: 'PESSOA', rotulo: 'Pessoa', escopo: 'PESSOA' }] : []),
      ...empresas.map(e => ({ id: `EMPRESA:${e.id}`, rotulo: e.razao, escopo: 'EMPRESA', portalClientId: e.id })),
      ...(completo && caso ? [{ id: `CASO:${caso.id}`, rotulo: 'Atendimento comercial', escopo: 'CASO', atendimentoLeadId: caso.id }] : []) ] : [];
    const canais = [...new Set(g.segmentos.filter(vigente).map(s => s.canalId || 'principal'))].map(canalId => {
      const candidatos = g.segmentos.filter(s => vigente(s) && (s.canalId || 'principal') === canalId);
      const s = candidatos.find(s => s.id === segmento.id) || maisRecente(candidatos);
      const entrada = recebidas.find(m => m.canalId === s.canalId && m.vinculoNumeroId === s.vinculoNumeroId
        && (s.vinculoNumeroId || m.telefoneE164 === s.telefoneE164));
      const janela = avaliarJanela24h(entrada || null);
      return { id: s.canalId || 'principal', chave: s.canalWhatsapp?.chave || 'principal', finalidade: s.canalWhatsapp?.finalidade || 'PRINCIPAL', conversaId: s.id, vinculoNumeroId:s.vinculoNumeroId || null, telefoneE164:s.telefoneE164, telefoneMascarado:mascararTelefone(s.telefoneE164), janela,
        podeResponder: Boolean(s.canalWhatsapp?.ativo !== false && !s.vinculoNumero?.encerrouEm && janela.situacao === 'ABERTA') };
    });
    const canal = canais.find(c => c.id === (segmento.canalId || 'principal'));
    const pendencia = pendencias.find(p => p.conversaId === segmento.id);
    const projecao = classificarRelacionamento({ contatos: doGrupo, caso: completo ? caso : null, interlocutor, vinculoNumero: vinculo });
    if (!completo) projecao.identidade.evidencia = null;
    // Uma pessoa com vários números usa os contatos ativos de todas as vigências atuais.
    if (doGrupo.some(c => c.ativo && g.segmentos.some(s => s.vinculoNumeroId === c.vinculoNumeroId && !s.vinculoNumero?.encerrouEm))) projecao.relacionamento = { tipo: 'CLIENTE', motivo: 'CONTATO_ATIVO_CADASTRADO', fonte: 'CONTATO_WHATSAPP', versao: interlocutor?.versao || 1 };
    return { id: segmento.id, interlocutorId: interlocutor?.id || null, telefoneE164: segmento.telefoneE164, telefoneMascarado: mascararTelefone(segmento.telefoneE164), nomePerfilProvedor: segmento.nomePerfilProvedor,
      contato: propria ? { id: propria.id, nome: propria.nome, papel: propria.papel } : null,
      portalClientId: segmento.portalClientId, empresa: empresa(segmento), empresas, escopoVerificado: segmento.escopoVerificado, excluidaEm: segmento.excluidaEm,
      atendidaPor: interlocutor?.atendidaPor || segmento.atendidaPor, atendidaDesde: interlocutor?.atendidaDesde || segmento.atendidaDesde, atendente: segmento.atendente ? { id: segmento.atendente.id, nome: segmento.atendente.name, email: segmento.atendente.email } : null,
      naFilaDoEscritorio: Boolean(segmento.atendidaDesde && !segmento.atendidaPor), updatedAt: g.instante || segmento.updatedAt, lidaAteEm: segmento.lidaAteEm,
      ultimaMensagem: ultima ? { id:ultima.id,direcao:ultima.direcao,tipo:ultima.tipo,corpo:resumoMensagemHistorico(ultima),autor:ultima.autor,registradaEm:ultima.registradaEm,
        empresa:ultima.referenciaComercial?.escopo === 'PESSOA' ? null : empresa(g.segmentos.find(s => s.id === ultima.segmentoEfetivo)) } : null,
      naoLidas: Number(g.naoLidas || 0), janela: canal?.janela, pendencia: pendencia ? { id: pendencia.id, tipo: pendencia.tipo, codigo: pendencia.codigo, expiraEm: pendencia.expiraEm } : null,
      ...projecao, canais, capacidades: { notaInterna: escoposNotas.length > 0, conferirIdentidade: Boolean(interlocutor && completo), escoposNotas },
      atendimento: atual ? { id: atual.id, versao: atual.versao, aguardandoSelecao: atual.aguardandoSelecao, empresaAtualId: empresas.some(e => e.id === atual.portalClientId) ? atual.portalClientId : null } : null,
      contextoOperacional: { empresaId: empresas.some(e => e.id === atual?.portalClientId) ? atual.portalClientId : null, versao: atual?.versao || null, pendente: atual?.aguardandoSelecao ?? true } };
  });
}

export async function lerHistoricoIdentidade({ conversaId, visiveis, cursor = null, mensagemId = null, limite = 100, client = prisma }) {
  const grupo = await carregarGrupoIdentidade({ conversaId, visiveis, client });
  let where = filtroMensagensIdentidade(grupo.segmentos);
  if(mensagemId) {
    const alvo = await client.mensagemWhatsapp.findFirst({where:{AND:[where,{id:String(mensagemId)}]},select:{id:true,registradaEm:true}});
    if(!alvo) throw erro('mensagem_nao_encontrada',404);
    where = {AND:[where,{OR:[{registradaEm:{lt:alvo.registradaEm}},{registradaEm:alvo.registradaEm,id:{lte:alvo.id}}]}]};
  }
  if (cursor && !await client.mensagemWhatsapp.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } })) throw erro('cursor_invalido');
  const lim = Math.min(200, Math.max(1, Number(limite) || 100));
  const achadas = await client.mensagemWhatsapp.findMany({ where, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], take: lim + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { envioGuiaTentativa: true, contexto: { select: { conversaId: true } } } });
  const pagina = achadas.slice(0, lim), [conversa] = await resumirGrupos([grupo], { visiveis, client });
  const notas = grupo.interlocutorId ? await client.notaInternaAtendimento.findMany({ where: { interlocutorId: grupo.interlocutorId,
    OR: [{ escopo: 'EMPRESA', portalClientId: { in: grupo.segmentos.map(s => s.portalClientId).filter(Boolean) } }, ...(grupo.completo ? [{ escopo: { in: ['PESSOA','CASO'] } }] : [])] }, orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }], take: 100 }) : [];
  return { ok: true, versaoContrato: 2, conversa, contextoHistorico:Boolean(mensagemId), mensagemAlvoId:mensagemId || null, temMais: achadas.length > lim, proximoCursor: achadas.length > lim ? pagina.at(-1).id : null,
    mensagens: await enriquecerMensagensWhatsapp(pagina.reverse().map(m => { const s = grupo.segmentos.find(c => c.id === porMensagem(m)); return { id: m.id, direcao: m.direcao, tipo: m.tipo, corpo: m.corpo, autor: m.autor,
      empresa: m.referenciaComercial?.escopo === 'PESSOA' ? null : empresa(s), escopoPessoa: m.referenciaComercial?.escopo === 'PESSOA', canal: { id: s?.canalId || 'principal', chave: s?.canalWhatsapp?.chave || 'principal', finalidade: s?.canalWhatsapp?.finalidade || 'PRINCIPAL' },
      providerMessageId: m.providerMessageId, envioGuiaId: m.envioGuiaId, envioGuiaTentativaId: m.envioGuiaTentativaId, ocorridaEmProvedor: m.ocorridaEmProvedor, registradaEm: m.registradaEm, temMidia: Boolean(m.midiaProvedorId),
      statusEnvio: m.envioGuiaTentativa?.status || m.statusEnvio, erroEnvio: m.erroEnvioCodigo ? { codigo: m.erroEnvioCodigo, mensagem: m.erroEnvioMensagem } : null }; }), {client,empresasPermitidas:visiveis}),
    notasInternas: notas.reverse().map(n => ({ ...n, autor: { id: n.autorId, nome: n.autorNome } })) };
}

export async function registrarLeituraIdentidade({ conversaId, mensagemId, visiveis, client = prisma }) {
  const grupo = await carregarGrupoIdentidade({ conversaId, visiveis, client });
  const mensagem = await client.mensagemWhatsapp.findFirst({ where: { AND: [filtroMensagensIdentidade(grupo.segmentos), { id: String(mensagemId || ''), direcao: 'in' }] } });
  if (!mensagem) throw erro('mensagem_nao_encontrada', 404);
  await client.conversaWhatsapp.updateMany({ where: { id: { in: grupo.segmentos.map(s => s.id) }, OR: [{ lidaAteEm: null }, { lidaAteEm: { lt: mensagem.registradaEm } }] }, data: { lidaAteEm: mensagem.registradaEm } });
  return { ok: true, lidaAteEm: mensagem.registradaEm };
}

export async function salvarNotaInterna({ conversaId, visiveis, autor, texto, escopo, portalClientId = null, atendimentoLeadId = null, chaveIdempotencia, client = prisma }) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 10000 || !/^[a-zA-Z0-9_-]{8,100}$/.test(String(chaveIdempotencia || ''))) throw erro('nota_invalida');
  const grupo = await carregarGrupoIdentidade({ conversaId, visiveis, client });
  if (!grupo.interlocutorId) throw erro('identidade_nao_migrada', 409);
  if (!['PESSOA','EMPRESA','CASO'].includes(escopo) || (escopo === 'EMPRESA' ? !grupo.segmentos.some(s => s.portalClientId === portalClientId) : !grupo.completo)) throw erro('escopo_nota_nao_autorizado', 404);
  if (escopo === 'CASO' && !await client.atendimentoLead.findFirst({ where: { id: atendimentoLeadId || '', interlocutorId: grupo.interlocutorId } })) throw erro('caso_nao_encontrado', 404);
  const dados = { interlocutorId: grupo.interlocutorId, texto: texto.trim(), escopo, portalClientId: escopo === 'EMPRESA' ? portalClientId : null, atendimentoLeadId: escopo === 'CASO' ? atendimentoLeadId : null,
    autorId: autor.id, autorNome: autor.name || autor.email || 'Equipe', chaveIdempotencia };
  const nota = await client.notaInternaAtendimento.upsert({ where: { interlocutorId_chaveIdempotencia: { interlocutorId: grupo.interlocutorId, chaveIdempotencia } }, create:dados,update:{} });
  if (['texto','escopo','portalClientId','atendimentoLeadId','autorId'].some(k => nota[k] !== dados[k])) throw erro('idempotencia_divergente',409);
  return { ok: true, nota: { ...nota, autor: { id: nota.autorId, nome: nota.autorNome } } };
}


/** Pesquisa apenas conteúdo persistido e já autorizado no mesmo grupo. Nunca consulta serviços fiscais. */
export async function buscarMensagensIdentidade({ conversaId, visiveis, q, cursor = null, limite = 20, client = prisma }) {
  const texto = String(q || '').trim();
  if (texto.length < 2 || texto.length > 200) throw erro('busca_invalida');
  const grupo = await carregarGrupoIdentidade({ conversaId, visiveis, client });
  const autorizado = filtroMensagensIdentidade(grupo.segmentos);
  const where = { AND: [autorizado, { OR: [
    { corpo: { contains: texto, mode: 'insensitive' } },
    { arquivoWhatsapp: { is: { nomeArquivo: { contains: texto, mode: 'insensitive' }, OR:[{portalClientId:null},{portalClientId:{in:visiveis}}] } } },
    { referenciaComercial: { path: ['nome'], string_contains: texto } },
    { envioGuia: { is: { guide: { is: { portalClientId:{in:visiveis}, OR: [{ tipo: { contains: texto, mode: 'insensitive' } }, { competencia: { contains: texto, mode: 'insensitive' } }] } } } } },
  ] }] };
  if (cursor && !await client.mensagemWhatsapp.findFirst({ where: { AND: [where, { id: String(cursor) }] }, select: { id: true } })) throw erro('cursor_invalido');
  const lim = Math.min(50, Math.max(1, Number(limite) || 20));
  const rows = await client.mensagemWhatsapp.findMany({ where, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], take: lim + 1,
    ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}), include: { envioGuiaTentativa: true, contexto: { select: { conversaId: true } } } });
  const pagina = rows.slice(0, lim);
  return { ok: true, resultados: pagina.map(m => ({ id:m.id,corpo:m.corpo,tipo:m.tipo,direcao:m.direcao,autor:m.autor,registradaEm:m.registradaEm,providerMessageId:m.providerMessageId,statusEnvio:m.envioGuiaTentativa?.status || m.statusEnvio,envioGuiaId:m.envioGuiaId,envioGuiaTentativaId:m.envioGuiaTentativaId, conversaId: porMensagem(m), empresa: empresa(grupo.segmentos.find(s => s.id === porMensagem(m))) })), temMais: rows.length > lim, proximoCursor: rows.length > lim ? pagina.at(-1).id : null };
}
