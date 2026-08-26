// O COMPARATIVO LADO A LADO — quatro colunas, e a composição por tributo.
//
// Pedido do dono, na avaliação de 25/08/2026: *"Quatro colunas lado a lado (Simples III · Simples V
// · Presumido · Real), com total anual, alíquota efetiva e composição por tributo. No Presumido,
// decompor (…) mais INSS patronal (~26–29%) sobre a folha — que no Simples está dentro do DAS."*
//
// ⚠⚠ E ELE APONTOU A COISA CERTA: **é a CPP que explica por que "Presumido compensa acima de
// R$ 1,25 mi" não se sustenta para uma prestadora com folha.** No Simples (anexos I, II, III e V) a
// contribuição patronal está DENTRO do DAS; no Presumido ela é 20% da folha POR FORA. Os dois
// totais já somam isso corretamente — o que faltava era a tela MOSTRAR, porque um contador não
// confia num total cuja composição ele não vê.
//
// ⚠ NADA AQUI CALCULA IMPOSTO. Este módulo REARRANJA o que `compararRegimes` já produziu. Uma
// segunda conta na camada de apresentação divergiria do motor na primeira correção — e é o motor
// que decide o número que vai ao PDF.
//
// ── AS TRÊS REGRAS DE HONESTIDADE DA TABELA ───────────────────────────────────────────────────
//
// 1. ⚠⚠ **CÉLULA VAZIA É PROIBIDA.** Numa tabela de custo, branco se lê como ZERO. Todo tributo
//    ausente numa coluna sai com um MOTIVO nomeado: "dentro do DAS", "não se aplica a este regime",
//    "não estimado — falta dado". São três fatos diferentes e o contador decide diferente com cada.
// 2. ⚠ **COLUNA SEM NÚMERO MOSTRA A RECUSA COM O MESMO PESO.** Regime indisponível ou inelegível
//    não vira traço discreto: é a regra do `CardRegime` ("número ausente diagramado em cinza vira
//    ausência de dúvida"), e ela vale igual aqui.
// 3. ⚠ **O QUE FICOU DE FORA VIAJA POR COLUNA.** `naoConsiderado` não é rodapé geral: o ISS falta
//    no Presumido e não no Simples abaixo do sublimite, e somar as ressalvas num bloco só faria o
//    contador atribuí-las à coluna errada.

import { custoAnualSimples } from "./simplesNacional";

/** A ordem em que os tributos aparecem — a do DARF/DAS, não a alfabética. */
const ORDEM_DOS_TRIBUTOS = Object.freeze([
  "irpj", "adicionalIrpj", "csll", "pis", "cofins", "pisCofins", "cpp", "iss", "icms", "ipi",
]);

export const ROTULO_DO_TRIBUTO = Object.freeze({
  irpj: "IRPJ",
  adicionalIrpj: "Adicional de IRPJ",
  csll: "CSLL",
  pis: "PIS",
  cofins: "COFINS",
  pisCofins: "PIS + COFINS",
  cpp: "CPP (INSS patronal)",
  iss: "ISS",
  icms: "ICMS",
  ipi: "IPI",
});

/** Por que uma célula não tem número. ⚠ Três motivos, três consertos diferentes. */
export const AUSENCIA = Object.freeze({
  /** O tributo existe no regime e está EMBUTIDO noutro valor. Não é zero. */
  DENTRO_DO_DAS: "dentro_do_das",
  /** O regime não tem esse tributo. Aí zero é a verdade. */
  NAO_SE_APLICA: "nao_se_aplica",
  /** Falta dado de entrada — o total está SUBESTIMADO, e a tabela diz isso. */
  NAO_ESTIMADO: "nao_estimado",
});

const FRASE_DA_AUSENCIA = Object.freeze({
  [AUSENCIA.DENTRO_DO_DAS]: "dentro do DAS",
  [AUSENCIA.NAO_SE_APLICA]: "não se aplica",
  [AUSENCIA.NAO_ESTIMADO]: "não estimado",
});

export const fraseDaAusencia = (motivo) => FRASE_DA_AUSENCIA[motivo] || null;

/** ⚠ `naoConsiderado` fala em palavras; aqui se pergunta se ELE cobre o tributo desta célula. */
function ausenciaPorFaltaDeDado(coluna, tributo) {
  const texto = (coluna.naoConsiderado || []).join(" ").toLowerCase();
  if (tributo === "iss" && texto.includes("iss")) return true;
  if (tributo === "cpp" && texto.includes("cpp")) return true;
  if (tributo === "icms" && texto.includes("icms")) return true;
  return false;
}

/**
 * O que vai numa célula (coluna × tributo).
 *
 * @returns {{valor: number|null, ausencia: string|null}}
 */
export function celulaDoTributo(coluna, tributo) {
  const v = coluna?.porTributo?.[tributo];
  if (typeof v === "number" && Number.isFinite(v)) return { valor: v, ausencia: null };

  // ⚠⚠ FALTA DE DADO VEM ANTES DE "NÃO SE APLICA", e a ordem importa: um ISS que ficou de fora por
  // falta da alíquota do município NÃO é um ISS que o regime não cobra. Confundir os dois faria o
  // total parecer completo justamente onde ele está subestimado.
  if (ausenciaPorFaltaDeDado(coluna, tributo)) return { valor: null, ausencia: AUSENCIA.NAO_ESTIMADO };

  // ⚠ No Simples a CPP está DENTRO do DAS — e ela aparece na partilha, então quase sempre há
  // número. Este ramo cobre o Anexo IV (CPP por fora) sem folha e casos afins.
  if (tributo === "cpp" && coluna?.regime === "Simples Nacional") {
    return { valor: null, ausencia: AUSENCIA.DENTRO_DO_DAS };
  }
  return { valor: null, ausencia: AUSENCIA.NAO_SE_APLICA };
}

/**
 * As colunas do comparativo.
 *
 * ⚠⚠ COM FATOR R, O SIMPLES VIRA DUAS COLUNAS — e é o pedido do dono. A pergunta que ele faz não é
 * "quanto custa o Simples", é "quanto custa ficar no III em vez de cair no V": a diferença entre os
 * dois é a maior alavanca isolada de uma prestadora de serviços, e some quando se mostra só o
 * anexo resolvido.
 *
 * @param {object} resultado — o de `compararRegimes`.
 * @param {object} entradas — o mesmo objeto passado ao motor (para recalcular III e V).
 */
export function montarComparativo(resultado, entradas = {}) {
  if (!resultado || !Array.isArray(resultado.regimes)) return null;

  const doMotor = (nome) => resultado.regimes.find((r) => r.regime === nome) || null;
  const simples = doMotor("Simples Nacional");
  const presumido = doMotor("Lucro Presumido");
  const real = doMotor("Lucro Real");

  const colunas = [];

  // ── SIMPLES ─────────────────────────────────────────────────────────────────────────────────
  if (entradas.sujeitoAoFatorR) {
    const comum = {
      rbt12: entradas.rbt12,
      receitaAnual: entradas.receitaAnual,
      folhaAnual: entradas.folhaAnual,
      aliquotaIss: entradas.aliquotaIss,
      mesesDeAtividade: entradas.mesesDeAtividade,
      receitasMensais: entradas.receitasMensais,
    };
    for (const chave of ["III", "V"]) {
      const r = custoAnualSimples({ ...comum, anexoChave: chave });
      colunas.push({
        chave: `simples${chave}`,
        titulo: `Simples — Anexo ${chave}`,
        // ⚠ Qual dos dois o Fator R resolveu fica MARCADO. Duas colunas sem essa marca fariam o
        // contador achar que ele escolhe — e no Fator R o anexo sai da folha, não da escolha.
        atual: resultado.anexoResolvido === chave,
        ...(r || { indisponivel: true, motivo: "Não foi possível calcular este anexo." }),
        regime: "Simples Nacional",
      });
    }
  } else if (simples) {
    colunas.push({
      chave: "simples",
      titulo: simples.anexo ? `Simples — ${simples.anexo}` : "Simples Nacional",
      atual: true,
      ...simples,
    });
  }

  if (presumido) colunas.push({ chave: "presumido", titulo: "Lucro Presumido", atual: true, ...presumido });
  if (real) colunas.push({ chave: "real", titulo: "Lucro Real", atual: true, ...real });

  // ── OS TRIBUTOS QUE APARECEM ────────────────────────────────────────────────────────────────
  const presentes = new Set();
  for (const c of colunas) for (const t of Object.keys(c.porTributo || {})) presentes.add(t);
  // ⚠ A CPP ENTRA MESMO QUE NENHUMA COLUNA A TRAGA COMO NÚMERO. Ela é a linha que responde à
  // pergunta do dono ("por que o Presumido não compensa para quem tem folha?"), e uma linha ausente
  // não responde nada. Sem número, cada célula diz POR QUE não tem.
  presentes.add("cpp");
  const tributos = ORDEM_DOS_TRIBUTOS.filter((t) => presentes.has(t));

  // ⚠ O vencedor sai do MOTOR, não de uma segunda ordenação aqui — duas ordenações divergiriam.
  const totalVencedor = resultado.vencedor?.total ?? null;

  return {
    colunas: colunas.map((c) => ({
      ...c,
      // ⚠ Só a coluna comparável pode ser "a mais barata". Indisponível não compete.
      vencedora: !c.indisponivel && c.elegivel !== false && totalVencedor != null
        && Math.abs(c.total - totalVencedor) < 0.005,
    })),
    tributos,
    // ⚠ Repassado, não recalculado.
    fontesVerificadasEm: resultado.fontesVerificadasEm,
    anoBase: resultado.anoBase,
  };
}
