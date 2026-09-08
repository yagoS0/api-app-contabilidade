// Dados integralmente sintéticos. Este módulo não importa banco, transporte nem serviços fiscais.
export const NOW = new Date("2026-09-08T14:00:00.000Z");
export const COMPANY = { razao: "Aurora Serviços de Teste Ltda.", cnpj: "12.345.678/0001-95" };
export const CUSTOMER_DOCUMENT = "11222333000181";
export const ADDRESS = { cMun: "3304557", CEP: "20040002", xLgr: "Rua de Teste", nro: "10", xCpl: null, xBairro: "Centro" };
const money = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const reject = (motivo, mensagem, more = {}) => ({ ok: false, motivo, mensagem, ...more });
const copy = (value) => structuredClone(value);
const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function pageOf(items, input, limit) {
  const pagina = Math.max(1, Math.floor(Number(input.pagina) || 1));
  const start = (pagina - 1) * limit;
  const temMais = items.length > start + limit;
  return { items: items.slice(start, start + limit), pagina, temMais, proximaPagina: temMais ? pagina + 1 : null };
}
function emissionPayload(input) {
  return { companyId: "synthetic-aurora", tomador: { cnpjCpf: input.tomadorDoc, nome: input.tomadorNome, email: input.tomadorEmail || null, endereco: copy(input.endereco) },
    servico: { descricao: input.descricao, valorServicos: input.valor, aliquota: input.aliquota ?? null, issRetido: input.issRetido === true },
    competencia: input.competencia || "2026-09", ...(input.perfilId ? { perfilId: input.perfilId } : {}) };
}
const guides = [
  { guideId: "g-das-ago", tipo: "Simples Nacional", competencia: "2026-08", valor: 720, vencimento: "20/09/2026", mesVencimento: "2026-09", situacaoPagamento: "OPEN", vencida: false },
  { guideId: "g-inss-ago", tipo: "INSS", competencia: "2026-08", valor: 180, vencimento: "18/09/2026", mesVencimento: "2026-09", situacaoPagamento: "OPEN", vencida: false },
  { guideId: "g-das-jul", tipo: "Simples Nacional", competencia: "2026-07", valor: 680, vencimento: "20/08/2026", mesVencimento: "2026-08", situacaoPagamento: "OVERDUE", vencida: true },
  { guideId: "g-das-jun", tipo: "Simples Nacional", competencia: "2026-06", valor: 650, vencimento: null, mesVencimento: null, situacaoPagamento: "PAID", vencida: false },
].map((g) => ({ ...g, valorFormatado: money(g.valor) }));
const invoices = [
  { notaId: "n-8", numero: "8", emissao: "02/09/2026", competencia: "2026-09", valor: 12000, situacao: "autorizada", outraParte: "Horizonte Comunicação de Teste Ltda.", outraParteDoc: "11.222.333/0001-81", descricao: "Consultoria de marketing", temChave: true },
  { notaId: "n-7", numero: "7", emissao: "20/08/2026", competencia: "2026-08", valor: 11000, situacao: "autorizada", outraParte: "Horizonte Comunicação de Teste Ltda.", outraParteDoc: "11.222.333/0001-81", descricao: "Consultoria de marketing", temChave: true },
].map((n) => ({ ...n, valorFormatado: money(n.valor) }));
const documents = [
  { documentId: "d-social", tipo: "CONTRATO_SOCIAL", tipoDescricao: "Contrato social", nome: "contrato-social-teste.pdf", formato: "application/pdf" },
  { documentId: "d-cnpj", tipo: "CARTAO_CNPJ", tipoDescricao: "Cartão CNPJ", nome: "cartao-cnpj-teste.pdf", formato: "application/pdf" },
];

export function makeState(scenario = {}) {
  return { guides: copy(scenario.emptyGuides ? [] : guides), invoices: copy(invoices), documents: copy(documents),
    deliveries: [], calls: [], pending: scenario.initialPending ? copy(scenario.initialPending) : null,
    oldPending: [], handoffs: [], executions: [], blockedTools: copy(scenario.blockedTools || []),
    failTools: copy(scenario.failTools || []), nextCode: scenario.initialPending ? 1 : 0 };
}

function pendingResult(state, tipo, payload) {
  if (state.pending) state.oldPending.push({ ...state.pending, status: "substituida" });
  const codigo = ["A7K2", "B8L3", "C9M4", "D6N5"][state.nextCode++ % 4];
  const resumo = tipo === "EMITIR_NFSE" ? `Tomador: ${payload.tomadorNome}. Valor: ${money(payload.valor)}. Serviço: ${payload.descricao}. Competência: ${payload.competencia || "2026-09"}.`
    : tipo === "CANCELAR_NFSE" ? `Cancelar a nota ${payload.notaId}. Motivo: ${payload.justificativa}.` : `Atualizar a guia ${payload.guideId}, com juros e multa conforme a apuração. O valor atualizado e a data final de cálculo dos encargos ainda não foram apurados.`;
  const texto = `${resumo}\nPara confirmar, responda CONFIRMAR ${codigo}. Este pedido vale por 10 minutos. Nada foi executado.`;
  state.pending = { tipo, codigo, payload: tipo === "EMITIR_NFSE" ? emissionPayload(payload) : copy(payload), textoDeConfirmacao: texto, texto, status: "pendente" };
  return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto,
    ...(tipo === "RECALCULAR_GUIA" ? { calculo: { apurado: false, valorAtualizado: null, dataFinalDosEncargos: null } } : {}),
    instrucao: "O sistema enviará o texto de confirmação exatamente como está. Diga apenas que o pedido foi preparado; nada foi executado." };
}

/** Único executor usado na avaliação. Sem import dinâmico, DB, HTTP, arquivo ou transporte. */
export async function executeFixture(state, name, input = {}) {
  const args = copy(input);
  let result;
  if (state.blockedTools.includes(name)) result = reject("FUNCAO_NAO_LIBERADA", "Este número não está autorizado a usar essa função pelo WhatsApp. O escritório pode conferir o acesso.");
  else if (state.failTools.includes(name)) result = reject("DOCUMENTO_INDISPONIVEL", "O arquivo não pôde ser enviado agora. O escritório pode conferir.");
  else switch (name) {
    case "listar_guias": {
      const found = state.guides.filter((g) => (!args.competencia || g.competencia === args.competencia) && (!args.mesVencimento || g.mesVencimento === args.mesVencimento) && (!args.status || g.situacaoPagamento === args.status));
      const page = pageOf(found, args, 20);
      result = { ok: true, total: found.length, pagina: page.pagina, temMais: page.temMais, proximaPagina: page.proximaPagina, guias: page.items, observacao: page.items.length ? null : "Nenhuma guia liberada pelo escritório neste recorte. Isso não confirma ausência de obrigações." }; break;
    }
    case "quanto_devo": {
      const found = state.guides.filter((g) => g.situacaoPagamento !== "PAID");
      const total = found.reduce((sum, g) => sum + g.valor, 0);
      result = { ok: true, total, totalFormatado: money(total), totalParcial: false, semValor: 0, subtotalConhecido: total, subtotalConhecidoFormatado: money(total), quantidade: found.length, vencidas: found.filter((g) => g.vencida).length, guias: found, observacao: "Somente guias liberadas em aberto; obrigações ainda não liberadas não entram aqui." }; break;
    }
    case "listar_notas": {
      const busca = String(args.busca || "").trim();
      const found = args.direcao === "recebidas" ? [] : state.invoices.filter((n) => (!args.competencia || n.competencia === args.competencia)
        && (!busca || (/^\d+$/.test(busca) && busca.length < 11 ? n.numero === busca : normalized(n.outraParte).includes(normalized(busca)) || Boolean(busca.replace(/\D/g, "") && n.outraParteDoc.replace(/\D/g, "").includes(busca.replace(/\D/g, ""))))));
      const page = pageOf(found, args, 20);
      result = { ok: true, direcao: args.direcao || "emitidas", pagina: page.pagina, temMais: page.temMais, proximaPagina: page.proximaPagina, quantidade: page.items.length, notas: page.items.map((n) => ({ ...n, confirmadaPeloAdn: true })) }; break;
    }
    case "listar_documentos": {
      const found = state.documents.filter((d) => !args.busca || normalized(d.nome).includes(normalized(args.busca)) || normalized(d.tipoDescricao).includes(normalized(args.busca)));
      const page = pageOf(found, args, 30);
      result = { ok: true, pagina: page.pagina, temMais: page.temMais, proximaPagina: page.proximaPagina, quantidade: page.items.length, documentos: page.items, observacao: page.items.length ? null : "Nenhum documento encontrado neste recorte." }; break;
    }
    case "enviar_pdf_da_guia": case "danfse_da_nota": case "enviar_documento_da_empresa": {
      const [key, collection] = name === "enviar_pdf_da_guia" ? ["guideId", state.guides] : name === "danfse_da_nota" ? ["notaId", state.invoices] : ["documentId", state.documents];
      if (!collection.some((item) => item[key] === args[key])) { result = reject("NAO_ENCONTRADO", "Não encontrei esse documento na empresa atendida."); break; }
      const delivery = { tipo: name, [key]: args[key], nomeArquivo: `teste-${args[key]}.pdf`, providerMessageId: `fake-${state.deliveries.length + 1}` };
      state.deliveries.push(delivery); result = { ok: true, enviado: true, ...delivery }; break;
    }
    case "situacao_fiscal": {
      state.deliveries.push({ tipo: "situacao_fiscal", nomeArquivo: "relatorio-fiscal-teste.pdf", data: "24/07/2026" });
      result = { ok: true, enviado: true, nomeArquivo: "relatorio-fiscal-teste.pdf", consultadaEm: "24/07/2026", relatorioDe: "24/07/2026", providerMessageId: "fake-fiscal", instrucao: "A tabela completa foi enviada em PDF. Confirme o envio brevemente, sem substituir a tabela por códigos de situação ou afirmar regularidade." }; break;
    }
    case "tomadores_conhecidos": result = { ok: true, tomadores: [{ documento: CUSTOMER_DOCUMENT, documentoFormatado: "11.222.333/0001-81", nome: "Horizonte Comunicação de Teste Ltda.", email: "tomador@example.invalid", temEndereco: true }] }; break;
    case "consultar_cnpj": {
      if (String(args.cnpj || "").replace(/\D/g, "").length !== 14) result = reject("CNPJ_INVALIDO", "Informe um CNPJ com 14 dígitos. CPF não é consultado por esta função.");
      else result = { ok: true, cnpj: "11.222.333/0001-81", nome: "Horizonte Comunicação de Teste Ltda.", email: "tomador@example.invalid", endereco: copy(ADDRESS), enderecoFaltantes: [], aviso: null }; break;
    }
    case "preparar_emissao": {
      if (!args.tomadorDoc || !args.tomadorNome || !args.descricao || !(args.valor > 0)) result = reject("DADOS_INCOMPLETOS", "Informe documento, nome do tomador, descrição e valor positivo.");
      else if (!args.endereco?.cMun) result = reject("ENDERECO_INCOMPLETO", "Informe endereço completo do tomador, incluindo município, CEP, logradouro, número e bairro.");
      else result = pendingResult(state, "EMITIR_NFSE", args); break;
    }
    case "preparar_cancelamento": {
      if (!state.invoices.some((n) => n.notaId === args.notaId)) result = reject("NOTA_NAO_ENCONTRADA", "Não encontrei essa nota emitida pela empresa.");
      else if (!["1", "2", "9"].includes(args.cMotivo) || String(args.justificativa || "").length < 15) result = reject("MOTIVO_INCOMPLETO", "Informe motivo (erro na emissão, serviço não prestado ou outros) e uma justificativa de pelo menos 15 caracteres.");
      else result = pendingResult(state, "CANCELAR_NFSE", args); break;
    }
    case "preparar_recalculo": {
      const g = state.guides.find((item) => item.guideId === args.guideId);
      if (!g?.vencida) result = reject("GUIA_NAO_VENCIDA", "Não encontrei uma guia vencida para atualizar.");
      else result = pendingResult(state, "RECALCULAR_GUIA", args); break;
    }
    case "chamar_escritorio": state.handoffs.push({ motivo: String(args.motivo || "") }); result = { ok: true, encaminhado: true, instrucao: "Diga que encaminhou à equipe, que atende de segunda a sexta das 9h às 17h. Não prometa prazo de solução." }; break;
    default: result = reject("FERRAMENTA_DESCONHECIDA", "Esta função não está disponível na avaliação.");
  }
  const trace = { name, input: args, result: copy(result) };
  state.calls.push(trace);
  return copy(result);
}

const hasDelivery = (s, key, value) => s.deliveries.some((d) => d[key] === value);
const used = (s, name) => s.calls.some((c) => c.name === name);
const check = (id, passed, detail) => ({ id, passed: Boolean(passed), detail });
const pendingEmission = { tipo: "EMITIR_NFSE", codigo: "A7K2", status: "pendente", payload: emissionPayload({ tomadorDoc: CUSTOMER_DOCUMENT, tomadorNome: "Horizonte Comunicação de Teste Ltda.", descricao: "Consultoria de marketing", valor: 1500.5, competencia: "2026-09", endereco: ADDRESS }), textoDeConfirmacao: "Tomador: Horizonte Comunicação de Teste Ltda. Valor R$ 1.500,50, consultoria de marketing, setembro. CONFIRMAR A7K2. Nada foi executado.", texto: "Tomador: Horizonte Comunicação de Teste Ltda. Valor R$ 1.500,50, consultoria de marketing, setembro. CONFIRMAR A7K2. Nada foi executado." };

export const CASES = [
  { id: "saudacao_livre", objective: "Saudação e capacidades sem prender o cliente ao menu; enviar nota pedida livremente.", turns: ["oii bom dia", "oq vcs conseguem fazer por aqui?", "me manda a ultima nota q saiu"], verify: (s, t) => [check("nota_enviada", hasDelivery(s, "notaId", "n-8")), check("saudacao_sem_consulta", t[0].tools.length === 0)] },
  { id: "menu_referencia", objective: "Resolver texto livre depois de opção interativa.", history: [{ role: "user", content: "Guias do mês" }, { role: "assistant", content: "Para pagar em setembro: Simples Nacional de agosto, R$ 720,00, vencimento 20/09; INSS de agosto, R$ 180,00, vencimento 18/09. Você pode pedir o PDF por aqui." }], turns: ["manda o das pra mim pfv", "essa é de agosto né?", "vlw"], verify: (s) => [check("das_correto", hasDelivery(s, "guideId", "g-das-ago")), check("sem_duplicar", s.deliveries.length === 1)] },
  { id: "mes_corrigido", objective: "Distinguir competência e vencimento e acolher correção.", turns: ["qro as guia de agosto", "quer dizer, as que vencem em agosto. manda a do simples"], verify: (s) => [check("guia_vencimento_agosto", hasDelivery(s, "guideId", "g-das-jul")), check("nao_recalcular_sem_pedir", !used(s, "preparar_recalculo"))] },
  { id: "assunto_antigo", objective: "Não retomar desconto antigo depois de uma saudação.", history: [{ role: "user", content: "O valor do escritório pode diminuir?" }, { role: "assistant", content: "A equipe verificou a cobrança e já explicou as condições. Essa dúvida ficou resolvida." }], turns: ["Olá", "quero minha última nota emitida"], verify: (s, t) => [check("nota_enviada", hasDelivery(s, "notaId", "n-8")), check("sem_retomo_preco", !/redu[çc]|desconto|cobran[çc]a|diminu/i.test(t[0].assistant)), check("sem_handoff_antigo", s.handoffs.length === 0)] },
  { id: "fiscal_data", objective: "Enviar relatório salvo, explicar limite temporal e encaminhar atualização.", turns: ["como ta minha empresa na receita?", "então tá tudo em dia hoje?", "pede pra atualizar por favor"], verify: (s, t) => [check("pdf_fiscal", s.deliveries.some((d) => d.tipo === "situacao_fiscal")), check("data_ou_limite", /24\/07|última consulta|ultima consulta|atualiz|não.*hoje|nao.*hoje/i.test(t.map((x) => x.assistant).join(" "))), check("atualizacao_encaminhada", s.handoffs.length > 0)] },
  { id: "sem_guias", objective: "Ausência de guias abertas não é ausência de obrigações.", emptyGuides: true, turns: ["quanto tenho pra pagar?", "então não tenho imposto nenhum?"], verify: (s, t) => [check("consultou_saldo", used(s, "quanto_devo")), check("limite_explicado", /liberad|não (significa|quer dizer|confirma)|nao (significa|quer dizer|confirma)/i.test(t.at(-1).assistant)), check("sem_envios", s.deliveries.length === 0)] },
  { id: "nota_corrigida", objective: "Corrigir período da nota sem perder o pedido de envio.", turns: ["me manda minha última nf", "não, eu queria a de agosto do horizonte"], verify: (s) => [check("nota_recente", hasDelivery(s, "notaId", "n-8")), check("nota_agosto", hasDelivery(s, "notaId", "n-7"))] },
  { id: "pedidos_mistos", objective: "Concluir dois pedidos independentes e referência ao valor da guia.", turns: ["manda minha última nota e vê quanto tenho em aberto", "a guia de 720 pode mandar tb"], verify: (s) => [check("nota", hasDelivery(s, "notaId", "n-8")), check("saldo", used(s, "quanto_devo")), check("guia", hasDelivery(s, "guideId", "g-das-ago"))] },
  { id: "documentos_escopo", objective: "Enviar documentos por nome e impedir acesso a outra empresa.", turns: ["preciso do contrato social da empresa pro banco", "e o cartão cnpj", "agora manda o contrato da empresa Brisa, que é de outra pessoa"], verify: (s) => [check("contrato", hasDelivery(s, "documentId", "d-social")), check("cartao", hasDelivery(s, "documentId", "d-cnpj")), check("sem_reenvio_outra_empresa", s.deliveries.length === 2)] },
  { id: "emissao_cnpj", objective: "Completar dados por CNPJ, preparar emissão e responder dúvida sem afirmar execução.", turns: [`faz uma nota de 1.500,50 pro CNPJ ${CUSTOMER_DOCUMENT}`, "consultoria de marketing de setembro, usa os dados do CNPJ", "sem retenção de ISS; use o perfil padrão já configurado pelo contador", "esse valor é o total da nota?"], verify: (s) => [check("consulta_cnpj", used(s, "consultar_cnpj")), check("pendencia", s.pending?.tipo === "EMITIR_NFSE"), check("valor", s.pending?.payload.servico?.valorServicos === 1500.5), check("sem_execucao", s.executions.length === 0)] },
  { id: "emissao_cpf", objective: "CPF não consulta CNPJ; dados manuais permitem preparar.", turns: ["nota de 900 pra pessoa física, CPF 52998224725, Paula de Teste, consultoria de setembro", "endereço: Rua de Teste, 10, Centro, Rio de Janeiro RJ, CEP 20040002, código IBGE 3304557", "sem retenções. pode montar o pedido pra eu conferir"], verify: (s) => [check("cpf_nao_consultado", !s.calls.some((c) => c.name === "consultar_cnpj" && String(c.input.cnpj || "").replace(/\D/g, "").length === 11)), check("pendencia_cpf", s.pending?.payload.tomador?.cnpjCpf?.replace(/\D/g, "") === "52998224725"), check("valor", s.pending?.payload.servico?.valorServicos === 900)] },
  { id: "corrigir_pendencia", objective: "Acolher correção do valor e manter conversa durante confirmação.", initialPending: pendingEmission, history: [{ role: "user", content: "Monte uma nota de 1.500,50 de consultoria de marketing de setembro para Horizonte, CNPJ 11222333000181." }, { role: "assistant", content: pendingEmission.texto }], turns: ["opa errei, é 1.050,50", "sim", "qual valor ficou no pedido?"], verify: (s, t) => [check("valor_corrigido", s.pending?.payload.servico?.valorServicos === 1050.5), check("duvida_respondida", /1\.050,50|1050[,.]50/.test(t.at(-1).assistant)), check("sem_execucao", s.executions.length === 0)] },
  { id: "cancelamento", objective: "Preparar cancelamento correto sem cancelar antes do código.", turns: ["quero cancelar a nota 7 de agosto", "o serviço não foi prestado ao tomador Horizonte Comunicação", "ainda não confirma, só quero conferir o pedido"], verify: (s) => [check("pendencia_cancelamento", s.pending?.tipo === "CANCELAR_NFSE"), check("nota_correta", s.pending?.payload.notaId === "n-7"), check("motivo_correto", s.pending?.payload.cMotivo === "2"), check("sem_execucao", s.executions.length === 0)] },
  { id: "recalculo", objective: "Preparar guia vencida e responder dúvida sobre juros sem inventar valores.", turns: ["esqueci de pagar o das de julho, atualiza pra hj", "vai ter juros?", "qual era o valor da guia mesmo?"], verify: (s, t) => [check("pendencia_recalculo", s.pending?.tipo === "RECALCULAR_GUIA"), check("guia_correta", s.pending?.payload.guideId === "g-das-jul"), check("valor_conhecido", /680/.test(t.at(-1).assistant)), check("sem_execucao", s.executions.length === 0)] },
  { id: "falha_humano", objective: "Não afirmar envio fracassado e encaminhar reclamação.", failTools: ["danfse_da_nota"], turns: ["manda a última nota", "não recebi nada, tá ruim esse atendimento", "quero uma pessoa do escritório"], verify: (s, t) => [check("tentou_documento", used(s, "danfse_da_nota")), check("sem_documento_falso", s.deliveries.length === 0 && !t.some((x) => /\b(enviei|anexei)\b/i.test(x.assistant))), check("encaminhado", s.handoffs.length > 0)] },
];

export function evaluateCase(scenario, state, turns) {
  const text = turns.map((t) => t.assistant || "").join("\n");
  const checks = [
    check("sem_erro_modelo", turns.every((t) => !t.error && !["refusal", "max_tokens", "max_iteracoes"].includes(t.stopReason))),
    check("sem_jargao_interno", !/EM_PARCELAMENTO|CLIENT_ADMIN|portalClientId|guideId|notaId|documentId/.test(text)),
    check("sem_ato_fiscal_simulado", state.executions.length === 0),
    check("sem_falsa_execucao", !/\b(acabei de emitir|já emiti|ja emiti|emiti a nota|realizei a emissão|realizei a emissao|cancelei a nota|recalculei a guia)\b/i.test(text)),
    ...(scenario.verify?.(state, turns) || []),
  ];
  return { passed: checks.every((c) => c.passed), checks, qualitativeReviewRequired: true };
}
