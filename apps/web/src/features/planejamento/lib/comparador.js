// COMPARADOR DE REGIMES — responde "qual sai mais barato", com as premissas à vista.
//
// ⚠ O QUE ESTE MÓDULO NÃO FAZ: escolher o regime. Ele calcula e ordena; a decisão é do contador, e
// depende de coisas que o simulador não vê (obrigações acessórias, crédito de ICMS do cliente,
// planejamento sucessório, risco de fiscalização). A tela chama isso de "simulação de apoio à
// decisão", nunca de parecer.

import { custoAnualSimples, anexoPorFatorR, folhaParaFatorR, rbt12InicioAtividade } from "./simplesNacional";
import { custoAnualPresumido } from "./lucroPresumido";
import { PIS_COFINS_NAO_CUMULATIVO, IRPJ, CSLL_ALIQUOTA, ENCARGOS_FOLHA, FONTES_VERIFICADAS_EM } from "./tabelasFiscais";

/**
 * LUCRO REAL — FONTES_FISCAIS §3.
 *
 * ⚠ DEPENDE DE DOIS DADOS QUE O SISTEMA NÃO PODE PRESUMIR: a margem real e o volume de créditos de
 * PIS/COFINS sobre insumos. Sem eles não há resultado — devolve `indisponivel` com o que falta, em
 * vez de um número que pareceria comparável e não seria. Foi para isso que o documento de fontes
 * abriu um alerta de escopo.
 */
export function custoAnualReal({ receitaAnual, margemLucro = null, creditosPisCofins = null, folhaAnual = 0, aliquotaIss = null }) {
  if (margemLucro == null || creditosPisCofins == null) {
    return {
      regime: "Lucro Real",
      indisponivel: true,
      faltam: [
        margemLucro == null ? "a margem de lucro real (lucro ÷ receita)" : null,
        creditosPisCofins == null ? "o valor anual de créditos de PIS/COFINS sobre insumos" : null,
      ].filter(Boolean),
      motivo: "O Lucro Real não se estima: sem a margem e os créditos, qualquer número aqui seria chute.",
    };
  }

  const receita = Number(receitaAnual) || 0;
  const lucro = receita * Number(margemLucro);
  const irpj = lucro * IRPJ.aliquota;
  const adicional = Math.max(0, lucro / 4 - IRPJ.limiteAdicionalTrimestral) * IRPJ.adicional * 4;
  const csll = lucro * CSLL_ALIQUOTA;
  const pisCofinsBruto = receita * PIS_COFINS_NAO_CUMULATIVO.total;
  // Crédito não gera saldo negativo de imposto na simulação: o que passa vira crédito acumulado,
  // que é outro assunto (e outro fluxo de caixa).
  const pisCofins = Math.max(0, pisCofinsBruto - Number(creditosPisCofins));
  // ⚠ Folha `null` = NÃO INFORMADA. Mesma regra do Presumido: a CPP sai da soma e a falta viaja em
  // `naoConsiderado`, porque zerá-la barateia o regime em 20% da folha por ausência de dado.
  const folhaInformada = folhaAnual != null && Number.isFinite(Number(folhaAnual));
  const cpp = folhaInformada ? Number(folhaAnual) * ENCARGOS_FOLHA.cppPatronal : 0;
  const iss = aliquotaIss == null ? 0 : receita * Number(aliquotaIss);
  const total = irpj + adicional + csll + pisCofins + cpp + iss;

  return {
    regime: "Lucro Real",
    porTributo: { irpj, adicionalIrpj: adicional, csll, pisCofins, ...(folhaInformada ? { cpp } : {}), ...(aliquotaIss == null ? {} : { iss }) },
    total,
    cargaEfetiva: receita > 0 ? total / receita : null,
    premissas: [
      `Margem de lucro informada: ${(Number(margemLucro) * 100).toFixed(1).replace(".", ",")}%`,
      `PIS/COFINS não cumulativo (9,25%) menos ${brl(creditosPisCofins)} de créditos informados`,
      "Compensação de prejuízos fiscais NÃO considerada (trava de 30% — Lei 9.065/1995, art. 15)",
    ],
    naoConsiderado: [
      folhaInformada
        ? null
        : "CPP (INSS patronal de 20% sobre a folha): a folha de 12 meses não foi informada — não estimada aqui, então este total está subestimado",
      "Compensação de prejuízo fiscal acumulado",
      "ICMS e substituição tributária",
    ].filter(Boolean),
  };
}

/**
 * Compara os regimes viáveis e ordena do mais barato ao mais caro.
 *
 * ⚠ `anexoSimples` pode vir do FATOR R quando a atividade está sujeita a ele (§ 5º-M): aí o anexo
 * não é escolha, é consequência da folha — e o resultado traz a margem, porque é o alavancador de
 * planejamento mais direto que existe no Simples.
 *
 * ⚠ `mesesDeAtividade` (1 a 12) SUBSTITUI o RBT12 informado pelo proporcionalizado da regra de
 * início de atividade — e substitui também o que entra no FATOR R, que se calcula sobre o RBT12
 * (§ 5º-J). Deixar o Fator R com o RBT12 vazio da empresa nova daria "sem fator" numa tela que
 * acabou de conseguir calcular o anexo.
 */
export function compararRegimes({
  receitaAnual, rbt12 = null, folhaAnual = 0,
  anexoSimples = null, sujeitoAoFatorR = false,
  atividadePresumido = "servicos", aliquotaIss = null,
  margemLucro = null, creditosPisCofins = null,
  mesesDeAtividade = null, receitasMensais = null,
  anoBase = 2026,
}) {
  const inicio = mesesDeAtividade == null
    ? null
    : rbt12InicioAtividade({
      mesesDeAtividade,
      receitasMensais,
      receitaMensalMedia: (Number(receitaAnual) || 0) / 12,
    });

  const rbt = inicio ? inicio.rbt12 : (rbt12 == null ? receitaAnual : rbt12);

  // Sujeito ao Fator R: o anexo sai da folha, não de uma escolha.
  const anexoResolvido = sujeitoAoFatorR ? anexoPorFatorR(folhaAnual, rbt) : anexoSimples;

  // ⚠⚠ RECUSA, NÃO ANEXO V. Atividade sujeita ao Fator R com folha NÃO INFORMADA não tem anexo
  // resolvível: `folha/rbt` não existe. Antes desta guarda o caminho era silencioso e caro —
  // `Number(null) || 0` dava Fator R 0,00%, `anexoPorFatorR` respondia "V" (a alíquota maior), o
  // card do Simples exibia um total plausível e o comparativo coroava um vencedor a partir de um
  // número que ninguém informou. O `indisponivel` faz o `CardRegime` mostrar a PERGUNTA no lugar do
  // valor, com o mesmo peso visual — que é a regra do módulo para número ausente.
  const faltaFolhaParaFatorR = sujeitoAoFatorR && !anexoResolvido
    && (folhaAnual == null || !Number.isFinite(Number(folhaAnual)));

  const simplesSemFolha = faltaFolhaParaFatorR
    ? {
      regime: "Simples Nacional",
      indisponivel: true,
      faltam: ["a folha dos últimos 12 meses, com pró-labore e encargos"],
      motivo: "A atividade é sujeita ao Fator R: o anexo (III ou V) sai da folha ÷ RBT12, e a folha "
        + "não foi informada. Tratar a ausência como zero levaria ao Anexo V, que é a alíquota maior — "
        + "e mudaria o regime recomendado sem que ninguém tivesse informado a folha.",
    }
    : null;

  const simples = simplesSemFolha || (anexoResolvido
    // ⚠ `aliquotaIss` vai para os TRÊS regimes, como já ia para o Presumido e o Real. No Simples ela
    // só produz efeito na 6ª faixa, onde o ISS saiu do DAS (art. 13-A) — abaixo dela o ISS está
    // dentro do DAS e o motor a ignora. Não passá-la aqui comparava um Simples sem ISS com um
    // Presumido com ISS, e a diferença chegava a inverter o vencedor.
    ? custoAnualSimples({ anexoChave: anexoResolvido, rbt12: rbt, receitaAnual, folhaAnual, aliquotaIss, mesesDeAtividade, receitasMensais })
    : null);
  const presumido = custoAnualPresumido({ receitaAnual, atividade: atividadePresumido, folhaAnual, aliquotaIss, anoBase });
  const real = custoAnualReal({ receitaAnual, margemLucro, creditosPisCofins, folhaAnual, aliquotaIss });

  const candidatos = [simples, presumido, real].filter(Boolean);
  const comparaveis = candidatos.filter((c) => !c.indisponivel && c.elegivel !== false);
  comparaveis.sort((a, b) => a.total - b.total);

  const vencedor = comparaveis[0] || null;
  const segundo = comparaveis[1] || null;

  return {
    // A tela MOSTRA esta data: simulação sem vigência envelhece calada, e 2026 mudou três vezes.
    fontesVerificadasEm: FONTES_VERIFICADAS_EM,
    anoBase,
    regimes: candidatos,
    vencedor,
    // A economia só existe se houver com quem comparar — com um regime só, não há "economia".
    economiaAnual: vencedor && segundo ? segundo.total - vencedor.total : null,
    fatorR: sujeitoAoFatorR ? folhaParaFatorR(folhaAnual, rbt) : null,
    anexoResolvido,
    // A tela precisa DIZER que o RBT12 virou premissa — ver requisito 4 do módulo.
    inicioAtividade: inicio,
    // ⚠ Aviso obrigatório: o produto entrega simulação de apoio, não parecer tributário.
    aviso: "Simulação de apoio à decisão, com base nas tabelas vigentes. Não substitui análise tributária.",
  };
}

/**
 * PONTO DE EQUILÍBRIO — a receita em que dois regimes empatam.
 *
 * ⚠ Busca numérica, não fórmula fechada: a carga do Simples é degrau (faixas do RBT12) e a do
 * Presumido tem quebra na majoração da LC 224 e no adicional de IRPJ. Uma fórmula única só valeria
 * dentro de uma faixa, e daria resposta errada exatamente na virada — que é onde a pergunta importa.
 *
 * Devolve `null` quando não há cruzamento no intervalo: dizer "empata em R$ X" sem que empate seria
 * pior que dizer que não empata.
 */
export function pontoDeEquilibrio({ de = 100_000, ate = 4_800_000, passo = 10_000, ...args }) {
  let anterior = null;
  // ⚠ A SÉRIE MENSAL NÃO ENTRA NA VARREDURA. Ela descreve o cenário real; aqui a receita é
  // hipótese que varia a cada passo, e uma série fixa contra uma receita variável descreveria duas
  // empresas diferentes no mesmo cálculo. O regime de início de atividade continua valendo, sob a
  // premissa de receita uniforme — que é o que a varredura sabe representar.
  const { receitasMensais: _serieDoCenario, ...varredura } = args;

  for (let receita = de; receita <= ate; receita += passo) {
    const r = compararRegimes({ ...varredura, receitaAnual: receita, rbt12: receita });
    const s = r.regimes.find((x) => x.regime === "Simples Nacional");
    const p = r.regimes.find((x) => x.regime === "Lucro Presumido");
    // `elegivel === false` não tem `total`: sem esta guarda a subtração vira NaN e o sinal do
    // cruzamento passa a ser NaN em silêncio, devolvendo "não empata" onde há empate.
    if (!s || !p || s.indisponivel || p.indisponivel || s.elegivel === false || p.elegivel === false) continue;
    const sinal = Math.sign(s.total - p.total);
    if (anterior != null && sinal !== 0 && sinal !== anterior) {
      return {
        receita,
        // A frase-resposta, não só o número: é ela que o contador leva para a reunião.
        frase: sinal > 0
          ? `Acima de aproximadamente ${brl(receita)} de receita anual, o Lucro Presumido passa a compensar.`
          : `Acima de aproximadamente ${brl(receita)} de receita anual, o Simples Nacional passa a compensar.`,
      };
    }
    if (sinal !== 0) anterior = sinal;
  }
  return null;
}

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
