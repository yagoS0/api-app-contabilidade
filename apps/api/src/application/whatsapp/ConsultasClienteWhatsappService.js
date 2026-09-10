import { normalizarConsulta, pedidoDeConsulta, periodoDaConsulta, numeroDaOpcao, mesAtualConsulta, deslocarMes, rotuloMesConsulta } from './consultaClienteWhatsapp.js';
import { criarPendencia } from '../assistente/AcoesPendentesService.js';
import { filtroAtendimentoAtivo } from './AtendimentoResponsavelWhatsappService.js';

const PREFIXO = 'altan.client.query.v1.';
const TTL = 30 * 60 * 1000;
const PAGINA = 8;
const mesDoVencimento = g => { const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(g.vencimento || ''); return p ? `${p[3]}-${p[2]}` : null; };
const mesmoTipo = (g, tipo) => !tipo || (tipo === 'SIMPLES' ? /simples|\bdas\b/.test(normalizarConsulta(`${g.tipoCodigo} ${g.tipo}`)) : normalizarConsulta(`${g.tipoCodigo} ${g.tipo}`).includes(normalizarConsulta(tipo)));

/** Lê somente a última saída. Uma pergunta nova, troca, atendimento humano ou emissão invalida opções anteriores. */
export async function resolverConsultaCliente({ texto, interacao, acaoMenu, registro, client, agora }) {
  const ultima = await client.mensagemWhatsapp.findFirst({ where: { conversaId: registro.conversa.id, direcao: 'out' }, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }] });
  const anterior = ultima?.autor === 'SISTEMA' && ['enviado', 'entregue', 'lido'].includes(ultima.statusEnvio) ? ultima.contextoConsulta : null;
  const valida = anterior?.schema === 1 && anterior.empresaId === registro.conversa.portalClientId
    && anterior.conversaId === registro.conversa.id && anterior.versao === (registro.contexto?.versao ?? null)
    && new Date(anterior.expiraEm) > agora && (!registro.conversa.automacaoInvalidadaEm || new Date(anterior.criadaEm) > new Date(registro.conversa.automacaoInvalidadaEm));
  const id = String(interacao?.id || '');
  if (id.startsWith(PREFIXO)) {
    const [token, ...resto] = id.slice(PREFIXO.length).split('.');
    return valida && token === anterior.token ? { acao: 'OPCAO', opcao: resto.join('.'), anterior } : { acao: 'EXPIRADA' };
  }
  if (acaoMenu && !['GUIAS_MES', 'RECALCULO', 'FATURAMENTO', 'ID_DESCONHECIDO'].includes(acaoMenu)) return null;
  if (id && !['GUIAS_MES', 'RECALCULO', 'FATURAMENTO'].includes(acaoMenu)) return null;
  const pedido = pedidoDeConsulta(texto, agora);
  const numero = numeroDaOpcao(texto), t = normalizarConsulta(texto).replace(/[.!?]+$/, '');
  if (valida && anterior.tipo === 'GUIAS' && !id) {
    if (numero) return { acao: 'OPCAO', opcao: `g${numero}`, anterior };
    if (/^(?:todas|todos|manda todas|mande todas|envie todas|enviar todas|quero todas|todas por favor)$/.test(t)) return { acao: 'OPCAO', opcao: 'todas', anterior };
    if (/^(?:mais|proxima|proximas|proxima pagina)$/.test(t)) return { acao: 'OPCAO', opcao: 'proxima', anterior };
    if (/^(?:a guia|o pdf|pdf|manda|pode mandar|pode enviar|envie|quero o pdf|me manda o pdf|essa|essa guia|aquela)$/.test(t) && anterior.guias.length === 1) return { acao: 'OPCAO', opcao: 'g1', anterior };
    // Aceita também a referência copiada de mensagens legadas, sem exigir esse vocabulário.
    if (pedido?.acao === 'GUIAS' && pedido.tipo) {
      const candidatas = anterior.guias.filter(g => mesmoTipo(g, pedido.tipo) && (!pedido.periodo || g.competencia === pedido.periodo.inicio || mesDoVencimento(g) === pedido.periodo.inicio));
      if (candidatas.length === 1) return { acao: 'OPCAO', opcao: `id:${candidatas[0].guideId}`, anterior };
    }
  }
  if (valida && anterior.tipo === 'PERIODO' && !id && (!pedido || pedido.acao === anterior.alvo)) {
    if (numero && anterior.opcoes?.[numero - 1]) return { acao: 'OPCAO', opcao: anterior.opcoes[numero - 1], anterior };
    const periodo = periodoDaConsulta(texto, agora);
    if (periodo) return { acao: anterior.alvo, periodo };
    if (numero) return { acao: anterior.alvo, periodo: null };
  }
  if (pedido) return pedido;
  if (acaoMenu === 'GUIAS_MES') return { acao: 'GUIAS', periodo: { inicio: mesAtualConsulta(agora), fim: mesAtualConsulta(agora) }, vencimento: true };
  if (acaoMenu === 'RECALCULO') return { acao: 'GUIAS', recalculo: true };
  if (acaoMenu === 'FATURAMENTO') return { acao: 'FATURAMENTO' };
  if (anterior && numero) return { acao: 'EXPIRADA' };
  return null;
}

export async function atenderConsultaCliente({ pedido, registro, sessao, agora, executar, client, cloud, enviar, antesDeEnviar, permitida, vincularOpcoes, rotular }) {
  const { conversa, mensagem } = registro;
  const contexto = dados => ({ ...dados, schema: 1, token: mensagem.id, empresaId: conversa.portalClientId, conversaId: conversa.id,
    versao: registro.contexto?.versao ?? null, criadaEm: agora.toISOString(), expiraEm: new Date(+agora + TTL).toISOString() });
  const texto = async (corpo, meta, ferramenta = null, idTurno) => enviar({ corpo: rotular(corpo), contextoConsulta: meta, ferramenta, ...(idTurno ? { idTurno } : {}),
    chamada: () => cloud.enviarTexto({ telefone: conversa.telefoneE164, texto: rotular(corpo) }) });
  const opcoes = async (corpo, itens, meta, ferramenta) => {
    if (rotular(corpo).length > 1024) {
      await texto(`${corpo}${itens.some(o => o.chave === 'proxima') ? '\nEscreva “mais” para continuar a lista.' : ''}`, meta, ferramenta);
      return;
    }
    const lista = vincularOpcoes(itens.map(o => ({ ...o, id: `${PREFIXO}${meta.token}.${o.chave}` })));
    await enviar({ corpo: rotular(corpo), contextoConsulta: meta, ferramenta, tipo: 'interactive', chamada: () => lista.length <= 3
      ? cloud.enviarBotoes({ telefone: conversa.telefoneE164, texto: rotular(corpo), botoes: lista.map(o => ({ ...o, titulo: o.titulo.slice(0, 20) })) })
      : cloud.enviarLista({ telefone: conversa.telefoneE164, texto: rotular(corpo), tituloBotao: 'Escolher', tituloSecao: 'Opções', linhas: lista.map(o => ({ ...o, titulo: o.titulo.slice(0, 24), descricao: o.descricao?.slice(0, 72) })) }) });
  };
  const chamar = async (nome, input, extra = {}) => {
    if (!permitida(nome)) return { ok: false, mensagem: 'Seu acesso a essa informação pelo WhatsApp precisa ser liberado pela equipe.' };
    await antesDeEnviar(nome);
    return executar(nome, input, { sessao, conversa, prisma: client, agora, janela: { aberta: true },
      ...(nome === 'preparar_recalculo' ? { servicos: { criarPendencia: async args => {
        await antesDeEnviar(nome);
        return client.$transaction(async tx => {
          if (conversa.atendimentoId) {
            const ativo = await tx.atendimentoResponsavelWhatsapp.updateMany({ where: filtroAtendimentoAtivo({ conversa, contexto: registro.contexto, mensagem, agora: new Date() }), data: { updatedAt: new Date() } });
            if (!ativo.count) throw Object.assign(new Error('A empresa mudou antes da preparação.'), { codigo: 'CONTEXTO_ALTERADO' });
          }
          const ativa = await tx.conversaWhatsapp.updateMany({ where: { id: conversa.id, portalClientId: conversa.portalClientId, escopoVerificado: true,
            excluidaEm: null, atendidaPor: null, atendidaDesde: null, OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: mensagem.registradaEm } }] }, data: { updatedAt: new Date() } });
          if (!ativa.count) throw Object.assign(new Error('O atendimento mudou antes da preparação.'), { codigo: 'AUTOMACAO_INVALIDADA' });
          return criarPendencia({ ...args, contexto: registro.contexto, client: tx });
        });
      } } } : {}), ...extra });
  };
  const perguntarPeriodo = async (alvo, aviso = '') => {
    const mes = mesAtualConsulta(agora), op = [`mes.${mes}`, `mes.${deslocarMes(mes, -1)}`, 'outro'];
    await opcoes(`${aviso}Qual mês você quer consultar? Pode escolher abaixo ou escrever, por exemplo, “agosto de ${mes.slice(0, 4)}”.`,
      [{ chave: op[0], titulo: 'Este mês' }, { chave: op[1], titulo: 'Mês passado' }, { chave: 'outro', titulo: 'Outro mês ou ano' }],
      contexto({ tipo: 'PERIODO', alvo, opcoes: op, aguardando: true }), alvo === 'FATURAMENTO' ? 'consultar_faturamento' : 'listar_guias');
  };
  const resumoGuia = g => `${(g.tipo || 'Guia').slice(0, 32)} · ${g.valorFormatado || 'valor não informado'} · vence ${g.vencimento || 'data não informada'}`;
  // Um filtro por tipo não pode declarar ausência só porque a primeira página não o contém.
  const completarPagina = async (dados, minimo) => {
    const d = { ...dados, guias: [...dados.guias] };
    for (let n = 0; d.proximaPagina && d.guias.length < minimo && n < 10; n++) {
      const r = await chamar('listar_guias', { ...d.filtro, pagina: d.proximaPagina });
      if (!r.ok) return { ...d, erro: r.mensagem || 'Não consegui consultar as próximas guias agora.' };
      d.guias.push(...(r.guias || []).filter(g => g.guideId && mesmoTipo(g, d.tipoFiltro)));
      d.proximaPagina = r.proximaPagina;
    }
    return d;
  };
  const mostrarGuias = async (dados, aviso = '') => {
    const meta = contexto({ ...dados, tipo: 'GUIAS' });
    const visiveis = meta.guias.slice(meta.offset || 0, (meta.offset || 0) + PAGINA);
    const linhas = visiveis.map((g, i) => `${i + 1}. ${resumoGuia(g)}`);
    const itens = visiveis.map((g, i) => ({ chave: `g${i + 1}`, titulo: `${i + 1}. ${g.tipo || 'Guia'}`, descricao: `${g.valorFormatado} · vence ${g.vencimento}` }));
    if ((meta.offset || 0) + PAGINA < meta.guias.length || meta.proximaPagina) itens.push({ chave: 'proxima', titulo: 'Ver mais guias' });
    if (!meta.recalculo && visiveis.length > 1) itens.push({ chave: 'todas', titulo: 'Receber estas guias' });
    await opcoes(`${aviso}${!visiveis.length ? 'Ainda há páginas para consultar. Toque em “Ver mais guias” para continuar.' : `${meta.recalculo ? 'Qual guia você quer atualizar?' : 'Qual guia você quer receber?'}\n${linhas.join('\n')}\n\nToque na opção ou responda com o número.${!meta.recalculo && visiveis.length > 1 ? ' Escreva “todas” para receber esta lista.' : ''}`}`, itens, meta, meta.recalculo ? 'preparar_recalculo' : 'enviar_pdf_da_guia');
  };
  const enviarGuia = async (guia, meta, idTurno = `menu:${mensagem.id}`) => {
    const ferramenta = meta.recalculo ? 'preparar_recalculo' : 'enviar_pdf_da_guia';
    if (meta.recalculo) {
      const r = await chamar(ferramenta, { guideId: guia.guideId });
      await texto(r.texto || r.textoDeConfirmacao || r.mensagem || 'Não consegui preparar a atualização dessa guia. A equipe pode conferir.', undefined, ferramenta);
      return;
    }
    // Cada PDF do pedido tem seu recibo. Uma reentrega não repete arquivos já aceitos.
    const anterior = await client.mensagemWhatsapp.findFirst({ where: { conversaId: conversa.id, direcao: 'out', turnoIaId: idTurno } });
    if (anterior) return ['enviado', 'entregue', 'lido'].includes(anterior.statusEnvio) && anterior.tipo === 'document';
    const r = await chamar(ferramenta, { guideId: guia.guideId }, { enviarDocumento: async ({ conteudo, nomeArquivo, legenda, mimeType }) => enviar({
      tipo: 'document', corpo: rotular(legenda || nomeArquivo), contextoConsulta: contexto(meta), ferramenta, idTurno,
      chamada: () => cloud.enviarDocumento({ telefone: conversa.telefoneE164, conteudo, nomeArquivo, legenda: rotular(legenda || nomeArquivo), mimeType }),
    }) });
    if (!r.ok) await texto(r.mensagem || 'Não consegui enviar esse PDF agora. A equipe pode conferir o arquivo.', undefined, ferramenta, idTurno);
    return r.ok && r.enviado === true;
  };

  if (pedido.acao === 'EXPIRADA') { await texto('Essa lista é de um atendimento anterior. Escreva “guias” ou “faturamento” para consultar as opções atuais.'); return; }
  if (pedido.acao === 'OPCAO') {
    const a = pedido.anterior, op = pedido.opcao;
    if (a.tipo === 'PERIODO') {
      if (op === 'outro') { const ano = mesAtualConsulta(agora).slice(0, 4); await texto(`Qual mês ou ano você quer ver? Pode escrever “agosto de ${ano}” ou “${ano}”.`, contexto({ tipo: 'PERIODO', alvo: a.alvo, aguardando: true })); return; }
      if (/^mes\.\d{4}-\d{2}$/.test(op) && a.opcoes?.includes(op)) pedido = { acao: a.alvo, periodo: { inicio: op.slice(4), fim: op.slice(4) } };
      else { await perguntarPeriodo(a.alvo); return; }
    } else if (a.tipo === 'GUIAS') {
      if (op === 'proxima') {
        const offset = Math.min((a.offset || 0) + PAGINA, a.guias.length);
        const dados = await completarPagina(a, offset + PAGINA + 1);
        if (dados.erro) { await texto(dados.erro); return; }
        if (!dados.guias.length && !dados.proximaPagina) { await texto('Não encontrei uma guia liberada com esse filtro. A equipe pode conferir se falta liberar algum arquivo.'); return; }
        await mostrarGuias({ ...dados, offset: offset < dados.guias.length ? offset : 0 }); return;
      }
      const n = /^g([1-9]\d?)$/.exec(op), visiveis = a.guias.slice(a.offset || 0, (a.offset || 0) + PAGINA);
      const escolhida = n ? visiveis[+n[1] - 1] : op.startsWith('id:') ? a.guias.find(g => g.guideId === op.slice(3)) : null;
      if (op === 'todas' && !a.recalculo) {
        let enviadas = 0;
        for (const g of visiveis) if (await enviarGuia(g, a, `menu:${mensagem.id}:guia:${g.guideId}`)) enviadas++;
        await texto(enviadas === visiveis.length ? `Enviei as ${enviadas} guias desta lista em PDF.` : `Consegui enviar ${enviadas} de ${visiveis.length} guias desta lista. A equipe precisa conferir os arquivos que ficaram pendentes.`, contexto(a)); return;
      }
      if (escolhida) { await enviarGuia(escolhida, a); return; }
      await mostrarGuias(a, 'Não encontrei essa opção. '); return;
    }
  }
  if (pedido.acao === 'FATURAMENTO') {
    if (!permitida('consultar_faturamento')) { await texto('Seu acesso ao faturamento pelo WhatsApp precisa ser liberado pela equipe.'); return; }
    if (!pedido.periodo || pedido.periodo.invalido) { await perguntarPeriodo('FATURAMENTO', pedido.periodo?.invalido ? 'Não reconheci esse mês. ' : ''); return; }
    const r = await chamar('consultar_faturamento', pedido.periodo);
    if (!r.ok) { await texto(r.mensagem); return; }
    const periodo = r.inicio === r.fim ? rotuloMesConsulta(r.inicio) : `${rotuloMesConsulta(r.inicio)} a ${rotuloMesConsulta(r.fim)}`;
    const corpo = !r.quantidade ? `Ainda não encontrei notas emitidas autorizadas registradas para ${periodo}. Isso não confirma que a empresa ficou sem faturamento; a equipe pode conferir se falta algum registro.`
      : r.semValor ? `Há ${r.quantidade} notas registradas para ${periodo}, mas faltam valores em ${r.semValor}. A equipe precisa conferir antes de eu informar o total.`
        : `O faturamento registrado em ${periodo} é de ${r.totalFormatado}, referente a ${r.quantidade} ${r.quantidade === 1 ? 'nota emitida autorizada' : 'notas emitidas autorizadas'}.\n\nEsse valor vem das notas disponíveis no sistema; não é o saldo nem o valor recebido no banco.`;
    await texto(corpo, contexto({ tipo: 'PERIODO', alvo: 'FATURAMENTO' }), 'consultar_faturamento'); return;
  }
  if (pedido.acao === 'GUIAS') {
    const ferramenta = pedido.recalculo ? 'preparar_recalculo' : 'enviar_pdf_da_guia';
    if (!permitida(ferramenta)) { await texto('Seu acesso às guias pelo WhatsApp precisa ser liberado pela equipe.'); return; }
    if (pedido.periodo?.invalido || (pedido.periodo && pedido.periodo.inicio !== pedido.periodo.fim)) { await perguntarPeriodo('GUIAS', 'Para localizar a guia, preciso saber o mês. '); return; }
    const t = normalizarConsulta(registro.mensagem.corpo), porVencimento = pedido.vencimento || /\bvenc|\b(?:do mes|deste mes|desse mes|este mes|esse mes)\b/.test(t);
    const historico = pedido.pagas || (pedido.periodo && !porVencimento && !pedido.recalculo);
    const filtro = historico ? { ...(pedido.periodo ? { competencia: pedido.periodo.inicio } : {}), ...(pedido.pagas ? { status: 'PAID' } : {}) } : null;
    const r = await chamar(historico ? 'listar_guias' : 'quanto_devo', filtro || {});
    if (!r.ok) { await texto(r.mensagem || 'Não consegui consultar as guias agora.'); return; }
    let guias = (r.guias || []).filter(g => g.guideId && mesmoTipo(g, pedido.tipo));
    if (pedido.recalculo || pedido.vencidas) guias = guias.filter(g => g.vencida);
    else if (!historico && !pedido.todas) { const mes = pedido.periodo?.inicio || mesAtualConsulta(agora); guias = guias.filter(g => mesDoVencimento(g) === mes); }
    const dados = await completarPagina({ guias, filtro, tipoFiltro: pedido.tipo, proximaPagina: historico ? r.proximaPagina : null }, PAGINA + 1);
    if (dados.erro) { await texto(dados.erro); return; }
    if (!dados.guias.length && !dados.proximaPagina) { await texto(`Ainda não encontrei uma guia liberada${pedido.recalculo || pedido.vencidas ? ' vencida' : pedido.periodo ? ` para ${rotuloMesConsulta(pedido.periodo.inicio)}` : ' para pagar neste mês'}. A equipe pode conferir se falta liberar algum arquivo.`, contexto({ tipo: 'PERIODO', alvo: 'GUIAS' })); return; }
    const meta = contexto({ ...dados, tipo: 'GUIAS', offset: 0, recalculo: Boolean(pedido.recalculo) });
    if (meta.guias.length === 1 && !meta.proximaPagina) { await enviarGuia(meta.guias[0], meta); return; }
    await mostrarGuias(meta); return;
  }
}
