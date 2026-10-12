import { createHash, randomUUID } from 'node:crypto';
import { carregarGrupo, transacao, ultimaConfiguracao, disponibilidadeCredencial } from './ApuracaoConsumoService.js';

export const LIMITE_ARQUIVO_CBS = 10 * 1024 * 1024;
const EM_ABERTO = ['RESERVADA', 'INCERTA', 'PENDENTE', 'EM_PROCESSAMENTO', 'DISPONIVEL'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const falha = (status, code, message) => Object.assign(new Error(message), { status, code });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const agora = deps => new Date(deps.agora ? deps.agora() : Date.now());
const escopo = (coleta, finalidade) => ({ contribuinteId: coleta.contribuinteId, ambiente: coleta.ambiente, coletaId: coleta.id, finalidade });
const arquivoSelect = { id: true, sha256: true, tamanhoBytes: true, contentType: true, createdAt: true };
const tentativaSelect = { id: true, operacao: true, estado: true, iniciadaEm: true, finalizadaEm: true, erroCodigo: true };

// Valida somente identidade/envelope; não interpreta nem totaliza valores fiscais.
export function validarEnvelopeArquivoCbs(bytes, { cnpjBase, ticket, recurso }) {
  try {
    const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const campo = recurso === 'DEBITOS' ? 'debitos' : recurso === 'CREDITOS' ? 'creditos' : null;
    if (!campo || !doc || doc.ni !== cnpjBase || doc.tiqueteSolicitacao !== ticket
      || typeof doc.geradoEm !== 'string' || !Number.isFinite(Date.parse(doc.geradoEm)) || !Array.isArray(doc.apuracao)
      || doc.apuracao.some(a => !a || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(a.pa) || !Array.isArray(a[campo]))) throw new Error();
  } catch { throw falha(502, 'CBS_ARQUIVO_CONTEXTO_INVALIDO', 'O arquivo não corresponde ao envelope e à identidade desta coleta.'); }
}

function validar(entrada, operacao = null) {
  const campos = operacao === 'ABRIR' ? ['id', 'ambiente', 'recurso'] : operacao ? ['id', 'ambiente'] : ['ambiente'];
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || Object.keys(entrada).some(k => !campos.includes(k))) {
    throw falha(400, 'CBS_ENTRADA_INVALIDA', 'A coleta CBS não aceita competência, datas ou cursor como filtro.');
  }
  if (!['HOMOLOGACAO', 'PRODUCAO'].includes(entrada.ambiente)) throw falha(400, 'CBS_AMBIENTE_INVALIDO', 'Informe o ambiente da coleta.');
  if (operacao && !uuid.test(entrada.id || '')) throw falha(400, 'CBS_INTENCAO_INVALIDA', 'Identificador da intenção inválido.');
  if (operacao === 'ABRIR' && !['DEBITOS', 'CREDITOS'].includes(entrada.recurso)) throw falha(400, 'CBS_RECURSO_INVALIDO', 'Escolha débitos ou créditos.');
}

async function contexto(db, companyId, ambiente, usuario) {
  const grupo = await carregarGrupo(db, companyId, usuario, true);
  const configuracao = grupo ? await ultimaConfiguracao(db, grupo.id, { tributo: 'CBS', ambiente }) : null;
  const credencialDisponivel = configuracao ? await disponibilidadeCredencial(db, configuracao) : null;
  return { grupo, configuracao, credencialDisponivel };
}
function bloqueiosDoContexto(ctx, ambiente, deps) {
  const bloqueios = [];
  const add = (codigo, mensagem) => bloqueios.push({ codigo, mensagem });
  if (!deps.cliente || !deps.protecao) add('CBS_INTEGRACAO_DESABILITADA', 'Integração externa desabilitada. Autenticação e retorno oficial precisam ser validados antes da ativação.');
  else if (deps.cliente.ambiente !== ambiente || !['abrir', 'consultar', 'baixar'].every(k => typeof deps.cliente[k] === 'function')
    || !['cifrar', 'decifrar'].every(k => typeof deps.protecao[k] === 'function')) add('CBS_RUNTIME_INCOMPATIVEL', 'A integração não foi configurada para este ambiente.');
  else if (deps.cliente.contexto?.contribuinteId !== ctx.grupo?.id || deps.cliente.contexto?.credencialId !== ctx.configuracao?.dados?.credencialId)
    add('CBS_RUNTIME_CONTEXTO_INVALIDO', 'A integração não está vinculada ao contribuinte e à credencial deste contexto.');
  if (!ctx.grupo) add('CBS_GRUPO_AUSENTE', 'Vincule os estabelecimentos antes de coletar.');
  if (!ctx.configuracao?.habilitado) add('CBS_CONFIGURACAO_DESABILITADA', 'Habilite a preparação local deste ambiente.');
  if (ctx.credencialDisponivel !== true) add('CBS_CREDENCIAL_INDISPONIVEL', 'A referência de credencial precisa estar disponível no cofre; isso não comprova habilitação oficial.');
  return bloqueios;
}
function exigirExecucao(ctx, ambiente, deps) {
  const bloqueios = bloqueiosDoContexto(ctx, ambiente, deps);
  if (bloqueios.length) throw falha(bloqueios.some(b => b.codigo.includes('INTEGRACAO') || b.codigo.includes('RUNTIME')) ? 503 : 409,
    bloqueios[0].codigo, bloqueios[0].mensagem);
}

async function dto(db, coleta, deps = {}) {
  const [tentativas, arquivos] = await Promise.all([
    db.apuracaoCbsTentativa.findMany({ where: { coletaId: coleta.id, contribuinteId: coleta.contribuinteId, ambiente: coleta.ambiente }, select: tentativaSelect, orderBy: { iniciadaEm: 'desc' }, take: 100 }),
    db.apuracaoCbsArquivo.findMany({ where: { coletaId: coleta.id, contribuinteId: coleta.contribuinteId, ambiente: coleta.ambiente }, select: arquivoSelect }),
  ]);
  const expirou = coleta.estado === 'DISPONIVEL' && coleta.arquivoExpiraEm && new Date(coleta.arquivoExpiraEm) <= agora(deps);
  return { id: coleta.id, recurso: coleta.recurso, ambiente: coleta.ambiente, estado: expirou ? 'EXPIRADA' : coleta.estado, ticket: coleta.ticket || null,
    etaSegundos: coleta.etaSegundos || null, arquivoExpiraEm: coleta.arquivoExpiraEm || null, createdAt: coleta.createdAt,
    updatedAt: coleta.updatedAt, erroCodigo: coleta.erroCodigo || null, operacaoEmCurso: Boolean(coleta.operacaoEmCursoId),
    tentativas, arquivos, evidenciaHttp: 'RESUMO_CANONICO', cobertura: 'NAO_VALIDADA', valoresOficiais: null };
}

export async function listarColetasCbs(db, companyId, entrada, usuario, deps = {}) {
  validar(entrada);
  return transacao(db, async tx => {
    const ctx = await contexto(tx, companyId, entrada.ambiente, usuario);
    const bloqueios = bloqueiosDoContexto(ctx, entrada.ambiente, deps);
    const rows = ctx.grupo ? await tx.apuracaoCbsColeta.findMany({ where: { contribuinteId: ctx.grupo.id, ambiente: entrada.ambiente }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 101 }) : [];
    const habilitado = bloqueios.length === 0;
    return { ambiente: entrada.ambiente, capacidades: { abrir: habilitado, consultar: habilitado, baixar: habilitado, reprocessar: typeof deps.protecao?.decifrar === 'function' }, bloqueios,
      coletas: await Promise.all(rows.slice(0, 100).map(c => dto(tx, c, deps))), limite: 100, truncada: rows.length > 100,
      aviso: 'A coleta pode conter várias competências. Arquivo armazenado não significa apuração conferida; nenhuma consulta ocorre ao atualizar esta lista.' };
  });
}

async function carregarColeta(db, coletaId, ctx, ambiente) {
  const coleta = ctx.grupo ? await db.apuracaoCbsColeta.findFirst({ where: { id: coletaId, contribuinteId: ctx.grupo.id, ambiente } }) : null;
  if (!coleta) throw falha(404, 'CBS_COLETA_NAO_ENCONTRADA', 'Coleta não encontrada neste contexto.');
  return coleta;
}
function inicioDiaBrasilia(data) {
  const dia = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
  return new Date(`${dia}T00:00:00-03:00`);
}

async function reservar(db, companyId, coletaId, entrada, usuario, operacao, deps) {
  validar(entrada, operacao);
  const requestHash = hash(JSON.stringify([operacao, coletaId || null, entrada.ambiente, entrada.recurso || null]));
  return transacao(db, async tx => {
    const ctx = await contexto(tx, companyId, entrada.ambiente, usuario);
    if (!ctx.grupo) throw falha(409, 'CBS_GRUPO_AUSENTE', 'Vincule os estabelecimentos primeiro.');
    const repetida = await tx.apuracaoCbsTentativa.findFirst({ where: { contribuinteId: ctx.grupo.id, requestKey: entrada.id } });
    if (repetida) {
      if (repetida.requestHash !== requestHash) throw falha(409, 'CBS_INTENCAO_REUTILIZADA', 'A intenção já foi usada com outro conteúdo.');
      return { repetida: true, coleta: await carregarColeta(tx, repetida.coletaId, ctx, entrada.ambiente) };
    }
    exigirExecucao(ctx, entrada.ambiente, deps);
    const momento = agora(deps);
    let coleta;
    if (operacao === 'ABRIR') {
      // A nova intenção manual encerra somente disponibilidade vencida do mesmo contexto.
      // GET jamais faz limpeza, e uma reserva interrompida nunca é retomada aqui.
      await tx.apuracaoCbsColeta.updateMany({ where: { contribuinteId: ctx.grupo.id, ambiente: entrada.ambiente,
        recurso: entrada.recurso, estado: 'DISPONIVEL', arquivoExpiraEm: { lte: momento }, operacaoEmCursoId: null },
      data: { estado: 'EXPIRADA', dadosDownloadCifrados: null } });
      const ativa = await tx.apuracaoCbsColeta.findFirst({ where: { contribuinteId: ctx.grupo.id, ambiente: entrada.ambiente, recurso: entrada.recurso, estado: { in: EM_ABERTO } } });
      if (ativa) throw falha(409, 'CBS_COLETA_EM_ABERTO', 'Já existe coleta em andamento ou sem resultado confirmado. Confira a existente antes de abrir outra.');
      // Restrição LOCAL conservadora: quatro aberturas por base/ambiente/dia, somando os recursos.
      const quantidade = await tx.apuracaoCbsColeta.count({ where: { contribuinteId: ctx.grupo.id, ambiente: entrada.ambiente, createdAt: { gte: inicioDiaBrasilia(momento) } } });
      if (quantidade >= 4) throw falha(409, 'CBS_LIMITE_LOCAL_ABERTURAS', 'Limite local conservador de quatro aberturas no dia atingido. Não haverá repetição automática.');
      coleta = await tx.apuracaoCbsColeta.create({ data: { id: randomUUID(), contribuinteId: ctx.grupo.id, tributo: 'CBS', ambiente: entrada.ambiente,
        recurso: entrada.recurso, configuracaoId: ctx.configuracao.id, estado: 'RESERVADA', requestKey: entrada.id, requestHash,
        criadoPorId: String(usuario.id), createdAt: momento } });
    } else {
      coleta = await carregarColeta(tx, coletaId, ctx, entrada.ambiente);
      if (coleta.operacaoEmCursoId) throw falha(409, 'CBS_OPERACAO_EM_CURSO', 'Há uma operação em curso ou interrompida. Não será repetida automaticamente.');
      if (operacao === 'CONSULTAR' && (!coleta.ticket || ['ARQUIVADA', 'ERRO', 'EXPIRADA'].includes(coleta.estado))) throw falha(409, 'CBS_ESTADO_INVALIDO', 'Esta coleta não permite consultar o tíquete.');
      if (operacao === 'BAIXAR' && coleta.estado !== 'DISPONIVEL') throw falha(409, 'CBS_ESTADO_INVALIDO', 'O arquivo ainda não está disponível para armazenamento.');
    }
    const tentativa = await tx.apuracaoCbsTentativa.create({ data: { coletaId: coleta.id, contribuinteId: ctx.grupo.id, ambiente: entrada.ambiente,
      operacao, requestKey: entrada.id, requestHash, estado: 'RESERVADA', criadoPorId: String(usuario.id), iniciadaEm: momento } });
    const reserva = await tx.apuracaoCbsColeta.updateMany({ where: { id: coleta.id, operacaoEmCursoId: null }, data: { operacaoEmCursoId: tentativa.id } });
    if (reserva.count !== 1) throw falha(409, 'CBS_OPERACAO_EM_CURSO', 'Outra operação reservou esta coleta.');
    return { coleta: { ...coleta, operacaoEmCursoId: tentativa.id }, tentativa, cnpjBase: ctx.grupo.cnpjBase };
  });
}

async function finalizar(db, reserva, dados, evidencia, deps, arquivo = null) {
  const { coleta, tentativa } = reserva;
  const evidenciaCifrada = await deps.protecao.cifrar(Buffer.from(JSON.stringify(evidencia)), escopo(coleta, `tentativa:${tentativa.id}`));
  return transacao(db, async tx => {
    const update = await tx.apuracaoCbsColeta.updateMany({ where: { id: coleta.id, operacaoEmCursoId: tentativa.id }, data: { erroCodigo: null, ...dados, operacaoEmCursoId: null } });
    if (update.count !== 1) throw falha(409, 'CBS_RESERVA_PERDIDA', 'A reserva desta operação mudou. Confira o resultado antes de repetir.');
    if (arquivo) await tx.apuracaoCbsArquivo.create({ data: arquivo });
    await tx.apuracaoCbsTentativa.update({ where: { id: tentativa.id }, data: { estado: 'CONCLUIDA', evidenciaCifrada, finalizadaEm: agora(deps) } });
    return dto(tx, await tx.apuracaoCbsColeta.findUnique({ where: { id: coleta.id } }), deps);
  });
}

async function registrarFalha(db, reserva, error, deps) {
  const { coleta, tentativa } = reserva;
  const codigo = /^CBS_[A-Z0-9_]{1,70}$/.test(error?.code || '') ? error.code : 'CBS_RESULTADO_NAO_CONFIRMADO';
  const expirou = codigo === 'CBS_ARQUIVO_EXPIRADO';
  const incerto = typeof error?.resultadoIncerto === 'boolean' ? error.resultadoIncerto : !Number.isInteger(error?.status) || error.status >= 500;
  const estado = expirou ? 'EXPIRADA' : tentativa.operacao === 'ABRIR' ? (incerto ? 'INCERTA' : 'ERRO') : tentativa.operacao === 'BAIXAR' ? coleta.estado : 'INCERTA';
  await transacao(db, async tx => {
    const update = await tx.apuracaoCbsColeta.updateMany({ where: { id: coleta.id, operacaoEmCursoId: tentativa.id }, data: { estado, erroCodigo: codigo, operacaoEmCursoId: null, ...(expirou ? { dadosDownloadCifrados: null } : {}) } });
    if (update.count === 1) await tx.apuracaoCbsTentativa.update({ where: { id: tentativa.id }, data: { estado: incerto ? 'INCERTA' : 'ERRO', erroCodigo: codigo, finalizadaEm: agora(deps) } });
  });
  throw falha(expirou ? 409 : 502, codigo, expirou ? 'O arquivo oficial expirou. Nenhuma nova coleta foi aberta.' : 'A operação não foi confirmada. Confira o estado salvo; não houve repetição automática.');
}

export async function abrirColetaCbs(db, companyId, entrada, usuario, deps = {}) {
  const reserva = await reservar(db, companyId, null, entrada, usuario, 'ABRIR', deps);
  if (reserva.repetida) return dto(db, reserva.coleta, deps);
  try {
    const out = await deps.cliente.abrir({ cnpjBase: reserva.cnpjBase, tipo: entrada.recurso });
    if (typeof out?.tiqueteSolicitacao !== 'string' || !out.tiqueteSolicitacao.trim() || out.tiqueteSolicitacao.length > 500
      || !/^\d+$/.test(String(out.tEASegundos))) throw falha(502, 'CBS_ABERTURA_INVALIDA', 'Resposta de abertura inválida.');
    const evidencia = { tiqueteSolicitacao: out.tiqueteSolicitacao, tEASegundos: String(out.tEASegundos) };
    return await finalizar(db, reserva, { estado: 'PENDENTE', ticket: evidencia.tiqueteSolicitacao, etaSegundos: evidencia.tEASegundos }, evidencia, deps);
  } catch (e) { return registrarFalha(db, reserva, e, deps); }
}

export async function consultarColetaCbs(db, companyId, coletaId, entrada, usuario, deps = {}) {
  const reserva = await reservar(db, companyId, coletaId, entrada, usuario, 'CONSULTAR', deps);
  if (reserva.repetida) return dto(db, reserva.coleta, deps);
  try {
    const out = await deps.cliente.consultar({ tiqueteSolicitacao: reserva.coleta.ticket });
    if (!['PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDA', 'ERRO'].includes(out?.estado)) throw falha(502, 'CBS_SITUACAO_INVALIDA', 'Situação oficial não reconhecida.');
    const evidencia = { estado: out.estado };
    const dados = { estado: out.estado === 'CONCLUIDA' ? 'DISPONIVEL' : out.estado };
    if (out.estado === 'ERRO') {
      dados.erroCodigo = /^[A-Za-z0-9_-]{1,80}$/.test(out.codigoErro || '') ? out.codigoErro : 'CBS_ERRO_OFICIAL';
      evidencia.codigoErro = dados.erroCodigo;
      dados.dadosDownloadCifrados = null;
    }
    if (out.estado === 'CONCLUIDA') {
      const expira = new Date(out.urlAssinadaExpiraEm);
      if (typeof out.urlAssinada !== 'string' || out.urlAssinada.length > 8192 || !out.urlAssinada.startsWith('https://') || !Number.isFinite(expira.getTime())) throw falha(502, 'CBS_SITUACAO_INVALIDA', 'Disponibilidade oficial inválida.');
      dados.arquivoExpiraEm = expira;
      evidencia.urlAssinadaExpiraEm = expira.toISOString();
      dados.dadosDownloadCifrados = await deps.protecao.cifrar(Buffer.from(JSON.stringify({ urlAssinada: out.urlAssinada, urlAssinadaExpiraEm: expira.toISOString() })), escopo(reserva.coleta, 'download'));
      if (expira <= agora(deps)) { dados.estado = 'EXPIRADA'; dados.dadosDownloadCifrados = null; }
    }
    return await finalizar(db, reserva, dados, evidencia, deps);
  } catch (e) { return registrarFalha(db, reserva, e, deps); }
}

export async function baixarArquivoColetaCbs(db, companyId, coletaId, entrada, usuario, deps = {}) {
  const reserva = await reservar(db, companyId, coletaId, entrada, usuario, 'BAIXAR', deps);
  if (reserva.repetida) return dto(db, reserva.coleta, deps);
  try {
    const c = reserva.coleta;
    if (!c.arquivoExpiraEm || new Date(c.arquivoExpiraEm) <= agora(deps)) throw falha(409, 'CBS_ARQUIVO_EXPIRADO', 'Arquivo expirado.');
    const segredo = JSON.parse((await deps.protecao.decifrar(c.dadosDownloadCifrados, escopo(c, 'download'))).toString('utf8'));
    const bytes = await deps.cliente.baixar(segredo);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMITE_ARQUIVO_CBS) throw falha(502, 'CBS_ARQUIVO_INVALIDO', 'Arquivo ausente ou acima do limite de 10 MB.');
    validarEnvelopeArquivoCbs(bytes, { cnpjBase: reserva.cnpjBase, ticket: c.ticket, recurso: c.recurso });
    const sha256 = hash(bytes);
    const arquivo = { coletaId: c.id, contribuinteId: c.contribuinteId, ambiente: c.ambiente, sha256, tamanhoBytes: bytes.length,
      contentType: 'application/octet-stream', conteudoCifrado: await deps.protecao.cifrar(bytes, escopo(c, 'arquivo')), criadoPorId: String(usuario.id) };
    return await finalizar(db, reserva, { estado: 'ARQUIVADA', dadosDownloadCifrados: null }, { sha256, tamanhoBytes: bytes.length }, deps, arquivo);
  } catch (e) { return registrarFalha(db, reserva, e, deps); }
}
