// AS FERRAMENTAS DO ASSISTENTE — 1:1 com as capacidades que o cliente JÁ tem nas rotas `/client`.
//
// Cada ferramenta = DEFINIÇÃO (o que o modelo vê: `name`, `description` em pt-BR, `input_schema`
// estrito) + EXECUTOR (o que roda aqui, com a SESSÃO do contato como escopo e como papel).
//
// ── ⚠⚠ AS TRÊS REGRAS QUE ESTE ARQUIVO NÃO PODE QUEBRAR ─────────────────────────────────────────
//   1. TODA consulta leva `sessao.portalClientId` no `where` (`portalClientId` / `clientId`). Nenhuma
//      ferramenta alcança outra empresa — travado por varredura de fonte em `escopoDoFio.test.js`.
//   2. O PAPEL é conferido pela MESMA tabela das rotas (`papelAlcanca`): FINANCEIRO lê guias/notas;
//      CLIENT_ADMIN+ vê a situação fiscal e prepara atos fiscais. Papel nulo não faz nada.
//   3. NENHUMA ferramenta pratica ato fiscal ou gasta chamada paga. `preparar_*` só grava uma
//      PENDÊNCIA (com o texto que o cliente vai confirmar); quem executa é a confirmação por
//      código, fora do modelo. Não existe ferramenta de SITFIS, de `forcar`, de liberar/revogar.
//
// ── ⚠ REUSO, NUNCA REIMPLEMENTAÇÃO ──────────────────────────────────────────────────────────────
// `listGuidesByCompany`/`toGuideResponse` (a lista do cliente), `getGuidePdfBuffer` (o PDF que o
// e-mail manda), `gerarDanfseDaNota` (o DANFSe do cliente), `listarTomadoresEmitidos`,
// `consultarCnpj` (F3), `validateNfsePayload` (o validador da emissão), `autorizarEmissaoDoCliente`
// (a decisão do portão), `canGuideRecalculate`/`isGuideOverdue`/`avisoDeRecalculo` (as travas do
// recálculo), `motivoValido`/`validarJustificativa` (a lista fechada do XSD). Os `servicos` são
// INJETÁVEIS: o teste passa dublês e mede a recusa por NÃO-CHAMADA.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { listGuidesByCompany, toGuideResponse, getGuidePdfBuffer, PUBLICO } from "../../guides/GuideService.js";
import { guideTypeEmailLabel } from "../../guides/guideEmailCopy.js";
import { isGuiaDeParcelamento } from "../../guides/guideContract.js";
import { gerarDanfseDaNota } from "../../nfse/danfse/danfseDaNotaDoPortal.js";
import { listarTomadoresEmitidos } from "../../nfse/tomadorEmitido.js";
import { consultarCnpj } from "../../tomador/consultaCnpj.js";
import { municipiosIbgeOuNulo } from "../../nfse/lote/municipiosIbge.js";
import { validateNfsePayload } from "../../validators/nfsePayload.js";
import { autorizarEmissaoDoCliente } from "../../nfse/autorizacaoEmissaoDoCliente.js";
import { canGuideRecalculate, isGuideOverdue, avisoDeRecalculo } from "../../guides/lib/recalculoDaGuia.js";
import { motivoValido, validarJustificativa, motivosDoEvento, JUSTIFICATIVA } from "../../nfse/motivosDeEvento.js";
import { parseSitfisRelatorio } from "../../fiscal/serpro/parseSitfisRelatorio.js";
import { resolveLegacyCompanyId } from "../../../routes/middlewares/portalAccess.js";
import { textoDeConfirmacao, fmtBRL, formatarDoc } from "@contabilidade/shared/declaracao-nfse";
import { papelAlcanca, PAPEL_MINIMO_LEITURA, PAPEL_MINIMO_SITUACAO_FISCAL, PAPEL_MINIMO_EMISSAO } from "../sessaoDoContato.js";
import { TIPOS } from "../confirmacaoPendente.js";
import { criarPendencia } from "../AcoesPendentesService.js";

/** As funções de fora, INJETÁVEIS. Produção usa os defaults; o teste passa dublês. */
export const SERVICOS_PADRAO = Object.freeze({
  listGuidesByCompany, toGuideResponse, getGuidePdfBuffer, gerarDanfseDaNota, listarTomadoresEmitidos,
  consultarCnpj, municipiosIbgeOuNulo, validateNfsePayload, autorizarEmissaoDoCliente, resolveLegacyCompanyId,
  canGuideRecalculate, isGuideOverdue, avisoDeRecalculo, motivoValido, validarJustificativa, parseSitfisRelatorio,
  criarPendencia,
});

const EVENTO_CANCELAMENTO = "e101101";
const LIMITE_LISTA = 20;

function recusa(motivo, mensagem, extra = {}) {
  return { ok: false, motivo, mensagem, ...extra };
}

function exigirPapel(ctx, minimo) {
  if (!ctx?.sessao?.ok) return recusa("SEM_SESSAO", "Este número ainda não está ligado a um acesso do portal; o escritório resolve.");
  if (!papelAlcanca(ctx.sessao.papel, minimo)) {
    return recusa("PAPEL_INSUFICIENTE", `Isto exige o papel ${minimo} no portal; o seu é ${ctx.sessao.papel || "nenhum"}. Peça a quem é responsável pela empresa.`);
  }
  return null;
}

const dataBR = (d) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);

/** O nome da guia na frase: o rótulo do e-mail (a MESMA função do envio), e "parcela" quando é parcela. */
function rotuloDaGuia(g) {
  const base = guideTypeEmailLabel(g.tipo);
  if (isGuiaDeParcelamento(g)) return `Parcelamento (${base})${g.numeroParcela ? ` parcela ${g.numeroParcela}` : ""}`;
  return base;
}

function guiaCurta(g) {
  return {
    guideId: g.id,
    tipo: rotuloDaGuia(g),
    competencia: g.competencia || null,
    valor: g.valor != null ? Number(g.valor) : null,
    valorFormatado: g.valor != null ? fmtBRL(g.valor) : "não informado",
    vencimento: dataBR(g.vencimento),
    situacaoPagamento: g.paymentStatus || null,
    vencida: Boolean(g.vencida),
  };
}

// ── AS DEFINIÇÕES ────────────────────────────────────────────────────────────────────────────────
// ⚠ `strict: true` + `additionalProperties: false` + todo campo em `required` (os opcionais
// aceitam `null`): o modelo não inventa campo, e o executor não adivinha o que faltou.

const S = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (description) => ({ type: "string", description });
const strOuNulo = (description) => ({ type: ["string", "null"], description });
const numOuNulo = (description) => ({ type: ["number", "null"], description });
const boolOuNulo = (description) => ({ type: ["boolean", "null"], description });

export const DEFINICOES = Object.freeze([
  { name: "listar_guias", description: "Lista as guias de imposto LIBERADAS pelo escritório para a empresa (DAS, INSS, DARF, parcelas). Use para 'quais guias', 'guia de tal mês'.", strict: true, input_schema: S({ competencia: strOuNulo("Competência AAAA-MM; null = todas"), status: strOuNulo("Filtro de situação de pagamento: OPEN, OVERDUE, PAID ou null") }) },
  { name: "quanto_devo", description: "Soma das guias liberadas ainda EM ABERTO (a pagar), com a lista e o que já venceu. Use para 'quanto devo', 'o que falta pagar'.", strict: true, input_schema: S({}) },
  { name: "enviar_pdf_da_guia", description: "Envia por WhatsApp o PDF de UMA guia liberada (pelo guideId de listar_guias/quanto_devo). Só funciona com a janela de 24h aberta.", strict: true, input_schema: S({ guideId: str("O id da guia") }) },
  { name: "listar_notas", description: "Lista notas fiscais de serviço da empresa (emitidas por ela ou recebidas), por competência.", strict: true, input_schema: S({ competencia: strOuNulo("Competência AAAA-MM; null = as mais recentes"), direcao: strOuNulo("'emitidas' (padrão) ou 'recebidas'") }) },
  { name: "danfse_da_nota", description: "Envia por WhatsApp o DANFSe (PDF) de uma nota, pelo notaId de listar_notas.", strict: true, input_schema: S({ notaId: str("O id da nota") }) },
  { name: "situacao_fiscal", description: "A situação fiscal da empresa perante a Receita, como o escritório a consultou por último (nunca consulta agora). Exige papel CLIENT_ADMIN.", strict: true, input_schema: S({}) },
  { name: "tomadores_conhecidos", description: "Os tomadores para quem a empresa já emitiu nota (nome, documento) — para reaproveitar num pedido de emissão.", strict: true, input_schema: S({}) },
  { name: "consultar_cnpj", description: "Consulta um CNPJ na Receita (BrasilAPI) para completar nome e endereço do tomador. Nunca CPF.", strict: true, input_schema: S({ cnpj: str("CNPJ com 14 dígitos (pontuação opcional)") }) },
  { name: "preparar_emissao", description: "MONTA um pedido de emissão de NFS-e e devolve o texto de confirmação. NÃO emite: o cliente precisa responder CONFIRMAR <código>. Exige papel CLIENT_ADMIN e empresa liberada pelo escritório.", strict: true, input_schema: S({
    tomadorDoc: str("CNPJ ou CPF do tomador, só dígitos ou com pontuação"),
    tomadorNome: strOuNulo("Nome/razão social do tomador"),
    tomadorEmail: strOuNulo("E-mail do tomador"),
    descricao: str("Descrição do serviço prestado"),
    valor: { type: "number", description: "Valor dos serviços em reais (ex.: 1500.5)" },
    competencia: strOuNulo("Competência da nota AAAA-MM; null = a atual"),
    aliquota: numOuNulo("Alíquota de ISS em %, só quando o cliente informar; null = a da prefeitura"),
    issRetido: boolOuNulo("ISS retido pelo tomador? null = não"),
    pTotTribSN: numOuNulo("Percentual total de tributos do Simples, quando a empresa for do Simples e o cliente informar; null = não informado"),
    endereco: { type: ["object", "null"], description: "Endereço do tomador COMPLETO (o de consultar_cnpj) ou null", properties: { cMun: str("código IBGE 7 dígitos"), CEP: str("CEP só dígitos"), xLgr: str("logradouro"), nro: str("número"), xCpl: strOuNulo("complemento"), xBairro: str("bairro") }, required: ["cMun", "CEP", "xLgr", "nro", "xCpl", "xBairro"], additionalProperties: false },
  }) },
  { name: "preparar_cancelamento", description: "MONTA um pedido de cancelamento de uma nota emitida pela empresa e devolve o texto de confirmação. NÃO cancela: o cliente precisa responder CONFIRMAR <código>. Exige papel CLIENT_ADMIN.", strict: true, input_schema: S({ notaId: str("O id da nota (de listar_notas)"), cMotivo: str("Motivo: '1' erro na emissão, '2' serviço não prestado, '9' outros"), justificativa: str("Justificativa entre 15 e 255 caracteres") }) },
  { name: "preparar_recalculo", description: "MONTA um pedido de guia atualizada (com juros e multa) para uma guia VENCIDA e devolve o texto de confirmação. NÃO gera: o cliente precisa responder CONFIRMAR <código>.", strict: true, input_schema: S({ guideId: str("O id da guia vencida") }) },
  { name: "chamar_escritorio", description: "Passa a conversa para uma pessoa do escritório (dúvida fiscal, reclamação, algo fora do que as ferramentas alcançam). Use sempre que não souber.", strict: true, input_schema: S({ motivo: str("Resumo em uma frase do que a pessoa precisa") }) },
]);

export function definicoes() {
  return DEFINICOES.map((d) => ({ ...d }));
}

// ── OS EXECUTORES ────────────────────────────────────────────────────────────────────────────────

const EXECUTORES = {
  async listar_guias(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const { sessao, servicos } = ctx;
    const result = await servicos.listGuidesByCompany({
      portalClientId: sessao.portalClientId,
      competencia: input.competencia || undefined,
      status: input.status || undefined,
      limit: LIMITE_LISTA,
      apenasLiberadas: true,
      publico: PUBLICO.CLIENTE,
    });
    const itens = (result?.items || []).map((g) => guiaCurta(servicos.toGuideResponse(g, { publico: PUBLICO.CLIENTE })));
    return { ok: true, total: Number(result?.total || itens.length), guias: itens, observacao: itens.length ? null : "Nenhuma guia LIBERADA pelo escritório neste recorte. Isso não é o mesmo que nada a pagar: o escritório pode ainda não ter liberado a guia." };
  },

  async quanto_devo(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    // ⚠ A MESMA query de `GET /client/companies/:id/fluxo`: guias liberadas, em aberto, com vencimento.
    const guias = await ctx.prisma.guide.findMany({
      where: { portalClientId: ctx.sessao.portalClientId, liberadaCliente: true, vencimento: { not: null }, paymentStatus: { in: ["OPEN", "OVERDUE"] } },
      select: { id: true, tipo: true, competencia: true, valor: true, vencimento: true, paymentStatus: true, numeroParcela: true, parcelamentoId: true },
      orderBy: { vencimento: "asc" },
    });
    const hoje = new Date(ctx.agora || Date.now());
    hoje.setHours(0, 0, 0, 0);
    const itens = guias.map((g) => guiaCurta({ ...g, vencida: g.vencimento ? new Date(g.vencimento) < hoje : false }));
    const total = guias.reduce((s, g) => s + Number(g.valor || 0), 0);
    return { ok: true, total, totalFormatado: fmtBRL(total), quantidade: itens.length, vencidas: itens.filter((i) => i.vencida).length, guias: itens, observacao: itens.length ? null : "Nenhuma guia liberada em aberto. Guias que o escritório ainda não liberou não entram aqui." };
  },

  async enviar_pdf_da_guia(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    if (ctx.janela && ctx.janela.aberta === false) return recusa("FORA_DA_JANELA", "A janela de 24h do WhatsApp está fechada; não dá para mandar documento agora. O escritório envia pelo modelo aprovado.");
    const guide = await ctx.prisma.guide.findFirst({ where: { id: String(input.guideId || ""), portalClientId: ctx.sessao.portalClientId, liberadaCliente: true } });
    if (!guide) return recusa("GUIA_NAO_ENCONTRADA", "Não encontrei essa guia entre as liberadas para a empresa.");
    const conteudo = await ctx.servicos.getGuidePdfBuffer(guide);
    if (!conteudo?.length) return recusa("GUIA_SEM_PDF", "O arquivo desta guia não está disponível no momento. O escritório pode reenviar.");
    const nomeArquivo = `${rotuloDaGuia(guide).replace(/[\\/\s()]+/g, "-")}-${guide.competencia || "guia"}.pdf`;
    const envio = await ctx.enviarDocumento({ conteudo, nomeArquivo, legenda: `Guia ${guiaCurta(guide).tipo} · ${guide.competencia || ""} · ${fmtBRL(guide.valor)}`.trim(), guideId: guide.id });
    return { ok: true, enviado: true, guideId: guide.id, nomeArquivo, providerMessageId: envio?.wamid || null };
  },

  async listar_notas(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const direcao = String(input.direcao || "emitidas").toLowerCase() === "recebidas" ? "DEST" : "EMIT";
    let filtroCompetencia = {};
    if (/^\d{4}-\d{2}$/.test(String(input.competencia || ""))) {
      const [a, m] = input.competencia.split("-").map(Number);
      filtroCompetencia = { competencia: { gte: new Date(Date.UTC(a, m - 1, 1)), lt: new Date(Date.UTC(a, m, 1)) } };
    }
    const notas = await ctx.prisma.portalInvoice.findMany({
      // ⚠ O escopo INLINE, no `where` — é o que a varredura de fonte confere.
      where: { clientId: ctx.sessao.portalClientId, type: "NFSE", papel: direcao, ...filtroCompetencia },
      select: { id: true, numero: true, competencia: true, issueDate: true, total: true, status: true, statusEfetivo: true, papel: true, tomadorNome: true, tomadorDoc: true, emitenteNome: true, xDescServ: true, chaveAcesso: true },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: LIMITE_LISTA,
    });
    return {
      ok: true,
      direcao: direcao === "EMIT" ? "emitidas" : "recebidas",
      quantidade: notas.length,
      notas: notas.map((n) => ({
        notaId: n.id, numero: n.numero, emissao: dataBR(n.issueDate), competencia: n.competencia ? String(n.competencia).slice(0, 7) : null,
        valor: n.total != null ? Number(n.total) : null, valorFormatado: n.total != null ? fmtBRL(n.total) : "não informado",
        situacao: n.statusEfetivo || n.status || null, outraParte: direcao === "EMIT" ? n.tomadorNome : n.emitenteNome, outraParteDoc: direcao === "EMIT" ? formatarDoc(n.tomadorDoc) : null,
        descricao: n.xDescServ ? String(n.xDescServ).slice(0, 120) : null, temChave: Boolean(n.chaveAcesso),
      })),
    };
  },

  async danfse_da_nota(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    if (ctx.janela && ctx.janela.aberta === false) return recusa("FORA_DA_JANELA", "A janela de 24h do WhatsApp está fechada; não dá para mandar documento agora.");
    let resultado;
    try {
      resultado = await ctx.servicos.gerarDanfseDaNota({ portalClientId: ctx.sessao.portalClientId, notaId: String(input.notaId || "") });
    } catch (err) {
      const code = String(err?.code || "");
      if (code === "DANFSE_NOTA_NAO_ENCONTRADA") return recusa(code, "Não encontrei essa nota na empresa.");
      if (code === "DANFSE_SEM_QRCODE") return recusa(code, `Este DANFSe não pode ser gerado sem o QR Code (${err?.motivo || "chave ausente"}); sem ele o documento não vale. O escritório pode conferir.`);
      if (code.startsWith("DANFSE_")) return recusa(code, "O DANFSe desta nota não pôde ser gerado com o que temos guardado. O escritório pode conferir.");
      throw err;
    }
    const envio = await ctx.enviarDocumento({ conteudo: resultado.pdf, nomeArquivo: resultado.nomeArquivo || "danfse.pdf", legenda: `DANFSe${resultado.marcaDagua ? ` (${resultado.marcaDagua})` : ""}`, notaId: String(input.notaId) });
    return { ok: true, enviado: true, notaId: String(input.notaId), nomeArquivo: resultado.nomeArquivo, marcaDagua: resultado.marcaDagua || null, providerMessageId: envio?.wamid || null };
  },

  async situacao_fiscal(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_SITUACAO_FISCAL);
    if (r) return r;
    // ⚠ O MESMO select de 4 campos da rota do cliente. NUNCA se consulta o SERPRO aqui (é pago).
    const status = await ctx.prisma.companyFiscalStatus.findUnique({
      where: { portalClientId: ctx.sessao.portalClientId },
      select: { situacao: true, texto: true, checkedAt: true, ultimoRelatorioEm: true },
    });
    if (!status) return { ok: true, situacao: null, consultadaEm: null, observacao: "O escritório ainda NÃO consultou a situação fiscal desta empresa — não há como afirmar regularidade nem pendência." };
    const relatorio = status.texto ? ctx.servicos.parseSitfisRelatorio(status.texto) : null;
    const diagnosticos = (relatorio?.diagnosticos || []).map((d) => ({
      orgao: d.orgao,
      semPendencia: Boolean(d.semPendencia),
      blocos: (d.blocos || []).map((b) => ({ titulo: b.titulo, registros: Array.isArray(b.registros) ? b.registros.length : undefined })),
    }));
    return { ok: true, situacao: status.situacao || null, consultadaEm: dataBR(status.checkedAt), relatorioDe: dataBR(status.ultimoRelatorioEm), diagnosticos, observacao: "É a foto da última consulta do escritório; para atualizar, o escritório consulta de novo." };
  },

  async tomadores_conhecidos(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const legacy = await ctx.servicos.resolveLegacyCompanyId(ctx.sessao.portalClientId);
    if (!legacy) return { ok: true, tomadores: [] };
    const lista = await ctx.servicos.listarTomadoresEmitidos({ prisma: ctx.prisma, companyId: legacy, limite: 30 });
    return { ok: true, tomadores: (lista || []).map((t) => ({ documento: t.documento, documentoFormatado: formatarDoc(t.documento), nome: t.nome || null, email: t.email || null, temEndereco: Boolean(t.cMun) })) };
  },

  async consultar_cnpj(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const municipios = await ctx.servicos.municipiosIbgeOuNulo({ log: ctx.log });
    const res = await ctx.servicos.consultarCnpj(input.cnpj, { municipios, log: ctx.log });
    if (!res.ok) return recusa(res.motivo, `${res.mensagem} A emissão segue normalmente — os dados do tomador podem ser informados à mão.`);
    const t = res.tomador;
    return { ok: true, cnpj: formatarDoc(res.cnpj), nome: t.nome, email: t.email, endereco: t.endereco, enderecoFaltantes: t.enderecoFaltantes, motivoMunicipio: t.motivoMunicipio, aviso: t.avisoSituacao, municipioTexto: t.municipioTexto, uf: t.uf };
  },

  async preparar_emissao(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const { sessao, servicos } = ctx;
    const autorizacao = await servicos.autorizarEmissaoDoCliente({ portalClientId: sessao.portalClientId, userId: sessao.userId });
    if (!autorizacao.ok) return recusa(autorizacao.codigo || "EMISSAO_NAO_AUTORIZADA", `${autorizacao.message || "A emissão pelo cliente não está autorizada."} ${autorizacao.correcao || ""}`.trim());

    const corpo = {
      companyId: sessao.portalClientId,
      tomador: { cnpjCpf: input.tomadorDoc, nome: input.tomadorNome || undefined, email: input.tomadorEmail || undefined, endereco: input.endereco || undefined },
      servico: { descricao: input.descricao, valor: input.valor, aliquota: input.aliquota ?? undefined, issRetido: input.issRetido === true },
      competencia: input.competencia || undefined,
      ...(input.pTotTribSN != null ? { pTotTribSN: input.pTotTribSN } : {}),
    };
    const validacao = servicos.validateNfsePayload(corpo);
    if (!validacao.ok) return recusa(validacao.error, `A nota não pode ser montada assim: ${validacao.error}. Peça ao cliente o que falta.`);

    const dados = validacao.data;
    const declaracao = textoDeConfirmacao({
      tomador: { nome: dados?.tomador?.nome || input.tomadorNome, doc: dados?.tomador?.cnpjCpf || input.tomadorDoc, email: dados?.tomador?.email || input.tomadorEmail || null },
      endereco: dados?.tomador?.endereco?.cMun ? dados.tomador.endereco : null,
      servico: { descricao: dados?.servico?.descricao || input.descricao, valor: dados?.servico?.valorServicos ?? input.valor, aliquota: dados?.servico?.aliquota ?? input.aliquota ?? null, issRetido: Boolean(dados?.servico?.issRetido) },
      competencia: input.competencia || null,
      pTotTribSN: input.pTotTribSN ?? null,
      regime: null,
    });
    const { texto, codigo } = await servicos.criarPendencia({
      conversaId: ctx.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId,
      tipo: TIPOS.EMITIR_NFSE, payload: { ...dados, companyId: sessao.portalClientId }, corpo: declaracao, agora: ctx.agora,
    });
    ctx.registrarPendencia?.({ tipo: TIPOS.EMITIR_NFSE, codigo, texto });
    return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto, instrucao: "O texto de confirmação será enviado ao cliente EXATAMENTE como está; diga apenas que o pedido foi montado e que ele precisa responder CONFIRMAR com o código." };
  },

  async preparar_cancelamento(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const { sessao, servicos } = ctx;
    const autorizacao = await servicos.autorizarEmissaoDoCliente({ portalClientId: sessao.portalClientId, userId: sessao.userId });
    if (!autorizacao.ok) return recusa(autorizacao.codigo || "EMISSAO_NAO_AUTORIZADA", `${autorizacao.message || "O cancelamento pelo cliente não está autorizado."} ${autorizacao.correcao || ""}`.trim());

    // As MESMAS recusas da rota `POST /client/.../cancelar`, na mesma ordem.
    let nota = await ctx.prisma.portalInvoice.findFirst({
      where: { id: String(input.notaId || ""), clientId: sessao.portalClientId },
      select: { id: true, chaveAcesso: true, numero: true, status: true, statusEfetivo: true, papel: true, type: true, tomadorDoc: true, tomadorNome: true, emitenteDoc: true, total: true, issueDate: true },
    });
    if (!nota) {
      const legacy = await servicos.resolveLegacyCompanyId(sessao.portalClientId);
      const nossa = legacy ? await ctx.prisma.serviceInvoice.findFirst({ where: { id: String(input.notaId || ""), companyId: legacy }, select: { id: true, chaveAcesso: true, numeroNfse: true, status: true, tomadorDoc: true } }) : null;
      if (nossa) nota = { id: nossa.id, chaveAcesso: nossa.chaveAcesso, numero: nossa.numeroNfse, status: nossa.status, statusEfetivo: nossa.status, papel: "EMIT", type: "NFSE", tomadorDoc: nossa.tomadorDoc, tomadorNome: null, emitenteDoc: null, total: null, issueDate: null };
    }
    if (!nota) return recusa("nota_nao_encontrada", "Não encontrei essa nota na empresa.");
    if (nota.papel === "DEST") return recusa("nota_recebida", "Essa nota foi emitida PARA a empresa (recebida) — quem pode cancelá-la é quem a emitiu.");
    if (String(nota.type || "NFSE").toUpperCase() !== "NFSE") return recusa("nota_nao_e_nfse", "Essa não é uma NFS-e; o cancelamento por aqui só vale para notas de serviço.");
    if (!nota.chaveAcesso) return recusa("nota_sem_chave", "Essa nota ainda não tem chave de acesso; sem ela não há o que cancelar.");
    if (String(nota.statusEfetivo || nota.status || "").toLowerCase().includes("cancel")) return recusa("nota_ja_cancelada", "Essa nota já consta como cancelada.");
    if (!servicos.motivoValido(EVENTO_CANCELAMENTO, input.cMotivo)) {
      return recusa("c_motivo_invalido", `Motivo inválido. Os aceitos são: ${motivosDoEvento(EVENTO_CANCELAMENTO).map((m) => `${m.codigo} (${m.descricao})`).join(", ")}.`);
    }
    const just = servicos.validarJustificativa(input.justificativa);
    if (!just.ok) return recusa("justificativa_invalida", `Justificativa inválida: ${just.motivo || `entre ${JUSTIFICATIVA.MIN} e ${JUSTIFICATIVA.MAX} caracteres`}.`);

    const motivo = motivosDoEvento(EVENTO_CANCELAMENTO).find((m) => String(m.codigo) === String(input.cMotivo));
    const corpo = [
      "Cancelar esta nota de serviço?",
      "",
      `• Número: ${nota.numero || "(sem número)"}`,
      `• Tomador: ${nota.tomadorNome || "(não informado)"}${nota.tomadorDoc ? ` · ${formatarDoc(nota.tomadorDoc)}` : ""}`,
      `• Valor: ${nota.total != null ? fmtBRL(nota.total) : "não informado"}`,
      `• Emissão: ${dataBR(nota.issueDate) || "não informada"}`,
      `• Motivo: ${input.cMotivo} — ${motivo?.descricao || ""}`,
      `• Justificativa: ${String(input.justificativa).trim()}`,
      "",
      "A nota cancelada não volta.",
    ].join("\n");
    const { texto, codigo } = await servicos.criarPendencia({
      conversaId: ctx.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId,
      tipo: TIPOS.CANCELAR_NFSE, payload: { notaId: nota.id, chaveAcesso: nota.chaveAcesso, numero: nota.numero, cMotivo: String(input.cMotivo), justificativa: String(input.justificativa).trim() }, corpo, agora: ctx.agora,
    });
    ctx.registrarPendencia?.({ tipo: TIPOS.CANCELAR_NFSE, codigo, texto });
    return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto, instrucao: "O texto de confirmação será enviado ao cliente exatamente como está." };
  },

  async preparar_recalculo(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const { sessao, servicos } = ctx;
    const guide = await ctx.prisma.guide.findFirst({ where: { id: String(input.guideId || ""), portalClientId: sessao.portalClientId, liberadaCliente: true } });
    if (!guide) return recusa("not_found", "Não encontrei essa guia entre as liberadas para a empresa.");
    if (guide.status !== "PROCESSED") return recusa("guia_nao_processada", "Esta guia ainda está sendo processada.");
    if (!servicos.canGuideRecalculate(guide)) return recusa("recalculo_indisponivel", "Esta guia não pode ser gerada de novo por aqui. Fale com o escritório.");
    if (!servicos.isGuideOverdue(guide, ctx.agora || new Date())) return recusa("guia_nao_vencida", "Esta guia ainda não venceu — use a que você já tem. Depois do vencimento dá para pedir a atualizada.");
    const aviso = servicos.avisoDeRecalculo({ guide, now: ctx.agora || new Date(), ehCliente: true });
    const corpo = [
      "Gerar a guia ATUALIZADA (com juros e multa)?",
      "",
      `• Guia: ${guiaCurta(guide).tipo} · competência ${guide.competencia || "não informada"}`,
      `• Valor atual: ${fmtBRL(guide.valor)} · vencimento ${dataBR(guide.vencimento) || "não informado"}`,
      "",
      aviso?.texto || aviso?.mensagem || "Gera uma nova guia com juros e multa; pode demorar alguns segundos.",
    ].join("\n");
    const { texto, codigo } = await servicos.criarPendencia({
      conversaId: ctx.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId,
      tipo: TIPOS.RECALCULAR_GUIA, payload: { guideId: guide.id }, corpo, agora: ctx.agora,
    });
    ctx.registrarPendencia?.({ tipo: TIPOS.RECALCULAR_GUIA, codigo, texto });
    return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto, instrucao: "O texto de confirmação será enviado ao cliente exatamente como está." };
  },

  async chamar_escritorio(input, ctx) {
    ctx.registrarChamadaAoEscritorio?.({ motivo: String(input.motivo || "").slice(0, 300) });
    return { ok: true, encaminhado: true, instrucao: "Diga que o escritório vai responder por aqui, e não prometa prazo." };
  },
};

/**
 * EXECUTA uma ferramenta pelo nome, com o contexto do turno.
 * @param {string} nome
 * @param {object} input
 * @param {object} ctx  `{ sessao, conversa, prisma?, servicos?, janela, agora, log, enviarDocumento, registrarPendencia, registrarChamadaAoEscritorio }`
 */
export async function executarFerramenta(nome, input, ctx) {
  const fn = EXECUTORES[nome];
  if (!fn) return recusa("FERRAMENTA_DESCONHECIDA", `Não existe a ferramenta ${nome}.`);
  const contexto = { ...ctx, prisma: ctx.prisma || prisma, servicos: { ...SERVICOS_PADRAO, ...(ctx.servicos || {}) }, agora: ctx.agora || new Date() };
  return fn(input || {}, contexto);
}

export const NOMES = Object.freeze(DEFINICOES.map((d) => d.name));
