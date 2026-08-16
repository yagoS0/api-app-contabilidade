// PLANEJAMENTO TRIBUTÁRIO — os dados da EMPRESA que alimentam a simulação de regime.
//
// O que este serviço faz: junta, para uma empresa, os sete números/rótulos que a tela de
// planejamento pré-preenche, **cada um com a procedência escrita**. O que ele NÃO faz:
//
//  • não escreve NADA. Nem cache, nem log, nem snapshot. Abrir um planejamento não pode mudar o
//    estado fiscal da empresa — é a mesma razão pela qual `FatorRService.decidirFatorR` foi
//    extraída sem persistência para o relatório de faturamento poder consumi-la.
//    ⚠ É por isso que aqui NÃO se chama `RbtExtratoService.getRbt12`: no caminho de fallback ela
//    faz `upsertCache` e GRAVA uma linha de `RbtExtratoCache`. Aqui o cache é apenas LIDO.
//  • não decide regime, não recomenda nada e não calcula imposto. Quem compara é o motor local da
//    tela (`apps/web/src/features/planejamento/lib/`), com as tabelas citando a lei.
//  • não inventa. Campo sem fonte volta `apurado: false` com o motivo — ver `lib/campoComOrigem.js`.
//
// ⚠⚠ FOLHA AUSENTE NÃO É ZERO. É a razão de existir deste arquivo. O Fator R (`fs12 / rbt12`)
// escolhe Anexo III ou V, e uma folha desconhecida lida como `0` derruba a empresa no V e troca o
// regime recomendado — num PDF que o contador entrega ao cliente. Todas as bases monetárias passam
// por `valorMonetario`, que trata `0` como não apurado, e o motivo está documentado lá: o caminho
// legado (`CalculoFiscal`) grava zeros fabricados em `fs12Manual`.

import { prisma } from "../../infrastructure/db/prisma.js";
import { competenciasDe12Meses, derivarFolha12m } from "../notas/apuracao/v2/FolhaDerivadaService.js";
import { whereFaturamentoEmit } from "../notas/apuracao/v2/FechamentoService.js";
import {
  apurado, ausente, valorMonetario, primeiraFonteQueResponde, competenciaBr,
} from "./lib/campoComOrigem.js";

const REGIMES = new Set(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]);
const ANEXOS_VALIDOS = new Set(["I", "II", "III", "IV", "V"]);

/** A competência de referência: o mês CORRENTE. A janela de 12 meses é a dos meses anteriores. */
export function competenciaDeHoje(agora = new Date()) {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ⚠ MAPA ESTRITO, SEM DEFAULT — e a diferença importa.
 *
 * `apuracaoV2.mapRegime` e `PerfilFiscalService` terminam em `return "SIMPLES_NACIONAL"` ("a maioria
 * das empresas do app é SN"). Para classificar nota isso é um palpite tolerável; para dizer ao
 * cliente qual é o regime ATUAL dele num comparativo, é afirmar um fato que ninguém verificou —
 * e o comparativo inteiro se lê a partir dele ("hoje você está no X, migrar para Y economiza Z").
 * Aqui, texto que não casa com nenhum padrão devolve `null`, e a tela diz que não sabe.
 */
export function regimeDoTexto(bruto) {
  const raw = String(bruto || "").toUpperCase();
  if (!raw.trim()) return null;
  if (/MEI/.test(raw)) return "MEI";
  if (/PRESUMID/.test(raw)) return "LUCRO_PRESUMIDO";
  if (/REAL/.test(raw)) return "LUCRO_REAL";
  if (/SIMPLES/.test(raw)) return "SIMPLES_NACIONAL";
  return null;
}

/** "Anexo III", "iii", "3" → "III". Fora disso, `null` — não se adivinha anexo. */
export function anexoNormalizado(bruto) {
  const raw = String(bruto || "").toUpperCase().replace(/ANEXO/g, "").replace(/[^IV1-5]/g, "");
  if (ANEXOS_VALIDOS.has(raw)) return raw;
  const porNumero = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" }[raw];
  return porNumero || null;
}

function inicioDaCompetencia(competencia) {
  const [y, m] = String(competencia).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/**
 * Os dados de UMA empresa para o planejamento tributário.
 *
 * @param {{ portalClientId: string, agora?: Date }} args
 * @returns {Promise<{ empresa, referencia, campos }>}
 */
export async function montarDadosPlanejamento({ portalClientId, agora = new Date() }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
  if (!portal) return null;

  const referencia = competenciaDeHoje(agora);
  // ⚠ A MESMA janela do Fator R, do RBT12 e da grade do FechamentoModal — importada, não reescrita.
  const janela = competenciasDe12Meses(referencia);
  const janelaRotulo = `${competenciaBr(janela[0])} a ${competenciaBr(janela[janela.length - 1])}`;

  const [cadastro, company, snapshot, circular, cacheRbt, folhaLancada] = await Promise.all([
    prisma.cadastroFiscal.findUnique({ where: { portalClientId: portal.id } }).catch(() => null),
    portal.companyId
      ? prisma.company.findUnique({
        where: { id: portal.companyId },
        select: { regimeTributario: true, simplesAnexo: true, anexoSimples: true },
      }).catch(() => null)
      : null,
    // A apuração mais recente DENTRO da janela: é dela que saem RBT12 e folha 12m já usados de
    // verdade num fechamento. Fora da janela o número descreve outro ano.
    prisma.apuracaoSnapshot.findFirst({
      where: { portalClientId: portal.id, competencia: { in: janela } },
      orderBy: { competencia: "desc" },
      select: { competencia: true, rbt12: true, folha12m: true, estado: true },
    }).catch(() => null),
    prisma.companyMonthlyCircular.findFirst({
      where: { portalClientId: portal.id, competencia: { in: janela } },
      orderBy: { competencia: "desc" },
      select: { competencia: true, rb12: true, fs12Manual: true, fs12Origem: true },
    }).catch(() => null),
    // LEITURA do cache. Nunca `getRbt12` — ela grava no caminho de fallback.
    prisma.rbtExtratoCache.findFirst({
      where: { portalClientId: portal.id, competencia: { in: janela } },
      orderBy: { competencia: "desc" },
      select: { competencia: true, rbt12: true, origem: true },
    }).catch(() => null),
    derivarFolha12m({ portalClientId: portal.id, competencia: referencia }).catch(() => null),
  ]);

  // ── RECEITA ANUAL — as notas EMIT autorizadas dos 12 meses fechados ────────────────────────────
  // Mesma população da apuração (`whereFaturamentoEmit`), outra janela. Nenhuma nota no período
  // devolve AUSENTE, não R$ 0,00: "não capturamos nota nenhuma" e "a empresa não faturou" são
  // coisas diferentes, e prefixar zero faria a segunda parecer provada.
  const agg = await prisma.portalInvoice.aggregate({
    where: {
      ...whereFaturamentoEmit(),
      clientId: portal.id,
      competencia: { gte: inicioDaCompetencia(janela[0]), lt: inicioDaCompetencia(referencia) },
    },
    _sum: { total: true },
    _count: { _all: true },
  }).catch(() => null);
  const notasNoPeriodo = Number(agg?._count?._all || 0);
  const receitaAnual = notasNoPeriodo > 0
    ? valorMonetario(
      agg?._sum?.total,
      `notas fiscais emitidas e autorizadas de ${janelaRotulo} (${notasNoPeriodo} nota${notasNoPeriodo === 1 ? "" : "s"})`,
      "Não foi possível apurar a receita: as notas do período somam zero.",
    )
    : ausente(`Não foi possível apurar a receita: nenhuma nota emitida autorizada em ${janelaRotulo}.`);

  // ── RBT12 ─────────────────────────────────────────────────────────────────────────────────────
  // Ordem de autoridade: o que já foi usado num fechamento > o cache de extrato > a circular.
  const rbt12 = primeiraFonteQueResponde([
    valorMonetario(
      snapshot?.rbt12,
      snapshot ? `apuração de ${competenciaBr(snapshot.competencia)}${snapshot.estado ? ` (${snapshot.estado})` : ""}` : null,
      "sem apuração",
    ),
    valorMonetario(
      cacheRbt?.rbt12,
      cacheRbt ? `extrato de RBT12 de ${competenciaBr(cacheRbt.competencia)} · origem ${cacheRbt.origem}` : null,
      "sem extrato",
    ),
    valorMonetario(
      circular?.rb12,
      circular ? `circular de ${competenciaBr(circular.competencia)} (soma móvel de 12 meses)` : null,
      "sem circular",
    ),
  ], "Não foi possível apurar o RBT12: nenhuma apuração, extrato ou circular com receita acumulada nos 12 meses anteriores.");

  // ── FOLHA DE 12 MESES (fs12) ──────────────────────────────────────────────────────────────────
  // ⚠ AQUI É ONDE O ZERO MATA. Ver `campoComOrigem.valorMonetario`: `fs12Manual` recebe zero
  // fabricado do caminho legado, então `0` NUNCA vira resposta. E `folhaDerivada` só conta quando
  // ela mesma se declara disponível (`disponivel` = houve lançamento de folha no período); o
  // `total: 0` que ela devolve no vazio é ausência de dado, não folha zero.
  const folhaAnual = primeiraFonteQueResponde([
    valorMonetario(
      snapshot?.folha12m,
      snapshot ? `folha de 12 meses informada no fechamento de ${competenciaBr(snapshot.competencia)}` : null,
      "sem folha no fechamento",
    ),
    valorMonetario(
      circular?.fs12Manual,
      circular ? `folha de 12 meses digitada na circular de ${competenciaBr(circular.competencia)}${circular.fs12Origem ? ` (${circular.fs12Origem})` : ""}` : null,
      "sem folha na circular",
    ),
    folhaLancada?.disponivel
      ? valorMonetario(
        folhaLancada.total,
        `soma dos lançamentos de folha/pró-labore de ${janelaRotulo} (${folhaLancada.mesesComLancamento} de 12 meses com lançamento)`,
        "lançamentos de folha somam zero",
      )
      : ausente("sem lançamento de folha"),
  ], "Não foi possível apurar a folha dos 12 meses. Sem ela o Fator R não se calcula — e um zero aqui jogaria a empresa no Anexo V sem que ninguém tivesse informado a folha.");

  // ── REGIME ATUAL ──────────────────────────────────────────────────────────────────────────────
  const regimeCadastro = REGIMES.has(String(cadastro?.regime || "")) ? String(cadastro.regime) : null;
  const regimeCompany = regimeDoTexto(company?.regimeTributario);
  const regimeAtual = primeiraFonteQueResponde([
    regimeCadastro ? apurado(regimeCadastro, "cadastro fiscal da empresa") : null,
    regimeCompany ? apurado(regimeCompany, `cadastro da empresa (regime tributário: "${company.regimeTributario}")`) : null,
  ], "Regime atual não cadastrado. Sem ele a comparação continua valendo, mas ninguém pode dizer de onde a empresa está saindo.");

  // ── SUJEITO AO FATOR R ────────────────────────────────────────────────────────────────────────
  // Booleano do cadastro fiscal ("contador confirma se tem serviços Fator R"). Sem CadastroFiscal
  // não há confirmação — e `false` por omissão faria a tela afirmar que a empresa NÃO é do Fator R.
  const sujeitoFatorR = cadastro
    ? apurado(Boolean(cadastro.usaFatorR), "cadastro fiscal da empresa (campo \"usa Fator R\")")
    : ausente("Sem cadastro fiscal não há como saber se a atividade é sujeita ao Fator R.");

  // ── ANEXO DO SIMPLES ──────────────────────────────────────────────────────────────────────────
  // ⚠ Quando a atividade é sujeita ao Fator R o anexo NÃO é cadastro: é consequência da folha, e
  // quem o resolve é o motor da tela. Por isso o campo sai ausente nesse caso, com o motivo.
  const anexoCadastro = anexoNormalizado(company?.simplesAnexo) || anexoNormalizado(company?.anexoSimples);
  const anexo = cadastro?.usaFatorR
    ? ausente("Atividade sujeita ao Fator R: o anexo sai da folha (III a partir de 28%, V abaixo), não do cadastro.")
    : primeiraFonteQueResponde([
      anexoCadastro ? apurado(anexoCadastro, "cadastro da empresa (anexo do Simples)") : null,
    ], "Anexo do Simples não cadastrado — escolha na tela. Não derivamos anexo do CNAE aqui: o de-para CNAE→anexo do projeto responde \"III ou V (Fator R)\" e \"revisar\" em boa parte dos casos.");

  // ── ALÍQUOTA DE ISS ───────────────────────────────────────────────────────────────────────────
  // ⚠ UNIDADE: `perfilAtividades[].aliquotaIss` é PERCENTUAL (a coluna da Aba Fiscal é "Alíq. ISS %",
  // com `max=10`). A tela do planejamento trabalha em FRAÇÃO. A conversão é feita aqui, uma vez —
  // fosse feita na tela, o mesmo campo teria duas leituras e um ISS de 5% viraria 500%.
  const perfil = Array.isArray(cadastro?.perfilAtividades) ? cadastro.perfilAtividades : [];
  const escolhida = perfil.find((c) => c && c.padrao && c.ativo !== false && c.aliquotaIss != null)
    || perfil.find((c) => c && c.ativo !== false && c.aliquotaIss != null)
    || null;
  const issPercentual = escolhida ? Number(escolhida.aliquotaIss) : null;
  const aliquotaIss = escolhida && Number.isFinite(issPercentual) && issPercentual > 0
    ? apurado(issPercentual / 100, `perfil de atividades — CNAE ${escolhida.cnae} (${String(issPercentual).replace(".", ",")}%)`)
    : ausente("Alíquota de ISS não informada no perfil de atividades da empresa.");

  // ── ATIVIDADE NO LUCRO PRESUMIDO ──────────────────────────────────────────────────────────────
  // ⚠ AUSENTE DE PROPÓSITO, E ISTO NÃO É PENDÊNCIA ESQUECIDA. As cinco atividades do simulador
  // (comércio/indústria, serviços, transporte de cargas, transporte de passageiros, combustíveis)
  // são as da presunção de IRPJ/CSLL (Lei 9.249/1995, arts. 15 e 20). O projeto NÃO tem de-para
  // CNAE→presunção: o único catálogo de CNAE que existe (`CnaeAnexo.tipoReceitaSugerido`) mapeia
  // para ANEXO DO SIMPLES, que é outra tabela e outra lei. Adivinhar aqui trocaria 8% por 32% de
  // presunção de IRPJ — a maior diferença isolada do comparativo. Quem escolhe é o contador.
  const atividadePresumido = ausente(
    "A atividade do Lucro Presumido não é derivada do CNAE: o projeto não tem de-para CNAE→presunção "
    + "de IRPJ/CSLL, e errar entre 8% e 32% inverteria a comparação. Escolha na tela.",
  );

  return {
    empresa: { id: portal.id, razao: portal.razao, cnpj: portal.cnpj },
    referencia: { competencia: referencia, janela, janelaRotulo },
    campos: {
      receitaAnual,
      rbt12,
      folhaAnual,
      regimeAtual,
      anexo,
      sujeitoFatorR,
      aliquotaIss,
      atividadePresumido,
    },
  };
}
