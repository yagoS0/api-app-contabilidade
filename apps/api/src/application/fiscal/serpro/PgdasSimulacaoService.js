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
function paFromCompetencia(comp) { return String(comp || "").replace("-", ""); } // YYYY-MM → YYYYMM
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
  const pa = paFromCompetencia(competencia);

  // Soma das receitas das atividades = receita bruta do PA (interna/externa)
  const receitaInterna = round2(atividades.reduce((s, a) => s + Number(a.valorInterno || 0), 0));
  const receitaExterna = round2(atividades.reduce((s, a) => s + Number(a.valorExterno || 0), 0));
  const isCaixa = String(regimeApuracao).toUpperCase() === "CAIXA";

  // Estabelecimento único (matriz) no MVP — estrutura já é array pra multi-filial futuro.
  const estabelecimento = {
    cnpjCompleto,
    atividades: atividades.map((a) => ({
      idAtividade: a.idAtividade,
      // valor por atividade segregado por mercado
      valorAtividade: round2(Number(a.valorInterno || 0) + Number(a.valorExterno || 0)),
      receitasAtividade: [
        ...(Number(a.valorInterno || 0) > 0
          ? [{ valor: round2(a.valorInterno), tipoMercado: 1, /* interno */ qualificacoes: a.qualificacoes || [] }]
          : []),
        ...(Number(a.valorExterno || 0) > 0
          ? [{ valor: round2(a.valorExterno), tipoMercado: 2, /* externo */ qualificacoes: a.qualificacoes || [] }]
          : []),
      ],
    })),
  };

  return {
    cnpjCompleto,
    pa,
    indicadorTransmissao: Boolean(indicadorTransmissao),
    indicadorComparacao: true,
    declaracao: {
      tipoDeclaracao,
      // regime: competência preenche *Competencia*, caixa preenche os DOIS pares
      receitaPaCompetenciaInterno: receitaInterna,
      receitaPaCompetenciaExterno: receitaExterna,
      ...(isCaixa
        ? { receitaPaCaixaInterno: receitaInterna, receitaPaCaixaExterno: receitaExterna }
        : { receitaPaCaixaInterno: 0, receitaPaCaixaExterno: 0 }),
      valorFixoIcms: round2(valorFixo.icms || 0),
      valorFixoIss: round2(valorFixo.iss || 0),
      receitasBrutasAnteriores: receitasBrutasAnteriores.map((r) => ({
        pa: paFromCompetencia(r.pa),
        valorInterno: round2(r.valorInterno),
        valorExterno: round2(r.valorExterno),
      })),
      folhasSalario: folhasSalario.map((f) => ({ pa: paFromCompetencia(f.pa), valor: round2(f.valor) })),
      estabelecimentos: [estabelecimento],
    },
  };
}

/**
 * Parseia o retorno oficial da RFB (simulação ou transmissão).
 * Campos calculados pela RFB: valor devido por tributo, alíquota efetiva, RBT12, DAS.
 */
export function parseRetornoSimulacao(raw) {
  let dadosSaida = raw?.dadosSaida;
  if (typeof dadosSaida === "string") {
    try { dadosSaida = JSON.parse(dadosSaida); } catch { /* mantém */ }
  }
  const dasValor =
    dadosSaida?.valorTotalDevido ?? dadosSaida?.valorDevidoDAS ?? dadosSaida?.valorTotal ?? null;
  const rbt12 =
    dadosSaida?.rbt12 ?? dadosSaida?.valorRbt12 ?? dadosSaida?.RBT12 ?? null;
  const numeroDeclaracao =
    dadosSaida?.numeroDeclaracao ?? dadosSaida?.numero ?? null;
  const tributos = dadosSaida?.valoresDevidos ?? dadosSaida?.tributos ?? null;
  const mensagens = raw?.mensagens ?? dadosSaida?.mensagens ?? [];
  return { dasValor, rbt12, numeroDeclaracao, tributos, mensagens, raw: dadosSaida };
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
