// MOTOR DO SIMPLES NACIONAL — cálculo local, para SIMULAÇÃO.
//
// ⚠ ISTO NÃO É O DAS. A verdade do DAS vem da RFB (simulação PGDAS-D), e o projeto já trata isso
// assim no módulo de Apuração. Aqui o cálculo serve para COMPARAR REGIMES: a pergunta é "quanto
// custaria no Simples × no Presumido", não "quanto vou pagar neste mês". Usar este número como
// valor a recolher seria trocar a fonte oficial por uma reimplementação.
//
// Todas as constantes vêm de `tabelasFiscais.js`, que cita o documento FONTES FISCAIS seção a seção.

import {
  ANEXOS, FATOR_R_LIMITE, LIMITES_SIMPLES, ENCARGOS_FOLHA, ISS_FAIXA_LEGAL,
} from "./tabelasFiscais";

/** A faixa do RBT12 dentro de um anexo. Acima do teto de EPP não há faixa — a empresa não pode optar. */
export function faixaDoRbt12(anexo, rbt12) {
  const v = Number(rbt12) || 0;
  return anexo.faixas.find((f) => v >= f.de - 0.005 && v <= f.ate) || null;
}

/**
 * ALÍQUOTA EFETIVA — FONTES_FISCAIS §1.2 (LC 123/2006, art. 18, §§ 1º e 1º-A):
 *
 *     [(RBT12 × ALIQ_nominal) − PD] / RBT12
 *
 * ⚠ RBT12 ZERO não tem alíquota efetiva: a fórmula divide por ele. Empresa nova (menos de 13 meses)
 * exige a proporcionalização do art. 18, § 2º — que depende de quantos meses de atividade existem,
 * e isso é dado de entrada, não inferência. Sem RBT12 devolvemos `null` e quem chama diz que falta
 * o dado, em vez de exibir 0% ou a alíquota nominal (que seria sempre mais alta que a real).
 */
export function aliquotaEfetiva(anexo, rbt12) {
  const v = Number(rbt12) || 0;
  if (v <= 0) return null;
  const faixa = faixaDoRbt12(anexo, v);
  if (!faixa) return null;
  return (v * faixa.aliquota - faixa.pd) / v;
}

/**
 * A REPARTIÇÃO por tributo, já com o TETO DO ISS aplicado.
 *
 * ⚠ O TETO É ABSOLUTO, NÃO PROPORCIONAL: o ISS efetivo não passa de 5% DA RECEITA. Quando a
 * alíquota efetiva supera o gatilho da faixa, o ISS trava em 5% e o que sobra
 * (alíquota efetiva − 5%) é repartido entre os federais por percentuais PRÓPRIOS — que não são os
 * mesmos da partilha normal da faixa. Aplicar a partilha comum e depois "cortar" o ISS daria um
 * total diferente da alíquota efetiva, e a soma dos tributos deixaria de fechar com o DAS.
 */
export function repartirPorTributo(anexo, rbt12) {
  const efetiva = aliquotaEfetiva(anexo, rbt12);
  if (efetiva == null) return null;
  const faixa = faixaDoRbt12(anexo, rbt12);

  const teto = anexo.tetoIss;
  const aplicaTeto = teto && faixa.faixa === teto.faixa && efetiva > teto.aliquotaEfetivaGatilho;

  if (!aplicaTeto) {
    const out = {};
    for (const [trib, pct] of Object.entries(faixa.partilha)) out[trib] = efetiva * pct;
    return { aliquotaEfetiva: efetiva, faixa: faixa.faixa, porTributo: out, tetoIssAplicado: false };
  }

  const excedente = efetiva - ISS_FAIXA_LEGAL.maximo;
  const out = { iss: ISS_FAIXA_LEGAL.maximo };
  for (const [trib, pct] of Object.entries(teto.redistribuicao)) out[trib] = excedente * pct;
  return { aliquotaEfetiva: efetiva, faixa: faixa.faixa, porTributo: out, tetoIssAplicado: true };
}

/**
 * FATOR R — FONTES_FISCAIS §1.8 (art. 18, §§ 5º-J e 5º-M).
 *
 *     Fator R = folha de 12 meses / RBT12
 *
 * A folha INCLUI pró-labore e encargos. Apuração mensal sobre os 12 meses anteriores: o
 * enquadramento pode alternar mês a mês, e é por isso que a tela mostra a margem, não só o lado.
 */
export function fatorR(folha12m, rbt12) {
  const r = Number(rbt12) || 0;
  if (r <= 0) return null;
  return (Number(folha12m) || 0) / r;
}

/** ≥ 28% → Anexo III; abaixo → Anexo V. Só vale para atividade sujeita ao fator (§ 5º-M). */
export function anexoPorFatorR(folha12m, rbt12) {
  const fr = fatorR(folha12m, rbt12);
  if (fr == null) return null;
  return fr >= FATOR_R_LIMITE ? "III" : "V";
}

/**
 * A FOLHA QUE FALTA para alcançar o Fator R de 28% — em reais, não em pontos percentuais.
 *
 * "Faltam 2,3 p.p." não diz o que fazer. `folhaParaFatorR` responde "aumente R$ X de folha no ano",
 * que é a decisão. Já no lado ≥ 28%, devolve a MARGEM: quanto a folha pode cair antes de a empresa
 * despencar para o Anexo V.
 */
export function folhaParaFatorR(folha12m, rbt12) {
  const r = Number(rbt12) || 0;
  if (r <= 0) return null;
  const necessaria = r * FATOR_R_LIMITE;
  const atual = Number(folha12m) || 0;
  return {
    fatorR: atual / r,
    folhaNecessaria: necessaria,
    // Positivo: falta folha. Negativo: é a margem de sobra até cair para o Anexo V.
    diferenca: necessaria - atual,
    atinge: atual / r >= FATOR_R_LIMITE,
  };
}

/**
 * Custo anual no Simples.
 *
 * ⚠ `cppPorFora` NÃO É DETALHE. No Anexo IV a CPP fica FORA do DAS (art. 18, § 5º-C): a empresa
 * paga 20% de INSS patronal por fora, como qualquer outra. Comparar o Anexo IV com outro regime sem
 * somar isso faz ele parecer artificialmente barato — o próprio documento de fontes abre um alerta
 * para esse erro. Aqui a soma é obrigatória e aparece separada no resultado.
 */
export function custoAnualSimples({ anexoChave, rbt12, receitaAnual, folhaAnual = 0 }) {
  const anexo = ANEXOS[anexoChave];
  if (!anexo) return null;
  const rep = repartirPorTributo(anexo, rbt12);
  if (!rep) return { indisponivel: true, motivo: "Sem RBT12 não há alíquota efetiva — informe a receita dos 12 meses anteriores." };

  const receita = Number(receitaAnual) || 0;
  const das = rep.aliquotaEfetiva * receita;

  // A CPP por fora incide sobre a FOLHA, não sobre a receita.
  const cppPorFora = anexo.cppForaDoDas ? (Number(folhaAnual) || 0) * ENCARGOS_FOLHA.cppPatronal : 0;

  return {
    regime: "Simples Nacional",
    anexo: anexo.nome,
    faixa: rep.faixa,
    aliquotaEfetiva: rep.aliquotaEfetiva,
    tetoIssAplicado: rep.tetoIssAplicado,
    das,
    cppPorFora,
    total: das + cppPorFora,
    // Carga sobre a receita, já com o que sai por fora — é o número comparável entre regimes.
    cargaEfetiva: receita > 0 ? (das + cppPorFora) / receita : null,
    porTributo: Object.fromEntries(
      Object.entries(rep.porTributo).map(([t, pct]) => [t, pct * receita]),
    ),
    premissas: [
      `${anexo.nome} (${anexo.fonte})`,
      `RBT12 de ${brl(rbt12)} → ${rep.faixa}ª faixa`,
      rep.tetoIssAplicado ? "Teto de ISS de 5% aplicado, com redistribuição aos federais" : null,
      anexo.cppForaDoDas ? `CPP de 20% somada POR FORA sobre folha de ${brl(folhaAnual)} — no Anexo IV ela não está no DAS` : null,
    ].filter(Boolean),
  };
}

/** Pode optar pelo Simples por RECEITA? As demais vedações (art. 17) não são avaliadas aqui. */
export function podeOptarPorReceita(rbt12) {
  const v = Number(rbt12) || 0;
  return {
    pode: v <= LIMITES_SIMPLES.epp,
    acimaDoSublimite: v > LIMITES_SIMPLES.sublimiteIcmsIss,
    // ⚠ Acima do sublimite ICMS e ISS SAEM do DAS e são recolhidos por fora, pelas regras
    // estaduais/municipais — que são parâmetro de entrada, não cálculo nosso.
    aviso: v > LIMITES_SIMPLES.sublimiteIcmsIss && v <= LIMITES_SIMPLES.epp
      ? "Acima do sublimite de R$ 3,6 mi: ICMS e ISS saem do DAS e passam a ser recolhidos por fora."
      : null,
  };
}

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
