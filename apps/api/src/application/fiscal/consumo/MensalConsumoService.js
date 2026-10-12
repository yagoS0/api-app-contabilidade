import { createHash, randomUUID } from 'node:crypto';
import { carregarGrupo, transacao, ultimaConfiguracao, enquadramentos } from './ApuracaoConsumoService.js';
import { intervaloCompetencia } from '../reforma/ReformaFiscalService.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const vazio = () => ({ valoresDeclarados: null, cobertura: null, tratamento: null, pendencias: [], conferencia: null, guias: [], pagamentos: [], alocacoes: [] });
function objeto(value, campos) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !campos.includes(k))) throw fail(400, 'Campos inválidos para o livro mensal local.');
}
function texto(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(400, 'Informe texto obrigatório dentro do limite.');
  return value.trim();
}
function identificador(value) { if (!uuid.test(value || '')) throw fail(400, 'Identificador inválido.'); return value; }
export function centavosExatos(value, positivo = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(value) || (positivo && value === '0')) throw fail(400, 'Informe centavos inteiros como texto, sem sinal ou separadores (até 18 dígitos).');
  return value;
}
function dataCivil(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail(400, 'Data civil inválida.');
  return value;
}
function evidencia(value) {
  objeto(value, ['referencia', 'sha256', 'descricao']);
  if (typeof value.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.sha256)) throw fail(400, 'Informe SHA-256 de 64 caracteres da evidência referenciada.');
  return { referencia: texto(value.referencia, 500), sha256: value.sha256.toLowerCase(), descricao: texto(value.descricao, 1500),
    natureza: 'REFERENCIA_DECLARADA', arquivoArmazenado: false, verificacaoOficial: false };
}
function contexto(entrada) {
  if (!['CBS', 'IBS'].includes(entrada?.tributo) || !['HOMOLOGACAO', 'PRODUCAO'].includes(entrada?.ambiente)) throw fail(400, 'Informe tributo e ambiente.');
  intervaloCompetencia(entrada.competencia);
  return { tributo: entrada.tributo, ambiente: entrada.ambiente, competencia: entrada.competencia };
}
async function carregar(tx, companyId, ctx, usuario) {
  const grupo = await carregarGrupo(tx, companyId, usuario, true);
  if (!grupo) throw fail(409, 'Vincule os estabelecimentos antes de usar o livro mensal.');
  const configuracao = await ultimaConfiguracao(tx, grupo.id, ctx);
  const cadastro = await enquadramentos(tx, grupo, ctx.competencia);
  const snapshot = { configuracaoId: configuracao?.id || null, habilitado: configuracao?.habilitado === true,
    estabelecimentos: grupo.estabelecimentos.map(e => ({ id: e.id, cnpj: e.cnpj })), cadastro };
  const atual = await tx.apuracaoConsumoMesLocal.findFirst({ where: { contribuinteId: grupo.id, ...ctx }, orderBy: { versao: 'desc' } });
  return { grupo, snapshot, atual };
}
function pendencias(dados, ctx, snapshot) {
  const result = [], add = (codigo, mensagem) => result.push({ codigo, mensagem });
  if (!snapshot.habilitado) add('PREPARACAO_DESABILITADA', 'Habilite a preparação local deste tributo e ambiente.');
  if (snapshot.cadastro.some(c => !c.regularConfirmado)) add('CADASTRO_INCOMPLETO', 'Confirme o enquadramento regular de todos os estabelecimentos durante todo o mês.');
  if (snapshot.cadastro.some(c => !['LUCRO_PRESUMIDO', 'LUCRO_REAL', 'SIMPLES'].includes(c.periodo?.regime)
    || (c.periodo?.regime === 'SIMPLES' && ctx.competencia < '2027-01'))) add('REGIME_INCOMPATIVEL', 'Regime não suportado pelo livro regular nesta competência. MEI, DAS e exceções exigem tratamento próprio.');
  if (!dados.tratamento || dados.tratamento.tipo === 'NAO_DEFINIDO') add('TRATAMENTO_NAO_CLASSIFICADO', 'Documente se o mês pertence ao tratamento regular padrão, específico ou DeRE.');
  else if (dados.tratamento.tipo !== 'REGULAR_PADRAO') add('TRATAMENTO_ESPECIFICO_NAO_SUPORTADO', 'Conferência bloqueada: este livro não implementa tratamento específico ou DeRE.');
  if (!dados.valoresDeclarados) add('VALORES_AUSENTES', 'Registre valores declarados, inclusive zero quando documentado.');
  const c = dados.cobertura;
  const ultimoDia = new Date(intervaloCompetencia(ctx.competencia).lt.getTime() - 86400000).toISOString().slice(0, 10);
  if (!c || c.inicio !== `${ctx.competencia}-01` || c.fim !== ultimoDia
    || snapshot.estabelecimentos.some(e => !c.estabelecimentoIds.includes(e.id))
    || c.estabelecimentoIds.some(id => !snapshot.estabelecimentos.some(e => e.id === id))
    || !['DEBITOS', 'CREDITOS'].every(r => c.recursos.includes(r))) add('COBERTURA_INCOMPLETA', 'Declare e documente a cobertura de todo o mês, de todos os estabelecimentos, dos débitos e créditos.');
  if (dados.pendencias.some(p => !p.resolvida)) add('PENDENCIAS_ABERTAS', 'Resolva as pendências antes da conferência local.');
  return result;
}
function totais(dados) {
  const ativas = dados.alocacoes.filter(a => !a.estornada);
  const somar = (campo, id) => ativas.filter(a => a[campo] === id).reduce((n, a) => n + BigInt(a.valorCentavos), 0n);
  return { ...dados,
    guias: dados.guias.map(g => { const n = somar('guiaId', g.id); return { ...g, alocadoCentavos: String(n), saldoCentavos: String(BigInt(g.valorCentavos) - n),
      estadoLocal: g.cancelada ? 'CANCELADA_LOCALMENTE' : n === 0n ? 'SEM_ALOCACAO' : n === BigInt(g.valorCentavos) ? 'ALOCADA_LOCALMENTE' : 'PARCIAL_LOCALMENTE' }; }),
    pagamentos: dados.pagamentos.map(p => { const n = somar('pagamentoId', p.id); return { ...p, alocadoCentavos: String(n), saldoCentavos: String(BigInt(p.valorCentavos) - n) }; }),
  };
}
function dto(ctx, loaded, registro = loaded.atual) {
  const dados = registro?.dados || vazio();
  const desatualizada = Boolean(registro && hash(registro.contextoSnapshot) !== hash(loaded.snapshot));
  const calculadas = pendencias(dados, ctx, loaded.snapshot);
  if (desatualizada) calculadas.push({ codigo: 'CONTEXTO_ALTERADO', mensagem: 'Cadastro ou configuração mudou. Registre novamente a base para nova conferência.' });
  return { ...ctx, contextoHash: hash(loaded.snapshot), versao: registro?.versao || 0, estado: registro?.estado === 'CONFERIDA_LOCAL' && !desatualizada ? 'CONFERIDA_LOCAL' : 'EM_CONFERENCIA',
    podeEditar: true, desatualizada, estabelecimentos: loaded.grupo.estabelecimentos, pendenciasCalculadas: calculadas,
    podeConferir: calculadas.length === 0, capacidades: { editar: true, conferirLocal: true, emitirGuia: false, confirmarOficial: false, consultarPagamento: false },
    dados: totais(dados), valoresOficiais: null, revisaoId: registro?.id || null,
    aviso: 'Livro local de declarações e conferência humana. Referências e hashes são declarados; documentos não são armazenados nem verificados aqui. Alocações locais não confirmam extinção perante o fisco.' };
}
export async function lerMensalConsumo(db, companyId, entrada, usuario) {
  objeto(entrada, ['tributo', 'ambiente', 'competencia']); const ctx = contexto(entrada);
  return transacao(db, async tx => dto(ctx, await carregar(tx, companyId, ctx, usuario)));
}
export async function listarHistoricoMensalConsumo(db, companyId, entrada, usuario) {
  objeto(entrada, ['tributo', 'ambiente', 'competencia']); const ctx = contexto(entrada);
  return transacao(db, async tx => {
    const loaded = await carregar(tx, companyId, ctx, usuario);
    const rows = await tx.apuracaoConsumoMesLocal.findMany({ where: { contribuinteId: loaded.grupo.id, ...ctx }, orderBy: { versao: 'desc' }, take: 101,
      select: { id: true, versao: true, acao: true, estado: true, criadoPorId: true, createdAt: true, comando: true, requestHash: true } });
    return { ...ctx, historico: rows.slice(0, 100), truncado: rows.length > 100 };
  });
}
function cobertura(value, grupo) {
  objeto(value, ['inicio', 'fim', 'estabelecimentoIds', 'recursos', 'evidencia']);
  const inicio = dataCivil(value.inicio), fim = dataCivil(value.fim);
  if (inicio > fim || !Array.isArray(value.estabelecimentoIds) || !value.estabelecimentoIds.length || value.estabelecimentoIds.length > 100
    || value.estabelecimentoIds.some(id => !grupo.estabelecimentos.some(e => e.id === id))
    || !Array.isArray(value.recursos) || !value.recursos.length || value.recursos.some(r => !['DEBITOS', 'CREDITOS'].includes(r))) throw fail(400, 'Cobertura inválida ou fora dos estabelecimentos vinculados.');
  return { inicio, fim, estabelecimentoIds: [...new Set(value.estabelecimentoIds)].sort(), recursos: [...new Set(value.recursos)].sort(),
    evidencia: evidencia(value.evidencia), origem: 'DECLARADA_MANUAL', coberturaOficial: false };
}
async function reservarDocumento(tx, grupo, ctx, tipo, referencia, usuario) {
  const referenciaHash = hash(referencia.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim());
  if (await tx.apuracaoConsumoDocumentoLocal.findFirst({ where: { contribuinteId: grupo.id, tributo: ctx.tributo, ambiente: ctx.ambiente, tipo, referenciaHash } })) throw fail(409, 'Esta referência já foi registrada neste tributo e ambiente, inclusive em outra competência.');
  return tx.apuracaoConsumoDocumentoLocal.create({ data: { contribuinteId: grupo.id, ...ctx, tipo, referencia, referenciaHash, criadoPorId: String(usuario.id) } });
}
export async function executarAcaoMensalConsumo(db, companyId, entrada, usuario) {
  objeto(entrada, ['id', 'versao', 'tributo', 'ambiente', 'competencia', 'contextoHash', 'acao', 'dados']);
  identificador(entrada.id); const ctx = contexto(entrada);
  if (!Number.isSafeInteger(entrada.versao) || entrada.versao < 0) throw fail(400, 'Versão inválida.');
  const acoes = ['REGISTRAR_BASE', 'RESOLVER_PENDENCIA', 'CONFERIR_LOCAL', 'REGISTRAR_GUIA', 'REGISTRAR_PAGAMENTO', 'ALOCAR', 'ESTORNAR_ALOCACAO', 'CANCELAR_GUIA', 'CANCELAR_PAGAMENTO'];
  if (!acoes.includes(entrada.acao)) throw fail(400, 'Ação local inválida. Operações oficiais não estão habilitadas.');
  if ((entrada.acao === 'REGISTRAR_BASE' || entrada.contextoHash !== undefined)
    && (typeof entrada.contextoHash !== 'string' || !/^[a-f0-9]{64}$/.test(entrada.contextoHash))) throw fail(400, 'Informe o contexto da base lida antes de gravar.');
  const requestHash = hash({ ...ctx, versao: entrada.versao, contextoHash: entrada.contextoHash, acao: entrada.acao, dados: entrada.dados });
  return transacao(db, async tx => {
    const loaded = await carregar(tx, companyId, ctx, usuario), { grupo, atual, snapshot } = loaded;
    const repetida = await tx.apuracaoConsumoMesLocal.findFirst({ where: { contribuinteId: grupo.id, requestKey: entrada.id } });
    if (repetida) {
      if (repetida.requestHash !== requestHash) throw fail(409, 'A intenção já foi usada com outro conteúdo.');
      // A resposta traz o estado atual; repetir intenção antiga não regrava nem faz a tela regredir.
      return dto(ctx, loaded);
    }
    if ((atual?.versao || 0) !== entrada.versao) throw fail(409, 'O mês mudou. Atualize antes de gravar nova intenção.');
    if (entrada.contextoHash !== undefined && entrada.contextoHash !== hash(snapshot)) throw fail(409, 'Cadastro ou configuração mudou desde a leitura. Recarregue e revise a base antes de gravar.');
    const dados = structuredClone(atual?.dados || vazio()), body = entrada.dados;
    let estado = atual?.estado || 'EM_CONFERENCIA';
    const audit = { criadoPorId: String(usuario.id), registradoEm: new Date().toISOString() };
    if (entrada.acao === 'REGISTRAR_BASE') {
      objeto(body, ['valoresDeclarados', 'cobertura', 'tratamento', 'pendencias']); objeto(body.valoresDeclarados, ['debitosCentavos', 'creditosCentavos']);
      dados.valoresDeclarados = { debitosCentavos: centavosExatos(body.valoresDeclarados.debitosCentavos), creditosCentavos: centavosExatos(body.valoresDeclarados.creditosCentavos), origem: 'DECLARADA_MANUAL' };
      dados.cobertura = cobertura(body.cobertura, grupo);
      dados.tratamento = null;
      if (body.tratamento != null) {
        objeto(body.tratamento, ['tipo', 'evidencia']);
        if (!['REGULAR_PADRAO', 'ESPECIFICO', 'DERE', 'NAO_DEFINIDO'].includes(body.tratamento.tipo)) throw fail(400, 'Classificação de tratamento inválida.');
        dados.tratamento = { tipo: body.tratamento.tipo, evidencia: evidencia(body.tratamento.evidencia), origem: 'DECLARADA_MANUAL' };
      }
      if (!Array.isArray(body.pendencias) || body.pendencias.length > 200) throw fail(400, 'Informe até 200 pendências.');
      const novasPendencias = body.pendencias.map(p => { objeto(p, ['id', 'descricao']); return { id: identificador(p.id), descricao: texto(p.descricao), resolvida: false }; });
      if (dados.pendencias.some(p => !p.resolvida && !novasPendencias.some(n => n.id === p.id && n.descricao === p.descricao)))
        throw fail(409, 'Resolva com evidência as pendências abertas antes de removê-las ou alterar sua descrição.');
      dados.pendencias = novasPendencias;
      if (new Set(dados.pendencias.map(p => p.id)).size !== dados.pendencias.length) throw fail(400, 'Pendências duplicadas.');
      dados.conferencia = null; estado = 'EM_CONFERENCIA';
    } else if (entrada.acao === 'RESOLVER_PENDENCIA') {
      objeto(body, ['pendenciaId', 'resolucao', 'evidencia']);
      const p = dados.pendencias.find(p => p.id === identificador(body.pendenciaId));
      if (!p || p.resolvida) throw fail(409, 'Pendência inexistente ou já resolvida.');
      Object.assign(p, { resolvida: true, resolucao: texto(body.resolucao), evidencia: evidencia(body.evidencia), ...audit });
      dados.conferencia = null; estado = 'EM_CONFERENCIA';
    } else if (entrada.acao === 'CONFERIR_LOCAL') {
      objeto(body, ['documentosConferidos', 'motivo', 'evidencia']);
      if (body.documentosConferidos !== true || pendencias(dados, ctx, snapshot).length || (atual && hash(atual.contextoSnapshot) !== hash(snapshot))) throw fail(409, 'Conferência bloqueada: cobertura, documentos, cadastro ou pendências incompletos.');
      if (estado === 'CONFERIDA_LOCAL') throw fail(409, 'Esta base já foi conferida localmente.');
      dados.conferencia = { documentosConferidos: true, motivo: texto(body.motivo), evidencia: evidencia(body.evidencia), ...audit, natureza: 'CONFERENCIA_HUMANA_LOCAL', confirmacaoOficial: false };
      estado = 'CONFERIDA_LOCAL';
    } else if (entrada.acao === 'REGISTRAR_GUIA') {
      objeto(body, ['referencia', 'valorCentavos', 'vencimento', 'evidencia']);
      const guia = { referencia: texto(body.referencia, 200), valorCentavos: centavosExatos(body.valorCentavos, true), vencimento: dataCivil(body.vencimento), evidencia: evidencia(body.evidencia),
        origem: 'MANUAL_DOCUMENTO_OFICIAL_DECLARADO', emissaoOficialConfirmada: false, cancelada: false, ...audit };
      const documento = await reservarDocumento(tx, grupo, ctx, 'GUIA', guia.referencia, usuario);
      dados.guias.push({ id: documento.id, ...guia });
    } else if (entrada.acao === 'REGISTRAR_PAGAMENTO') {
      objeto(body, ['referencia', 'valorCentavos', 'data', 'tipo', 'evidencia']);
      if (!['PAGAMENTO_MANUAL', 'EXTINCAO_MANUAL'].includes(body.tipo)) throw fail(400, 'Informe pagamento ou extinção declarada manualmente.');
      const pagamento = { referencia: texto(body.referencia, 200), valorCentavos: centavosExatos(body.valorCentavos, true), data: dataCivil(body.data), tipo: body.tipo,
        evidencia: evidencia(body.evidencia), origem: 'DECLARADA_MANUAL', confirmacaoOficial: false, cancelado: false, ...audit };
      // A mesma referência não pode reaparecer como outra espécie de extinção.
      const documento = await reservarDocumento(tx, grupo, ctx, 'PAGAMENTO', pagamento.referencia, usuario);
      dados.pagamentos.push({ id: documento.id, ...pagamento });
    } else if (entrada.acao === 'ALOCAR') {
      objeto(body, ['pagamentoId', 'guiaId', 'valorCentavos']);
      const valor = BigInt(centavosExatos(body.valorCentavos, true)), atualizados = totais(dados);
      const g = atualizados.guias.find(g => g.id === identificador(body.guiaId)), p = atualizados.pagamentos.find(p => p.id === identificador(body.pagamentoId));
      if (!g || !p || g.cancelada || p.cancelado) throw fail(409, 'Guia ou pagamento fora deste mês ou cancelado.');
      if (valor > BigInt(g.saldoCentavos) || valor > BigInt(p.saldoCentavos)) throw fail(409, 'A alocação excede o saldo local da guia ou do pagamento.');
      dados.alocacoes.push({ id: randomUUID(), guiaId: g.id, pagamentoId: p.id, valorCentavos: String(valor), estornada: false, ...audit });
    } else if (entrada.acao === 'ESTORNAR_ALOCACAO') {
      objeto(body, ['alocacaoId', 'motivo', 'evidencia']);
      const alocacao = dados.alocacoes.find(a => a.id === identificador(body.alocacaoId));
      if (!alocacao || alocacao.estornada) throw fail(409, 'Alocação inexistente ou já estornada.');
      alocacao.estornada = true; alocacao.estorno = { motivo: texto(body.motivo), evidencia: evidencia(body.evidencia), ...audit };
    } else {
      const guia = entrada.acao === 'CANCELAR_GUIA', campo = guia ? 'guiaId' : 'pagamentoId';
      objeto(body, [campo, 'motivo', 'evidencia']);
      const alvo = (guia ? dados.guias : dados.pagamentos).find(item => item.id === identificador(body[campo]));
      if (!alvo || alvo.cancelada || alvo.cancelado || dados.alocacoes.some(a => !a.estornada && a[campo] === alvo.id)) throw fail(409, 'Registro ausente, cancelado ou com alocação ativa. Estorne as alocações primeiro.');
      alvo[guia ? 'cancelada' : 'cancelado'] = true;
      alvo.cancelamento = { motivo: texto(body.motivo), evidencia: evidencia(body.evidencia), ...audit };
    }
    if (dados.guias.length + dados.pagamentos.length + dados.alocacoes.length > 2000) throw fail(409, 'Limite local de registros por mês atingido.');
    // Ações financeiras não legitimam uma conferência antiga após mudança cadastral.
    const contextoSnapshot = entrada.acao === 'REGISTRAR_BASE' ? snapshot : atual?.contextoSnapshot || snapshot;
    const registro = await tx.apuracaoConsumoMesLocal.create({ data: { contribuinteId: grupo.id, ...ctx, versao: entrada.versao + 1,
      acao: entrada.acao, estado, dados, contextoSnapshot, comando: { acao: entrada.acao, dados: body, ...(entrada.contextoHash !== undefined ? { contextoHash: entrada.contextoHash } : {}) }, requestKey: entrada.id, requestHash, criadoPorId: String(usuario.id) } });
    return dto(ctx, loaded, registro);
  });
}
