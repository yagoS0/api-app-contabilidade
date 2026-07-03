// Q15.3 — Simulação e transmissão da declaração PGDAS-D (TRANSDECLARACAO11).
//
// Monta o payload `declaracao` conforme o mapa oficial do Integra Contador:
//   - identificação: cnpjCompleto, pa, indicadorTransmissao, indicadorComparacao
//   - declaracao.tipoDeclaracao (1=original | 2=retificadora)
//   - receitas do PA: receitaPaCompetenciaInterno/Externo + receitaPaCaixaInterno/Externo
//     (regime de caixa preenche os dois pares) + valorFixoIcms/Iss
//   - receitasBrutasAnteriores[]: 12× {pa, valorInterno, valorExterno} (RBT12)
//   - folhasSalario[]: série mensal pro Fator-R
//   - estabelecimentos[].atividades[]: receita por atividade (idAtividade) + qualificações
//
// O que NÃO se envia (a RFB calcula e devolve): alíquota, faixa, III↔V, repartição,
// valor do DAS. Voltam no retorno.
//
// ⚠ Nomes de campo do payload conforme doc; CONFIRMAR no ambiente trial antes de
// transmitir em produção (uma chamada com indicadorTransmissao:false valida a estrutura).
//
// Reusa SerproPgdasdService.transmitirDeclaracao (mesmo idServico TRANSDECLARACAO11,
// mesmo endpoint /Declarar) — a diferença é só o indicadorTransmissao do payload.

import { normalizeCompetencia } from "../../guides/guideContract.js";
import { SerproPgdasdService } from "./SerproPgdasdService.js";

function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }
// pa é NUMBER no payload (AAAAMM). "2021-01" → 202101
function paNum(comp) { return Number(String(comp || "").replace("-", "")); }
function round2(n) { return +Number(n || 0).toFixed(2); }

export class PgdasSimulacaoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Monta o objeto `declaracao` do payload TRANSDECLARACAO11.
 *
 * @param {Object} opts
 * @param {string} opts.contribuinteCnpj  — CNPJ da empresa (cnpjCompleto)
 * @param {string} opts.competencia       — YYYY-MM
 * @param {boolean} opts.indicadorTransmissao — false = só calcula (simulação)
 * @param {"COMPETENCIA"|"CAIXA"} opts.regimeApuracao
 * @param {number} opts.tipoDeclaracao    — 1 original | 2 retificadora
 * @param {Array}  opts.atividades        — [{ idAtividade, valorInterno, valorExterno, qualificacoes? }]
 * @param {Array}  opts.receitasBrutasAnteriores — [{ pa, valorInterno, valorExterno }] (12 meses)
 * @param {Array}  opts.folhasSalario     — [{ pa, valor }] série mensal pro Fator-R
 * @param {Object} [opts.valorFixo]       — { icms, iss }
 * @returns {Object} payload `declaracao`
 */
export function buildDeclaracaoPayload({
  contribuinteCnpj, competencia, indicadorTransmissao, regimeApuracao = "COMPETENCIA",
  tipoDeclaracao = 1, atividades = [], receitasBrutasAnteriores = [], folhasSalario = [],
  valorFixo = {},
}) {
  const cnpjCompleto = onlyDigits(contribuinteCnpj);
  const pa = paNum(competencia);

  // Cabeçalho: receita bruta total do PA por mercado. A segregação interno/externo
  // NO NÍVEL DE ATIVIDADE é feita pelo próprio idAtividade (ex: 1=interno, 3=exterior),
  // não por flag dentro de receitasAtividade.
  const receitaInterna = round2(atividades.reduce((s, a) => s + Number(a.valorInterno || 0), 0));
  const receitaExterna = round2(atividades.reduce((s, a) => s + Number(a.valorExterno || 0), 0));
  const isCaixa = String(regimeApuracao).toUpperCase() === "CAIXA";

  // Cada atividade já é mercado-específica (via idAtividade). valorAtividade = o que houver.
  const estabelecimento = {
    cnpjCompleto,
    atividades: atividades
      .map((a) => {
        const valor = round2(Number(a.valorInterno || 0) + Number(a.valorExterno || 0));
        if (valor <= 0) return null;
        return {
          idAtividade: a.idAtividade,
          valorAtividade: valor,
          receitasAtividade: [{
            valor,
            // qualificações tributárias (ST, monofásico, etc) entram aqui quando houver
            ...(Array.isArray(a.qualificacoesTributarias) && a.qualificacoesTributarias.length
              ? { qualificacoesTributarias: a.qualificacoesTributarias } : {}),
            ...(Array.isArray(a.isencoes) && a.isencoes.length ? { isencoes: a.isencoes } : {}),
            ...(Array.isArray(a.reducoes) && a.reducoes.length ? { reducoes: a.reducoes } : {}),
          }],
        };
      })
      .filter(Boolean),
  };

  const declaracao = {
    tipoDeclaracao,
    receitaPaCompetenciaInterno: receitaInterna,
    receitaPaCompetenciaExterno: receitaExterna,
    // caixa preenche os dois pares; competência deixa caixa como null (campo opcional)
    receitaPaCaixaInterno: isCaixa ? receitaInterna : null,
    receitaPaCaixaExterno: isCaixa ? receitaExterna : null,
    // valorFixo é opcional e "deve ser maior que zero" → só envia se > 0, senão null
    valorFixoIcms: Number(valorFixo.icms) > 0 ? round2(valorFixo.icms) : null,
    valorFixoIss: Number(valorFixo.iss) > 0 ? round2(valorFixo.iss) : null,
    // Lista vazia → OMITE o campo (mesmo padrão do folhasSalario): a RFB só aceita meses que ela
    // NÃO tem declarados; empresa com histórico completo converge pra lista vazia.
    ...(receitasBrutasAnteriores.length
      ? {
          receitasBrutasAnteriores: receitasBrutasAnteriores.map((r) => ({
            pa: paNum(r.pa),
            valorInterno: round2(r.valorInterno),
            valorExterno: round2(r.valorExterno),
          })),
        }
      : {}),
    // Lista vazia → OMITE o campo: a RFB trata folhasSalario presente como "lista informada" e
    // rejeita quando nenhuma atividade exige Fator-R ("SN-Entregar: Foi informada a lista de Folha…").
    ...(folhasSalario.length
      ? { folhasSalario: folhasSalario.map((f) => ({ pa: paNum(f.pa), valor: round2(f.valor) })) }
      : {}),
    estabelecimentos: [estabelecimento],
  };

  return {
    cnpjCompleto,
    pa,
    indicadorTransmissao: Boolean(indicadorTransmissao),
    // false: deixa a RFB calcular sem exigir valoresParaComparacao exatos.
    // (com true, regra (f) exige a lista de valores idêntica ao cálculo — não temos.)
    indicadorComparacao: false,
    declaracao,
  };
}

/**
 * Parseia o retorno oficial da RFB (simulação ou transmissão).
 * Campos calculados pela RFB: valor devido por tributo, alíquota efetiva, RBT12, DAS.
 */
// Códigos de tributo do PGDAS-D (pra rótulo do detalhamento)
const COD_TRIBUTO = {
  1001: "IRPJ", 1002: "CSLL", 1004: "COFINS", 1005: "PIS",
  1006: "CPP", 1007: "ICMS", 1008: "IPI", 1010: "ISS",
};

export function parseRetornoSimulacao(raw) {
  // O retorno tem `dados` (string JSON) com idDeclaracao, valoresDevidos[], PDFs.
  // (não há "valorTotalDevido" nem RBT12 no retorno — DAS = soma de valoresDevidos.)
  let dados = raw?.dados ?? raw?.dadosSaida;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { dados = null; }
  }
  // dados pode ser objeto único ou array com 1 DeclaracaoTransmitida
  const decl = Array.isArray(dados) ? dados[0] : dados;

  const valoresDevidos = Array.isArray(decl?.valoresDevidos) ? decl.valoresDevidos : [];
  const dasValor = valoresDevidos.length
    ? round2(valoresDevidos.reduce((s, v) => s + Number(v.valor || 0), 0))
    : null;
  const tributos = valoresDevidos.map((v) => ({
    codigo: v.codigoTributo,
    nome: COD_TRIBUTO[v.codigoTributo] || String(v.codigoTributo),
    valor: Number(v.valor || 0),
  }));
  const numeroDeclaracao = decl?.idDeclaracao ?? null;
  const dataHoraTransmissao = decl?.dataHoraTransmissao ?? null;
  const mensagens = raw?.mensagens ?? [];
  return {
    dasValor,
    rbt12: null, // RBT12 não vem no retorno — é o que NÓS enviamos em receitasBrutasAnteriores
    numeroDeclaracao, dataHoraTransmissao,
    tributos, mensagens, raw: decl,
  };
}

export class PgdasSimulacaoService {
  constructor(options = {}) {
    this.pgdas = options.pgdasService || new SerproPgdasdService();
  }

  /**
   * Simulação: indicadorTransmissao=false → cálculo oficial SEM transmitir.
   * É a "verdade" do botão [Calcular] do FechamentoModal.
   */
  async simular({ contratanteCnpj, contribuinteCnpj, competencia, regimeApuracao,
    atividades, receitasBrutasAnteriores, folhasSalario, valorFixo, tipoDeclaracao = 1 }) {
    return this._executar({
      contratanteCnpj, contribuinteCnpj, competencia, regimeApuracao,
      atividades, receitasBrutasAnteriores, folhasSalario, valorFixo, tipoDeclaracao,
      indicadorTransmissao: false,
    });
  }

  /**
   * Transmissão oficial: indicadorTransmissao=true → declara de fato (gera DAS).
   */
  async transmitir({ contratanteCnpj, contribuinteCnpj, competencia, regimeApuracao,
    atividades, receitasBrutasAnteriores, folhasSalario, valorFixo, tipoDeclaracao = 1 }) {
    return this._executar({
      contratanteCnpj, contribuinteCnpj, competencia, regimeApuracao,
      atividades, receitasBrutasAnteriores, folhasSalario, valorFixo, tipoDeclaracao,
      indicadorTransmissao: true,
    });
  }

  async _executar(opts) {
    const competencia = normalizeCompetencia(opts.competencia);
    if (!competencia) throw new PgdasSimulacaoError("INVALID_COMPETENCIA", "competência YYYY-MM inválida");
    if (!Array.isArray(opts.atividades) || opts.atividades.length === 0) {
      throw new PgdasSimulacaoError("NO_ATIVIDADES", "Sem atividades pra declarar — classifique/segregue a receita.");
    }
    const declaracao = buildDeclaracaoPayload({
      contribuinteCnpj: opts.contribuinteCnpj,
      competencia,
      indicadorTransmissao: opts.indicadorTransmissao,
      regimeApuracao: opts.regimeApuracao,
      tipoDeclaracao: opts.tipoDeclaracao,
      atividades: opts.atividades,
      receitasBrutasAnteriores: opts.receitasBrutasAnteriores || [],
      folhasSalario: opts.folhasSalario || [],
      valorFixo: opts.valorFixo || {},
    });

    const raw = await this.pgdas.transmitirDeclaracao({
      contratanteCnpj: opts.contratanteCnpj,
      contribuinteCnpj: opts.contribuinteCnpj,
      periodoApuracao: competencia,
      declaracao,
    });

    const parsed = parseRetornoSimulacao(raw);
    return { ...parsed, indicadorTransmissao: opts.indicadorTransmissao, payloadEnviado: declaracao };
  }
}
