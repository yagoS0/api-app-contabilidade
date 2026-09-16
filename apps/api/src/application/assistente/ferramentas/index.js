// AS FERRAMENTAS DO ASSISTENTE — 1:1 com as capacidades que o cliente JÁ tem nas rotas `/client`.
//
// Cada ferramenta = DEFINIÇÃO (o que o modelo vê: `name`, `description` em pt-BR, `input_schema`
// estrito) + EXECUTOR (o que roda aqui, com a SESSÃO do contato como escopo e como papel).
//
// ── ⚠⚠ AS TRÊS REGRAS QUE ESTE ARQUIVO NÃO PODE QUEBRAR ─────────────────────────────────────────
//   1. TODA consulta leva `sessao.portalClientId` no `where` (`portalClientId` / `clientId`). Nenhuma
//      ferramenta alcança outra empresa — travado por varredura de fonte em `promptEEscopo.test.js`.
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
import { consultarCep } from "../../tomador/consultarCep.js";
import { camposDeEnderecoDaReceita } from "../../tomador/consultaTomador.js";
import { prepararTomadorDoCliente, enderecoDaMemoria } from "../../tomador/prepararTomadorDoCliente.js";
import { prepararDadosFiscaisDoCliente } from "../../nfse/preparacaoFiscalDoCliente.js";
import { municipiosIbgeOuNulo } from "../../nfse/lote/municipiosIbge.js";
import { validateNfsePayload } from "../../validators/nfsePayload.js";
import { autorizarEmissaoDoCliente } from "../../nfse/autorizacaoEmissaoDoCliente.js";
import { canGuideRecalculate, isGuideOverdue, avisoDeRecalculo } from "../../guides/lib/recalculoDaGuia.js";
import { motivoValido, validarJustificativa, motivosDoEvento, JUSTIFICATIVA } from "../../nfse/motivosDeEvento.js";
import { montarRelatorioSitfis, lerLeituraPosicionalGravada } from "../../fiscal/serpro/lerRelatorioSitfis.js";
import { gerarPdfSitfisTabela } from "../../fiscal/serpro/gerarPdfSitfisTabela.js";
import { parseSitfisRelatorio } from "../../fiscal/serpro/parseSitfisRelatorio.js";
import { baixarBuffer as baixarDocumentoDaEmpresa, TIPO_DOCUMENTO_LABELS } from "../../companies/CompanyDocumentsService.js";
import { resolveLegacyCompanyId } from "../../../routes/middlewares/portalAccess.js";
import { textoDeConfirmacao, fmtBRL, formatarDoc } from "@contabilidade/shared/declaracao-nfse";
import { papelAlcanca, PAPEL_MINIMO_LEITURA, PAPEL_MINIMO_SITUACAO_FISCAL, PAPEL_MINIMO_EMISSAO } from "../sessaoDoContato.js";
import { TIPOS } from "../confirmacaoPendente.js";
import { criarPendencia } from "../AcoesPendentesService.js";
import { PERMISSOES_ASSISTENTE, temPermissaoAssistente } from "../../whatsapp/permissoesAssistente.js";
import { expedienteDoEscritorio } from "../expediente.js";
import { INTEGRACAO_PERFIL_EMISSAO_NFSE } from "../../../config.js";
import { lerEmitidasNaoConfirmadas } from "../../notas/notasEmitidasNaoConfirmadas.js";
import { whereFaturamentoEmit } from "../../notas/apuracao/v2/FechamentoService.js";
import { rotuloMesConsulta } from "../../whatsapp/consultaClienteWhatsapp.js";

/** As funções de fora, INJETÁVEIS. Produção usa os defaults; o teste passa dublês. */
export const SERVICOS_PADRAO = Object.freeze({
  listGuidesByCompany, toGuideResponse, getGuidePdfBuffer, gerarDanfseDaNota, listarTomadoresEmitidos,
  consultarCnpj, consultarCep, prepararTomadorDoCliente, prepararDadosFiscaisDoCliente,
  municipiosIbgeOuNulo, validateNfsePayload, autorizarEmissaoDoCliente, resolveLegacyCompanyId,
  canGuideRecalculate, isGuideOverdue, avisoDeRecalculo, motivoValido, validarJustificativa, parseSitfisRelatorio, gerarPdfSitfisTabela,
  criarPendencia, baixarDocumentoDaEmpresa, lerEmitidasNaoConfirmadas,
  listarPerfisEmissao: async ({ sessao }) => INTEGRACAO_PERFIL_EMISSAO_NFSE
    ? prisma.perfilEmissaoNfse.findMany({ where: { portalClientId: sessao.portalClientId, ativo: true }, select: { id: true, nome: true, codigoServicoNacional: true }, orderBy: { nome: "asc" } })
    : [],
});

const EVENTO_CANCELAMENTO = "e101101";
const LIMITE_LISTA = 20;

function recusa(motivo, mensagem, extra = {}) {
  return { ok: false, motivo, mensagem, ...extra };
}

function soDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function exigirPapel(ctx, minimo) {
  if (!ctx?.sessao?.ok) return recusa("SEM_SESSAO", "Este número ainda não está ligado a um acesso do portal; o escritório resolve.");
  if (!papelAlcanca(ctx.sessao.papel, minimo)) {
    return recusa("PAPEL_INSUFICIENTE", `Isto exige o papel ${minimo} no portal; o seu é ${ctx.sessao.papel || "nenhum"}. Peça a quem é responsável pela empresa.`);
  }
  return null;
}

const dataBR = (d) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const mesValido = (valor) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(valor || ""));
const competenciaEmissaoValida = (valor) => {
  if (mesValido(valor)) return true;
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(valor || ""))) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
};
const paginaDaLista = (valor) => Math.max(1, Math.min(1000, Math.trunc(Number(valor)) || 1));
const competenciaDaData = (valor) => {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString().slice(0, 7);
};
function intervaloDoMes(valor) {
  const [ano, mes] = valor.split("-").map(Number);
  return { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) };
}

function centavosInformados(valor) {
  if (valor == null || String(valor).trim() === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) : null;
}

/** O nome da guia na frase: o rótulo do e-mail (a MESMA função do envio), e "parcela" quando é parcela. */
function rotuloDaGuia(g) {
  const base = guideTypeEmailLabel(g.tipo);
  if (isGuiaDeParcelamento(g)) return `Parcelamento (${base})${g.numeroParcela ? ` parcela ${g.numeroParcela}` : ""}`;
  return base;
}

function guiaCurta(g) {
  return {
    guideId: g.guideId || g.id,
    tipo: rotuloDaGuia(g),
    tipoCodigo: g.tipo || null,
    competencia: g.competencia || null,
    valor: g.valor != null ? Number(g.valor) : null,
    valorFormatado: g.valor != null ? fmtBRL(g.valor) : "não informado",
    vencimento: dataBR(g.vencimento),
    situacaoPagamento: g.paymentStatus || null,
    vencida: Boolean(g.vencida),
  };
}

// ── AS DEFINIÇÕES ────────────────────────────────────────────────────────────────────────────────
// A preparação de emissão tem 16 unions e ultrapassa a complexidade de compilação Anthropic
// junto ao catálogo. Probes reais recusaram também variantes opcionais (HTTP 400). Ela usa
// validação de entrada LOCAL + validateNfsePayload + confirmação por código. As outras ferramentas
// continuam strict. Nunca trocar campos numéricos ausentes por zero para simplificar um schema.

const S = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (description) => ({ type: "string", description });
const strOuNulo = (description) => ({ type: ["string", "null"], description });
const numOuNulo = (description) => ({ type: ["number", "null"], description });
const boolOuNulo = (description) => ({ type: ["boolean", "null"], description });
// O compilador Anthropic recusou enum junto de type:[string,null] (HTTP400). O catálogo
// completo foi aceito com os mesmos valores divididos em anyOf; o contrato do executor é igual.
const enumOuNulo = (valores, description) => ({ anyOf: [{ type: "string", enum: valores }, { type: "null" }], description });

export const DEFINICOES = Object.freeze([
  { name: "listar_guias", description: "Lista as guias de imposto LIBERADAS pelo escritório para a empresa (DAS, INSS, DARF, parcelas). 'Guias do mês' usa mesVencimento; competência só quando o cliente pedir a competência. Retorna ids utilizáveis para envio/recálculo. Continue por proximaPagina se necessário.", strict: true, input_schema: S({ competencia: strOuNulo("Competência AAAA-MM; null = todas"), mesVencimento: strOuNulo("Mês em que vence, AAAA-MM. Use o mês atual para 'guias do mês'; null = sem filtro de vencimento"), status: enumOuNulo(["OPEN", "OVERDUE", "PAID"], "Situação de pagamento; null = todas"), pagina: numOuNulo("Página, começa em 1; use proximaPagina para continuar") }) },
  { name: "quanto_devo", description: "Soma das guias liberadas ainda EM ABERTO (a pagar), com a lista e o que já venceu. Use para 'quanto devo', 'o que falta pagar'.", strict: true, input_schema: S({}) },
  { name: "consultar_faturamento", description: "Soma COMPLETA do faturamento registrado no sistema: notas emitidas autorizadas do período, na mesma população da apuração. Não soma uma página de listar_notas e não consulta serviços externos. Não representa recebimento bancário. Ausência de notas registradas não comprova ausência de faturamento.", strict: true, input_schema: S({ inicio: str("Primeiro mês, AAAA-MM"), fim: str("Último mês, AAAA-MM, inclusive. Máximo de 12 meses.") }) },
  { name: "enviar_pdf_da_guia", description: "Envia por WhatsApp o PDF de UMA guia liberada (pelo guideId de listar_guias/quanto_devo). Só funciona com a janela de 24h aberta.", strict: true, input_schema: S({ guideId: str("O id da guia") }) },
  { name: "listar_notas", description: "Lista notas fiscais de serviço da empresa, incluindo as recém emitidas pelo portal. Use para achar a última nota, uma nota pelo número ou pelo tomador antes de enviar DANFSe ou preparar cancelamento. Continue por proximaPagina quando necessário.", strict: true, input_schema: S({ competencia: strOuNulo("Competência AAAA-MM; null = as mais recentes"), direcao: enumOuNulo(["emitidas", "recebidas"], "Emitidas pela empresa (padrão) ou recebidas"), busca: strOuNulo("Número exato da nota, nome ou documento da outra parte; null = sem busca"), pagina: numOuNulo("Página, começa em 1; use proximaPagina para continuar") }) },
  { name: "danfse_da_nota", description: "Envia por WhatsApp o DANFSe (PDF) de uma nota, pelo notaId de listar_notas.", strict: true, input_schema: S({ notaId: str("O id da nota") }) },
  { name: "listar_documentos", description: "Lista e busca documentos cadastrais e societários guardados para a empresa. Use busca para achar pelo nome/tipo e proximaPagina para continuar. Exige papel CLIENT_ADMIN e liberação explícita deste número.", strict: true, input_schema: S({ busca: strOuNulo("Nome ou tipo do documento, por exemplo alvará ou contrato social; null = todos"), pagina: numOuNulo("Página, começa em 1; use proximaPagina para continuar") }) },
  { name: "enviar_documento_da_empresa", description: "Envia por WhatsApp UM documento cadastral ou societário, pelo documentId retornado por listar_documentos. Só funciona com a janela de 24h aberta.", strict: true, input_schema: S({ documentId: str("O id do documento") }) },
  { name: "situacao_fiscal", description: "Envia PDF das tabelas completas da última situação fiscal salva pelo escritório, sem nova consulta à Receita. Exige CLIENT_ADMIN e janela de envio aberta.", strict: true, input_schema: S({}) },
  { name: "tomadores_conhecidos", description: "Os tomadores para quem a empresa já emitiu nota (nome, documento) — para reaproveitar num pedido de emissão.", strict: true, input_schema: S({}) },
  { name: "consultar_cnpj", description: "Consulta um CNPJ na Receita (BrasilAPI) para completar nome e endereço do tomador. Nunca CPF.", strict: true, input_schema: S({ cnpj: str("CNPJ com 14 dígitos (pontuação opcional)") }) },
  { name: "consultar_cep", description: "Completa rua, bairro e município pelo CEP. Não retorna número nem complemento do imóvel. Reaproveite os dados parciais retornados.", strict: true, input_schema: S({ cep: str("CEP com 8 dígitos, pontuação opcional") }) },
  { name: "preparar_emissao", description: "MONTA um pedido de emissão de NFS-e e devolve o texto de confirmação. NÃO emite: o cliente precisa responder CONFIRMAR <código>. Exige papel CLIENT_ADMIN e empresa liberada pelo escritório. Informe números como números, booleanos como booleanos; campos ausentes podem ser omitidos ou null. A entrada é validada no servidor.", strict: false, input_schema: S({
    tomadorDoc: str("CNPJ ou CPF do tomador, só dígitos ou com pontuação"),
    tomadorNome: strOuNulo("Nome/razão social do tomador"),
    perfilId: strOuNulo("Perfil de serviço escolhido pelo cliente entre as opções devolvidas por preparar_emissao; null para consultar as opções. Nunca invente um id."),
    tomadorEmail: strOuNulo("E-mail do tomador"),
    valorRetidoIRRF: numOuNulo("Valor em reais de IRRF retido informado pelo cliente; nunca calcule ou presuma; null quando ausente"),
    valorRetidoPrevidencia: numOuNulo("Valor em reais de previdência retida informado pelo cliente; nunca calcule ou presuma; null quando ausente"),
    obraCnoCei: strOuNulo("CNO/CEI da obra informado pelo cliente; null quando ausente"),
    obraCib: strOuNulo("CIB da obra com 8 caracteres, alternativa ao CNO/CEI; null quando ausente"),
    obraInscricaoImobiliaria: strOuNulo("Inscrição imobiliária da obra; null quando ausente"),
    destinatarioDoc: strOuNulo("CPF/CNPJ do destinatário diferente do tomador, somente se explicitamente informado; null quando igual ao tomador"),
    destinatarioNome: strOuNulo("Nome do destinatário diferente do tomador; null quando igual ao tomador"),
    descricao: str("Descrição do serviço prestado"),
    valor: { type: "number", description: "Valor dos serviços em reais (ex.: 1500.5)" },
    competencia: strOuNulo("Competência da nota AAAA-MM ou AAAA-MM-DD; null = a atual. Preserve a data completa já retornada ao corrigir o pedido."),
    aliquota: numOuNulo("Alíquota de ISS em %, somente se explicitamente informada; normalmente omita. O sistema lê a configuração fiscal e o perfil cadastrado antes do resumo."),
    issRetido: boolOuNulo("ISS retido pelo tomador? null = não"),
    pTotTribSN: numOuNulo("Normalmente omita: o sistema busca no histórico fiscal salvo, como o portal. Não peça tributos ao cliente; cadastro fiscal incompleto cabe ao escritório."),
    endereco: { type: ["object", "null"], description: "Dados de endereço já informados; pode ser parcial, como CEP e número. O sistema completa as lacunas por consulta.", properties: { cMun: strOuNulo("código IBGE 7 dígitos, somente se conhecido"), CEP: strOuNulo("CEP"), xLgr: strOuNulo("logradouro"), nro: strOuNulo("número"), xCpl: strOuNulo("complemento"), xBairro: strOuNulo("bairro") }, required: [], additionalProperties: false },
  }) },
  { name: "preparar_cancelamento", description: "MONTA um pedido de cancelamento de uma nota emitida pela empresa e devolve o texto de confirmação. NÃO cancela: o cliente precisa responder CONFIRMAR <código>. Exige papel CLIENT_ADMIN.", strict: true, input_schema: S({ notaId: str("O id da nota (de listar_notas)"), cMotivo: str("Motivo: '1' erro na emissão, '2' serviço não prestado, '9' outros"), justificativa: str("Justificativa entre 15 e 255 caracteres") }) },
  { name: "preparar_recalculo", description: "MONTA um pedido de guia atualizada (com juros e multa) para uma guia VENCIDA e devolve o texto de confirmação. NÃO gera: o cliente precisa responder CONFIRMAR <código>.", strict: true, input_schema: S({ guideId: str("O id da guia vencida") }) },
  { name: "chamar_escritorio", description: "Passa a conversa para uma pessoa do escritório (dúvida fiscal, reclamação, algo fora do que as ferramentas alcançam). Use sempre que não souber.", strict: true, input_schema: S({ motivo: str("Resumo em uma frase do que a pessoa precisa") }) },
]);

export const PERMISSAO_POR_FERRAMENTA = Object.freeze({
  listar_guias: PERMISSOES_ASSISTENTE.GUIAS,
  quanto_devo: PERMISSOES_ASSISTENTE.GUIAS,
  enviar_pdf_da_guia: PERMISSOES_ASSISTENTE.GUIAS,
  listar_notas: PERMISSOES_ASSISTENTE.NOTAS_DANFSE,
  consultar_faturamento: PERMISSOES_ASSISTENTE.NOTAS_DANFSE,
  danfse_da_nota: PERMISSOES_ASSISTENTE.NOTAS_DANFSE,
  listar_documentos: PERMISSOES_ASSISTENTE.DOCUMENTOS_EMPRESA,
  enviar_documento_da_empresa: PERMISSOES_ASSISTENTE.DOCUMENTOS_EMPRESA,
  situacao_fiscal: PERMISSOES_ASSISTENTE.SITUACAO_FISCAL,
  tomadores_conhecidos: PERMISSOES_ASSISTENTE.EMISSAO_NFSE,
  consultar_cnpj: PERMISSOES_ASSISTENTE.EMISSAO_NFSE,
  consultar_cep: PERMISSOES_ASSISTENTE.EMISSAO_NFSE,
  preparar_emissao: PERMISSOES_ASSISTENTE.EMISSAO_NFSE,
  preparar_cancelamento: PERMISSOES_ASSISTENTE.CANCELAMENTO_NFSE,
  preparar_recalculo: PERMISSOES_ASSISTENTE.RECALCULO_GUIA,
});

const PAPEL_POR_FERRAMENTA = Object.freeze({
  listar_guias: PAPEL_MINIMO_LEITURA,
  quanto_devo: PAPEL_MINIMO_LEITURA,
  enviar_pdf_da_guia: PAPEL_MINIMO_LEITURA,
  listar_notas: PAPEL_MINIMO_LEITURA,
  consultar_faturamento: PAPEL_MINIMO_LEITURA,
  danfse_da_nota: PAPEL_MINIMO_LEITURA,
  listar_documentos: PAPEL_MINIMO_SITUACAO_FISCAL,
  enviar_documento_da_empresa: PAPEL_MINIMO_SITUACAO_FISCAL,
  situacao_fiscal: PAPEL_MINIMO_SITUACAO_FISCAL,
  tomadores_conhecidos: PAPEL_MINIMO_EMISSAO,
  consultar_cnpj: PAPEL_MINIMO_EMISSAO,
  consultar_cep: PAPEL_MINIMO_EMISSAO,
  preparar_emissao: PAPEL_MINIMO_EMISSAO,
  preparar_cancelamento: PAPEL_MINIMO_EMISSAO,
  preparar_recalculo: PAPEL_MINIMO_LEITURA,
});

export function definicoes(sessao = null) {
  return DEFINICOES
    .filter((d) => !sessao || !PERMISSAO_POR_FERRAMENTA[d.name] || temPermissaoAssistente(sessao, PERMISSAO_POR_FERRAMENTA[d.name]))
    .filter((d) => !sessao || !PAPEL_POR_FERRAMENTA[d.name] || papelAlcanca(sessao.papel, PAPEL_POR_FERRAMENTA[d.name]))
    .map((d) => ({ ...d }));
}

/** Valida o subconjunto JSON Schema utilizado na emissão ANTES de consultar ou preparar algo.
 * O modelo sem strict pode omitir campos anuláveis; campos obrigatórios reais continuam exigidos.
 * A validação fiscal/semântica permanece no validador compartilhado da rota de emissão.
 */
function validarEntradaEmissao(input) {
  const schema = DEFINICOES.find((d) => d.name === "preparar_emissao").input_schema;
  const erros = [];
  const visitar = (valor, regra, caminho) => {
    const tipos = Array.isArray(regra.type) ? regra.type : [regra.type];
    if (valor === undefined && tipos.includes("null")) return;
    const tipo = valor === null ? "null" : Array.isArray(valor) ? "array" : typeof valor;
    if (!tipos.includes(tipo) || (tipo === "number" && !Number.isFinite(valor))) { erros.push(caminho || "dados"); return; }
    if (regra.enum && !regra.enum.includes(valor)) { erros.push(caminho); return; }
    if (tipo !== "object") return;
    for (const chave of Object.keys(valor)) if (!Object.hasOwn(regra.properties || {}, chave)) erros.push(caminho ? `${caminho}.${chave}` : chave);
    for (const [chave, propriedade] of Object.entries(regra.properties || {})) visitar(valor[chave], propriedade, caminho ? `${caminho}.${chave}` : chave);
  };
  visitar(input, schema, "");
  if (input?.competencia != null && !competenciaEmissaoValida(input.competencia)) erros.push("competencia");
  return erros.length ? recusa("DADOS_EMISSAO_INVALIDOS", "Confira os dados informados para montar a nota. Use valores numéricos para valores e percentuais; não acrescente campos que não foram solicitados.", { campos: erros.slice(0, 10) }) : null;
}

// ── OS EXECUTORES ────────────────────────────────────────────────────────────────────────────────

const EXECUTORES = {
  async consultar_faturamento(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    if (!mesValido(input.inicio) || !mesValido(input.fim)) return recusa("MES_INVALIDO", "Qual mês ou ano você quer consultar? Pode escrever, por exemplo, agosto de 2026.");
    const indice = m => +m.slice(0, 4) * 12 + +m.slice(5);
    const meses = indice(input.fim) - indice(input.inicio) + 1;
    if (meses < 1 || meses > 12) return recusa("PERIODO_INVALIDO", "Posso consultar até 12 meses por vez. Qual período você quer ver?");
    const resumo = await ctx.prisma.portalInvoice.aggregate({
      where: { ...whereFaturamentoEmit(), clientId: ctx.sessao.portalClientId,
        competencia: { gte: intervaloDoMes(input.inicio).gte, lt: intervaloDoMes(input.fim).lt } },
      _sum: { total: true }, _count: { _all: true, total: true }, _max: { updatedAt: true },
    });
    const quantidade = resumo._count._all, semValor = quantidade - resumo._count.total;
    return { ok: true, inicio: input.inicio, fim: input.fim, quantidade, semValor,
      total: semValor ? null : Number(resumo._sum.total || 0),
      totalFormatado: semValor ? null : fmtBRL(Number(resumo._sum.total || 0)),
      atualizadoEm: resumo._max.updatedAt?.toISOString() || null,
      fonte: "Notas emitidas autorizadas registradas no sistema" };
  },
  async listar_guias(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    const { sessao, servicos } = ctx;
    if ((input.competencia && !mesValido(input.competencia)) || (input.mesVencimento && !mesValido(input.mesVencimento))) return recusa("MES_INVALIDO", "Informe o mês e o ano que deseja consultar.");
    if (input.status && !["OPEN", "OVERDUE", "PAID"].includes(input.status)) return recusa("STATUS_INVALIDO", "Informe se procura guias em aberto, vencidas ou pagas.");
    const pagina = paginaDaLista(input.pagina);
    const result = await servicos.listGuidesByCompany({
      portalClientId: sessao.portalClientId,
      competencia: input.competencia || undefined,
      paymentStatus: input.status || undefined,
      ...(input.mesVencimento ? { vencimento: intervaloDoMes(input.mesVencimento) } : {}),
      page: pagina,
      limit: LIMITE_LISTA,
      apenasLiberadas: true,
      publico: PUBLICO.CLIENTE,
    });
    const itens = (result?.items || []).map((g) => guiaCurta(servicos.toGuideResponse(g, { publico: PUBLICO.CLIENTE })));
    const total = Number(result?.total ?? itens.length);
    const temMais = pagina * LIMITE_LISTA < total;
    return { ok: true, total, pagina, temMais, proximaPagina: temMais ? pagina + 1 : null, guias: itens, observacao: itens.length ? null : "Nenhuma guia LIBERADA pelo escritório neste recorte. Isso não é o mesmo que nada a pagar: o escritório pode ainda não ter liberado a guia." };
  },

  async quanto_devo(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    // Guia sem vencimento continua sendo uma obrigação conhecida; só não permite afirmar atraso.
    const guias = await ctx.prisma.guide.findMany({
      where: { portalClientId: ctx.sessao.portalClientId, liberadaCliente: true, paymentStatus: { in: ["OPEN", "OVERDUE"] } },
      select: { id: true, tipo: true, competencia: true, valor: true, vencimento: true, paymentStatus: true, numeroParcela: true, parcelamentoId: true },
      orderBy: { vencimento: "asc" },
    });
    const hoje = new Date(ctx.agora || Date.now());
    hoje.setHours(0, 0, 0, 0);
    const itens = guias.map((g) => guiaCurta({ ...g, vencida: g.vencimento ? new Date(g.vencimento) < hoje : false }));
    const valores = guias.map((g) => centavosInformados(g.valor));
    const semValor = valores.filter((v) => v === null).length;
    const subtotalConhecido = valores.reduce((s, v) => s + (v ?? 0), 0) / 100;
    const total = semValor ? null : subtotalConhecido;
    return { ok: true, total, totalFormatado: total == null ? null : fmtBRL(total), totalParcial: semValor > 0, semValor, subtotalConhecido, subtotalConhecidoFormatado: fmtBRL(subtotalConhecido), quantidade: itens.length, vencidas: itens.filter((i) => i.vencida).length, guias: itens, observacao: semValor ? "Há guias com valor não informado. O subtotal soma apenas valores conhecidos e não representa o total a pagar." : itens.length ? null : "Nenhuma guia liberada em aberto. Guias que o escritório ainda não liberou não entram aqui." };
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
    const envio = await ctx.enviarDocumento({ conteudo, nomeArquivo, legenda: `Aqui está sua guia de ${guiaCurta(guide).tipo}.\nValor: ${guide.valor == null ? "não informado" : fmtBRL(guide.valor)}\nVencimento: ${dataBR(guide.vencimento) || "não informado"}${guide.competencia ? `\nReferente a ${rotuloMesConsulta(guide.competencia)}.` : ""}`, guideId: guide.id });
    return { ok: true, enviado: true, guideId: guide.id, nomeArquivo, providerMessageId: envio?.wamid || null };
  },

  async listar_notas(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_LEITURA);
    if (r) return r;
    if (input.competencia && !mesValido(input.competencia)) return recusa("MES_INVALIDO", "Informe o mês e o ano das notas que procura.");
    if (input.direcao && !["emitidas", "recebidas"].includes(input.direcao)) return recusa("DIRECAO_INVALIDA", "Informe se procura notas emitidas pela empresa ou recebidas de fornecedores.");
    const direcao = String(input.direcao || "emitidas").toLowerCase() === "recebidas" ? "DEST" : "EMIT";
    const pagina = paginaDaLista(input.pagina);
    const busca = String(input.busca || "").trim().slice(0, 120);
    const filtroCompetencia = input.competencia ? { competencia: intervaloDoMes(input.competencia) } : {};
    const empresa = await ctx.prisma.portalClient.findUnique({ where: { id: ctx.sessao.portalClientId }, select: { cnpj: true, companyId: true } });
    const docEmpresa = soDigitos(empresa?.cnpj);
    // Papel explícito prevalece; registros antigos sem papel usam o documento da empresa.
    const filtroDirecao = { OR: [{ papel: direcao }, ...(docEmpresa ? [{ papel: null, [direcao === "EMIT" ? "emitenteDoc" : "tomadorDoc"]: docEmpresa }] : [])] };
    const campoNome = direcao === "EMIT" ? "tomadorNome" : "emitenteNome";
    const campoDoc = direcao === "EMIT" ? "tomadorDoc" : "emitenteDoc";
    const filtroBusca = !busca ? {} : /^\d+$/.test(busca) && busca.length < 11 ? { numero: busca } : { OR: [
      { [campoNome]: { contains: busca, mode: "insensitive" } },
      ...(soDigitos(busca) ? [{ [campoDoc]: { contains: soDigitos(busca) } }] : []),
    ] };
    const limitePrefixo = pagina * LIMITE_LISTA + 1;
    const notasDoAdn = await ctx.prisma.portalInvoice.findMany({
      // ⚠ O escopo INLINE, no `where` — é o que a varredura de fonte confere.
      where: { clientId: ctx.sessao.portalClientId, type: "NFSE", AND: [filtroDirecao, filtroCompetencia, filtroBusca] },
      select: { id: true, numero: true, competencia: true, issueDate: true, createdAt: true, total: true, status: true, statusEfetivo: true, papel: true, tomadorNome: true, tomadorDoc: true, emitenteNome: true, emitenteDoc: true, xDescServ: true, chaveAcesso: true },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limitePrefixo,
    });
    // A mesma união e deduplicação do portal: emitir NÃO grava PortalInvoice. O DANFSe e
    // cancelamento já aceitam os dois ids; a lista precisa tornar a emissão nova alcançável.
    // Havendo um prefixo completo do ADN, emissões anteriores ao menor instante dele não
    // podem entrar nesta página nem mudar temMais. Evita varrer todo o histórico capturado.
    const menorInstanteDoAdn = notasDoAdn.length >= limitePrefixo
      ? Math.min(...notasDoAdn.map((n) => new Date(n.issueDate || n.createdAt).getTime())) : NaN;
    const novas = direcao === "EMIT" && empresa?.companyId ? await ctx.servicos.lerEmitidasNaoConfirmadas({
      legacyCompanyId: empresa.companyId, portalClientId: ctx.sessao.portalClientId, client: ctx.prisma,
      competencia: input.competencia || null, busca, cnpjEmitente: docEmpresa, limite: limitePrefixo,
      criadaDesde: Number.isFinite(menorInstanteDoAdn) ? new Date(menorInstanteDoAdn) : null,
    }) : [];
    const notasNovas = novas.filter((n) => (!input.competencia || competenciaDaData(n.competencia) === input.competencia)
      && (!busca || (/^\d+$/.test(busca) && busca.length < 11 ? String(n.numeroNfse || "") === busca
        : String(n.tomadorNome || "").toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")) || Boolean(soDigitos(busca) && soDigitos(n.tomadorDoc).includes(soDigitos(busca))))))
      .map((n) => ({ ...n, numero: n.numeroNfse, total: n.valorServicos, issueDate: n.createdAt, statusEfetivo: n.status === "cancelled" ? "CANCELAMENTO_ENVIADO" : "EMITIDA", confirmadaPeloAdn: false }));
    const unidas = [...notasDoAdn.map((n) => ({ ...n, confirmadaPeloAdn: true })), ...notasNovas]
      .sort((a, b) => new Date(b.issueDate || b.createdAt).getTime() - new Date(a.issueDate || a.createdAt).getTime()
        || String(b.id).localeCompare(String(a.id)));
    const inicio = (pagina - 1) * LIMITE_LISTA;
    const notas = unidas.slice(inicio, inicio + LIMITE_LISTA);
    const temMais = unidas.length > inicio + LIMITE_LISTA;
    return {
      ok: true,
      direcao: direcao === "EMIT" ? "emitidas" : "recebidas",
      pagina, temMais, proximaPagina: temMais ? pagina + 1 : null,
      quantidade: notas.length,
      notas: notas.map((n) => ({
        notaId: n.id, numero: n.numero, emissao: dataBR(n.issueDate), competencia: competenciaDaData(n.competencia), confirmadaPeloAdn: n.confirmadaPeloAdn,
        valor: n.total != null ? Number(n.total) : null, valorFormatado: n.total != null ? fmtBRL(n.total) : "não informado",
        situacao: n.statusEfetivo || n.status || null, outraParte: direcao === "EMIT" ? n.tomadorNome : n.emitenteNome, outraParteDoc: formatarDoc(direcao === "EMIT" ? n.tomadorDoc : n.emitenteDoc),
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

  async listar_documentos(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_SITUACAO_FISCAL);
    if (r) return r;
    const pagina = paginaDaLista(input.pagina);
    const busca = String(input.busca || "").trim().slice(0, 120);
    const comparar = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const tipos = busca ? Object.entries(TIPO_DOCUMENTO_LABELS).filter(([, label]) => comparar(label).includes(comparar(busca))).map(([tipo]) => tipo) : [];
    const encontrados = await ctx.prisma.companyDocument.findMany({
      where: { portalClientId: ctx.sessao.portalClientId, ...(busca ? { OR: [{ nome: { contains: busca, mode: "insensitive" } }, ...(tipos.length ? [{ tipo: { in: tipos } }] : [])] } : {}) },
      select: { id: true, tipo: true, nome: true, mimeType: true, bytes: true, validade: true, createdAt: true },
      orderBy: [{ tipo: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (pagina - 1) * 30,
      take: 31,
    });
    const temMais = encontrados.length > 30;
    const documentos = encontrados.slice(0, 30);
    return {
      ok: true,
      pagina, temMais, proximaPagina: temMais ? pagina + 1 : null,
      quantidade: documentos.length,
      documentos: documentos.map((d) => ({
        documentId: d.id,
        tipo: d.tipo,
        tipoDescricao: TIPO_DOCUMENTO_LABELS[d.tipo] || "Documento",
        nome: d.nome,
        formato: d.mimeType,
        bytes: d.bytes,
        validade: dataBR(d.validade),
        cadastradoEm: dataBR(d.createdAt),
      })),
      observacao: documentos.length ? null : busca || pagina > 1 ? "Nenhum documento encontrado neste recorte." : "O escritório ainda não cadastrou documentos para esta empresa.",
    };
  },

  async enviar_documento_da_empresa(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_SITUACAO_FISCAL);
    if (r) return r;
    if (ctx.janela && ctx.janela.aberta === false) {
      return recusa("FORA_DA_JANELA", "A janela de 24h do WhatsApp está fechada; não dá para mandar documento agora.");
    }
    let arquivo;
    try {
      arquivo = await ctx.servicos.baixarDocumentoDaEmpresa({
        portalClientId: ctx.sessao.portalClientId,
        documentId: String(input.documentId || ""),
      });
    } catch (err) {
      if (err?.code === "documento_nao_encontrado") {
        return recusa("DOCUMENTO_NAO_ENCONTRADO", "Não encontrei esse documento nesta empresa.");
      }
      return recusa("DOCUMENTO_INDISPONIVEL", "O arquivo deste documento não está disponível agora. O escritório vai conferir.");
    }
    const nomeArquivo = String(arquivo?.doc?.nome || "documento").slice(0, 200);
    const tipo = TIPO_DOCUMENTO_LABELS[arquivo?.doc?.tipo] || "Documento";
    const envio = await ctx.enviarDocumento({
      conteudo: arquivo.buffer,
      nomeArquivo,
      legenda: `${tipo} · ${nomeArquivo}`,
      mimeType: arquivo?.doc?.mimeType || "application/pdf",
      documentId: String(input.documentId),
    });
    return { ok: true, enviado: true, documentId: String(input.documentId), nomeArquivo, providerMessageId: envio?.wamid || null };
  },

  async situacao_fiscal(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_SITUACAO_FISCAL);
    if (r) return r;
    // ⚠ O MESMO select de 4 campos da rota do cliente. NUNCA se consulta o SERPRO aqui (é pago).
    const status = await ctx.prisma.companyFiscalStatus.findUnique({
      where: { portalClientId: ctx.sessao.portalClientId },
      select: { situacao: true, texto: true, rawPayload: true, checkedAt: true, ultimoRelatorioEm: true },
    });
    if (!status) return { ok: true, situacao: null, consultadaEm: null, observacao: "O escritório ainda NÃO consultou a situação fiscal desta empresa — não há como afirmar regularidade nem pendência." };
    if (!ctx.janela?.aberta) return recusa("FORA_DA_JANELA", "Para receber a tabela fiscal, envie uma nova mensagem para abrir a janela de atendimento.");
    const posicional = lerLeituraPosicionalGravada(status.rawPayload);
    if (!status.texto?.trim() && !posicional) return recusa("RELATORIO_INDISPONIVEL", "Existe uma consulta registrada, mas a tabela salva não está disponível. O escritório precisa verificar o relatório.");
    try {
      const relatorio = posicional ? montarRelatorioSitfis({ texto: status.texto, posicional }).relatorio : ctx.servicos.parseSitfisRelatorio(status.texto);
      const empresa = await ctx.prisma.portalClient.findUnique({ where: { id: ctx.sessao.portalClientId }, select: { razao: true, cnpj: true } });
      const consultadaEm = dataBR(status.checkedAt), relatorioDe = dataBR(status.ultimoRelatorioEm);
      const conteudo = await ctx.servicos.gerarPdfSitfisTabela({ relatorio, empresa, consultadaEm, relatorioDe });
      const nomeArquivo = "situacao-fiscal-" + String(empresa?.cnpj || ctx.sessao.portalClientId).replace(/[^a-zA-Z0-9-]/g, "") + ".pdf";
      const envio = await ctx.enviarDocumento({ conteudo, nomeArquivo, mimeType: "application/pdf", situacaoFiscal: true,
        legenda: "Situação fiscal — tabela da última consulta. Relatório de " + (relatorioDe || consultadaEm || "data não informada") + "." });
      return { ok: true, enviado: true, nomeArquivo, consultadaEm, relatorioDe, providerMessageId: envio?.wamid || null,
        instrucao: "A tabela completa foi enviada em PDF. Confirme o envio brevemente, sem substituir a tabela por códigos de situação ou afirmar regularidade." };
    } catch (error) {
      ctx.log?.error?.({ codigo: error?.codigo || "SITFIS_ANEXO_ERRO" }, "Falha ao preparar ou enviar tabela fiscal salva");
      return recusa(error?.codigo || "SITFIS_ANEXO_ERRO", "Não foi possível entregar a tabela fiscal. O envio não está confirmado; tente novamente ou fale com o escritório.");
    }
  },

  async tomadores_conhecidos(_input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const legacy = await ctx.servicos.resolveLegacyCompanyId(ctx.sessao.portalClientId);
    if (!legacy) return { ok: true, tomadores: [] };
    const lista = await ctx.servicos.listarTomadoresEmitidos({ prisma: ctx.prisma, companyId: legacy, limite: 30 });
    return { ok: true, aviso: lista?.motivo ? "A lista de tomadores salvos não pôde ser consultada agora. Isso não significa que a empresa não tenha tomadores salvos." : null, recortada: lista?.recortada === true,
      tomadores: (Array.isArray(lista) ? lista : lista?.tomadores || []).map((t) => ({ documento: t.documento, documentoFormatado: formatarDoc(t.documento), nome: t.nome || null, email: t.email || null, endereco: enderecoDaMemoria(t), temEndereco: Boolean(t.cMun && t.cep && t.xLgr && t.nro && t.xBairro) })) };
  },

  async consultar_cnpj(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const municipios = await ctx.servicos.municipiosIbgeOuNulo({ log: ctx.log });
    const res = await ctx.servicos.consultarCnpj(input.cnpj, { municipios, log: ctx.log });
    if (!res.ok) return recusa(res.motivo, `${res.mensagem} A emissão segue normalmente — os dados do tomador podem ser informados à mão.`);
    const t = res.tomador;
    return { ok: true, cnpj: formatarDoc(res.cnpj), nome: t.nome, email: t.email, endereco: t.endereco || (res.bruto ? camposDeEnderecoDaReceita(res.bruto, { municipios }) : null), enderecoFaltantes: t.enderecoFaltantes, motivoMunicipio: t.motivoMunicipio, aviso: t.avisoSituacao, municipioTexto: t.municipioTexto, uf: t.uf };
  },

  async consultar_cep(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const municipios = await ctx.servicos.municipiosIbgeOuNulo({ log: ctx.log });
    return ctx.servicos.consultarCep(input.cep, { municipios, log: ctx.log });
  },

  async preparar_emissao(input, ctx) {
    const r = exigirPapel(ctx, PAPEL_MINIMO_EMISSAO);
    if (r) return r;
    const erroEntrada = validarEntradaEmissao(input);
    if (erroEntrada) return erroEntrada;
    const { sessao, servicos } = ctx;
    const autorizacao = await servicos.autorizarEmissaoDoCliente({ portalClientId: sessao.portalClientId, userId: sessao.userId });
    if (!autorizacao.ok) return recusa(autorizacao.codigo || "EMISSAO_NAO_AUTORIZADA", `${autorizacao.message || "A emissão pelo cliente não está autorizada."} ${autorizacao.correcao || ""}`.trim());

    const perfis = await servicos.listarPerfisEmissao({ sessao });
    const perfil = input.perfilId ? perfis.find((p) => p.id === input.perfilId) : perfis.length === 1 ? perfis[0] : null;
    if ((perfis.length > 1 || input.perfilId) && !perfil) {
      return recusa("ESCOLHER_PERFIL_EMISSAO", "Apresente os perfis configurados pelo contador e aguarde a próxima mensagem do cliente com a escolha. Não prepare novamente nesta rodada nem escolha pela semelhança com a descrição do serviço. Depois da resposta, use o perfilId escolhido.", { perfis });
    }
    const fiscal = await servicos.prepararDadosFiscaisDoCliente({ portalClientId: sessao.portalClientId, perfilId: perfil?.id || null, competencia: input.competencia,
      servico: { descricao: input.descricao, valor: input.valor, aliquota: input.aliquota, issRetido: input.issRetido === true }, pTotTribSN: input.pTotTribSN }, { client: ctx.prisma, agora: ctx.agora });
    if (!fiscal.ok) return fiscal;
    const tomador = await servicos.prepararTomadorDoCliente({ ...input, portalClientId: sessao.portalClientId }, { ...servicos, prisma: ctx.prisma, log: ctx.log });
    if (!tomador.ok) return { ...tomador, dadosColetados: { ...input, tomadorNome: tomador.tomador?.nome, tomadorEmail: tomador.tomador?.email, endereco: tomador.tomador?.endereco } };
    const retencoes = Object.fromEntries(Object.entries({ vRetIRRF: input.valorRetidoIRRF, vRetCP: input.valorRetidoPrevidencia }).filter(([, v]) => v != null));
    const obra = Object.fromEntries(Object.entries({ cObra: input.obraCnoCei, cCIB: input.obraCib, inscImobFisc: input.obraInscricaoImobiliaria }).filter(([, v]) => v != null));
    const corpo = {
      ...(Object.keys(retencoes).length ? { retencoesComplementares: retencoes } : {}),
      ...(Object.keys(obra).length ? { obra } : {}),
      ...(input.destinatarioDoc != null || input.destinatarioNome != null ? { destinatario: { cnpjCpf: input.destinatarioDoc || "", nome: input.destinatarioNome || "" } } : {}),
      companyId: sessao.portalClientId,
      ...(perfil ? { perfilId: perfil.id } : {}),
      tomador: tomador.tomador,
      servico: fiscal.servico,
      competencia: fiscal.competencia,
      ...(fiscal.pTotTribSN != null ? { pTotTribSN: fiscal.pTotTribSN } : {}),
    };
    const validacao = servicos.validateNfsePayload(corpo);
    if (!validacao.ok) return recusa(validacao.error, `A nota não pode ser montada assim: ${validacao.error}. Peça ao cliente o que falta.`);

    const dados = validacao.data;
    const extras = [
      dados.retencoesComplementares?.vRetIRRF != null ? "IRRF retido: " + fmtBRL(dados.retencoesComplementares.vRetIRRF) : null,
      dados.retencoesComplementares?.vRetCP != null ? "Previdência retida: " + fmtBRL(dados.retencoesComplementares.vRetCP) : null,
      dados.obra ? "Obra: " + (dados.obra.cObra ? "CNO/CEI " + dados.obra.cObra : "CIB " + dados.obra.cCIB) + (dados.obra.inscImobFisc ? " · Inscrição imobiliária: " + dados.obra.inscImobFisc : "") : null,
      dados.destinatario ? "Destinatário: " + dados.destinatario.nome + " · " + formatarDoc(dados.destinatario.cnpjCpf) : null,
    ].filter(Boolean).join("\n");
    const avisoIss = fiscal.aliquotaDps?.informar === false && fiscal.servico.aliquota != null
      ? "A alíquota de ISS exibida abaixo é a configurada; esse percentual não será informado como alíquota destacada nesta emissão." : null;
    const avisos = [...(fiscal.avisos || []), ...(tomador.avisos || []), avisoIss].filter(Boolean).join("\n");
    const declaracao = (avisos ? avisos + "\n\n" : "") + (extras ? extras + "\n\n" : "") + (perfil ? `Perfil de serviço: ${perfil.nome} (${perfil.codigoServicoNacional})\n\n` : "") + textoDeConfirmacao({
      tomador: { nome: dados?.tomador?.nome || input.tomadorNome, doc: dados?.tomador?.cnpjCpf || input.tomadorDoc, email: dados?.tomador?.email || input.tomadorEmail || null },
      endereco: dados?.tomador?.endereco?.cMun ? dados.tomador.endereco : null,
      servico: { descricao: dados?.servico?.descricao || input.descricao, valor: dados?.servico?.valorServicos ?? input.valor, aliquota: dados?.servico?.aliquota ?? input.aliquota ?? null, issRetido: Boolean(dados?.servico?.issRetido) },
      competencia: fiscal.competencia,
      pTotTribSN: fiscal.pTotTribSN,
      regime: fiscal.regime,
    });
    const { texto, codigo } = await servicos.criarPendencia({
      conversaId: ctx.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId,
      tipo: TIPOS.EMITIR_NFSE, payload: { ...dados, companyId: sessao.portalClientId }, corpo: declaracao, agora: ctx.agora,
    });
    ctx.registrarPendencia?.({ tipo: TIPOS.EMITIR_NFSE, codigo, texto });
    return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto, origens: { fiscal: fiscal.origens, tomador: tomador.origens }, instrucao: "O texto de confirmação será enviado ao cliente EXATAMENTE como está; diga apenas que o pedido foi montado e que ele precisa responder CONFIRMAR com o código." };
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
      const nossa = legacy ? await ctx.prisma.serviceInvoice.findFirst({ where: { id: String(input.notaId || ""), companyId: legacy }, select: { id: true, chaveAcesso: true, numeroNfse: true, status: true, tomadorDoc: true, tomadorNome: true, valorServicos: true, createdAt: true } }) : null;
      if (nossa) nota = { id: nossa.id, chaveAcesso: nossa.chaveAcesso, numero: nossa.numeroNfse, status: nossa.status, statusEfetivo: nossa.status, papel: "EMIT", type: "NFSE", tomadorDoc: nossa.tomadorDoc, tomadorNome: nossa.tomadorNome, emitenteDoc: null, total: nossa.valorServicos, issueDate: nossa.createdAt };
    }
    if (!nota) return recusa("nota_nao_encontrada", "Não encontrei essa nota na empresa.");
    // ⚠ DUAS FONTES para "recebida", como na rota (`client/index.js`, "nota_recebida"): a coluna
    // `papel` E a comparação de CNPJ — a segunda existe porque a primeira pode faltar na captura.
    // `papel: "EMIT"` ENCERRA a pergunta (a empresa que emite para si mesma tem tomador = ela).
    const cnpjDaEmpresa = soDigitos((await ctx.prisma.portalClient.findUnique({ where: { id: sessao.portalClientId }, select: { cnpj: true } }))?.cnpj);
    const docTomador = soDigitos(nota.tomadorDoc);
    const docEmitente = soDigitos(nota.emitenteDoc);
    const nossaEmissao = String(nota.papel || "").toUpperCase() === "EMIT";
    const recebida = !nossaEmissao && (
      String(nota.papel || "").toUpperCase() === "DEST"
      || (Boolean(cnpjDaEmpresa) && docTomador === cnpjDaEmpresa && docEmitente !== cnpjDaEmpresa)
    );
    if (recebida) return recusa("nota_recebida", "Essa nota foi emitida PARA a empresa (recebida) — quem pode cancelá-la é quem a emitiu.");
    if (String(nota.type || "NFSE").toUpperCase() !== "NFSE") return recusa("nota_nao_e_nfse", "Essa não é uma NFS-e; o cancelamento por aqui só vale para notas de serviço.");
    if (!nota.chaveAcesso) return recusa("nota_sem_chave", "Essa nota ainda não tem chave de acesso; sem ela não há o que cancelar.");
    if (String(nota.statusEfetivo || nota.status || "").toLowerCase().includes("cancel")) return recusa("nota_ja_cancelada", "Essa nota já consta como cancelada.");
    if (!servicos.motivoValido(EVENTO_CANCELAMENTO, input.cMotivo)) {
      return recusa("c_motivo_invalido", `Motivo inválido. Os aceitos são: ${motivosDoEvento(EVENTO_CANCELAMENTO).map((m) => `${m.codigo} (${m.rotulo})`).join(", ")}.`);
    }
    const just = servicos.validarJustificativa(input.justificativa);
    if (!just.ok) return recusa("justificativa_invalida", just.mensagem || `Justificativa inválida: ${just.motivo || `entre ${JUSTIFICATIVA.MIN} e ${JUSTIFICATIVA.MAX} caracteres`}.`);

    const motivo = motivosDoEvento(EVENTO_CANCELAMENTO).find((m) => String(m.codigo) === String(input.cMotivo));
    const corpo = [
      "Cancelar esta nota de serviço?",
      "",
      `• Número: ${nota.numero || "(sem número)"}`,
      `• Tomador: ${nota.tomadorNome || "(não informado)"}${nota.tomadorDoc ? ` · ${formatarDoc(nota.tomadorDoc)}` : ""}`,
      `• Valor: ${nota.total != null ? fmtBRL(nota.total) : "não informado"}`,
      `• Emissão: ${dataBR(nota.issueDate) || "não informada"}`,
      `• Motivo: ${input.cMotivo} — ${motivo?.rotulo || ""}`,
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
      "O valor atualizado e a data final de cálculo dos encargos ainda não foram apurados.",
    ].join("\n");
    const { texto, codigo } = await servicos.criarPendencia({
      conversaId: ctx.conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId,
      tipo: TIPOS.RECALCULAR_GUIA, payload: { guideId: guide.id }, corpo, agora: ctx.agora,
    });
    ctx.registrarPendencia?.({ tipo: TIPOS.RECALCULAR_GUIA, codigo, texto });
    return { ok: true, pendenciaCriada: true, codigo, textoDeConfirmacao: texto,
      calculo: { apurado: false, valorAtualizado: null, dataFinalDosEncargos: null },
      instrucao: "O texto de confirmação será enviado ao cliente exatamente como está. O cálculo ainda não foi feito. Não afirme que os encargos vão até hoje ou até o pagamento. Não prometa que o PDF futuro trará uma data ou informação que ainda não foi consultada." };
  },

  async chamar_escritorio(input, ctx) {
    ctx.registrarChamadaAoEscritorio?.({ motivo: String(input.motivo || "").slice(0, 300) });
    return { ok: true, encaminhado: true, instrucao: `Diga que a mensagem foi encaminhada ao escritório. ${expedienteDoEscritorio(ctx.agora || new Date()).mensagem} Não prometa prazo de resolução.` };
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
  const permissao = PERMISSAO_POR_FERRAMENTA[nome];
  if (ctx?.sessao?.ok && permissao && !temPermissaoAssistente(ctx.sessao, permissao)) {
    return recusa(
      "FUNCAO_NAO_LIBERADA",
      "Este número não está autorizado a usar essa função pelo WhatsApp. O escritório pode liberar o acesso no cadastro do contato.",
      { permissao },
    );
  }
  const contexto = { ...ctx, prisma: ctx.prisma || prisma, servicos: { ...SERVICOS_PADRAO, ...(ctx.servicos || {}) }, agora: ctx.agora || new Date() };
  return fn(input || {}, contexto);
}

export const NOMES = Object.freeze(DEFINICOES.map((d) => d.name));
