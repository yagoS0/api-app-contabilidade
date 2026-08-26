// QUANTO CUSTA SUBIR O PRÓ-LABORE ATÉ O FATOR R ALCANÇAR 28%.
//
// É a conta que o dono nomeou como a mais valiosa do produto: *"quanto de pró-labore preciso para
// chegar a 28% (…), quanto isso custa em INSS/IRPF do sócio, e quanto economiza no DAS. Nesse caso
// o resultado fica próximo do empate — exatamente o cálculo que o contador não consegue fazer de
// cabeça e pelo qual pagaria pela ferramenta."*
//
// ⚠ METADE JÁ EXISTIA: `folhaParaFatorR` (`simplesNacional.js`) devolve `folhaNecessaria` e
// `diferenca`. O que faltava é o outro lado — o custo para a PESSOA FÍSICA.
//
// ── ⚠⚠ A PREMISSA QUE DECIDE O RESULTADO, E ELA VAI IMPRESSA ─────────────────────────────────
//
// **Nos anexos I, II, III e V do Simples a contribuição patronal está DENTRO do DAS** (LC 123/2006,
// art. 13, VI), e o DAS incide sobre a RECEITA — não sobre a folha. Então, nesses anexos, subir o
// pró-labore **não** custa 20% de CPP à empresa: o custo extra é só do SÓCIO (INSS retido + IRRF).
// É exatamente isso que torna a manobra atraente, e é o motivo de ela caber num simulador.
//
// ⚠ **NO ANEXO IV NÃO VALE**: lá a CPP fica FORA do DAS (art. 18, § 5º-C), e cada real a mais de
// pró-labore custa 20% à empresa por cima. A função RECUSA o Anexo IV em vez de calcular errado.
//
// ⚠ **RAT/FAP e terceiros continuam fora**, e a recusa é a de sempre: variam por CNAE e pelo FAP de
// CADA empresa — são cadastro, não tabela anual. O resultado diz isso.
//
// ⚠⚠ E ISTO É SIMULAÇÃO DE APOIO, NÃO CÁLCULO DE FOLHA. Pró-labore real tem dependentes, outras
// deduções, 13º, e a decisão tem efeito previdenciário para o sócio que este módulo não avalia.

import { IRPF_MENSAL, DESCONTO_SIMPLIFICADO_MENSAL, IRPF_REDUTOR_MENSAL, INSS_SALARIO_CONTRIBUICAO, VIGENCIA_PESSOA_FISICA }
  from "./tabelasPessoaFisica.data";
import { ENCARGOS_FOLHA, FATOR_R_LIMITE } from "./tabelasFiscais";

export { VIGENCIA_PESSOA_FISICA };

/**
 * INSS retido do pró-labore do sócio — contribuinte individual, 11%, limitado ao TETO.
 *
 * ⚠ O teto é o que faz a conta virar: acima dele o INSS para de crescer, e cada real a mais de
 * pró-labore passa a custar só IRPF. Ignorá-lo superestimaria o custo em toda simulação relevante.
 */
export function inssDoProLabore(proLaboreMensal) {
  const v = Number(proLaboreMensal);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, INSS_SALARIO_CONTRIBUICAO.teto) * ENCARGOS_FOLHA.inssContribuinteIndividual;
}

/**
 * IRRF mensal sobre uma base já líquida de INSS.
 *
 * ⚠ Usa o DESCONTO SIMPLIFICADO, que substitui as demais deduções legais. É a escolha mais
 * conservadora para um simulador: ele não conhece dependentes nem despesas dedutíveis do sócio, e
 * supor qualquer uma delas produziria um imposto MENOR do que o real.
 */
export function irrfMensal(rendimentoTributavel) {
  const bruto = Number(rendimentoTributavel);
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;

  const base = Math.max(0, bruto - Math.min(DESCONTO_SIMPLIFICADO_MENSAL, bruto));
  const faixa = IRPF_MENSAL.find((f) => f.ate == null || base <= f.ate) || IRPF_MENSAL[IRPF_MENSAL.length - 1];
  const imposto = Math.max(0, base * faixa.aliquota - faixa.deduzir);

  // ⚠⚠ O REDUTOR DA LEI 15.270/2025 — e ele incide sobre os RENDIMENTOS, não sobre a base.
  // Sem ele, um pró-labore de R$ 5.000 sairia com imposto onde a lei manda ZERO. A fórmula é a da
  // própria Receita, e fecha nos dois extremos (conferido na geração da tabela).
  const r = IRPF_REDUTOR_MENSAL;
  let reducao = 0;
  if (bruto <= r.isentoAte) reducao = imposto;
  else if (bruto <= r.parcialAte) reducao = Math.max(0, r.constante - r.fator * bruto);

  return Math.max(0, imposto - Math.min(reducao, imposto));
}

/**
 * O que o sócio paga, no mês, por um pró-labore.
 *
 * @returns {{proLabore, inss, irrf, liquido, cargaSobreOProLabore}}
 */
export function custoMensalDoSocio(proLaboreMensal) {
  const v = Number(proLaboreMensal) || 0;
  const inss = inssDoProLabore(v);
  // ⚠ O INSS retido REDUZ a base do IRRF — é dedução legal, e esquecê-la superestima o imposto.
  const irrf = irrfMensal(Math.max(0, v - inss));
  return {
    proLabore: v,
    inss,
    irrf,
    liquido: v - inss - irrf,
    cargaSobreOProLabore: v > 0 ? (inss + irrf) / v : null,
  };
}

export const RECUSA = Object.freeze({
  SEM_RBT12: "sem_rbt12",
  SEM_FOLHA: "sem_folha",
  JA_ATINGE: "ja_atinge",
  ANEXO_IV: "anexo_iv",
});

/**
 * A simulação: quanto de pró-labore falta para o Fator R chegar a 28%, e quanto isso custa.
 *
 * @param {object} args
 * @param {number} args.rbt12
 * @param {number|null} args.folha12mAtual — a folha dos 12 meses. ⚠ `null` = NÃO INFORMADA.
 * @param {number} [args.economiaNoDas] — o que se deixa de pagar por ficar no III em vez do V.
 * @param {string} [args.anexoDestino="III"]
 * @returns {{recusa: string, motivo: string} | {…a simulação}}
 */
export function simularProLaboreParaFatorR({ rbt12, folha12mAtual, economiaNoDas = null, anexoDestino = "III" } = {}) {
  const r = Number(rbt12);
  if (!Number.isFinite(r) || r <= 0) {
    return { recusa: RECUSA.SEM_RBT12, motivo: "Sem RBT12 não há Fator R a alcançar." };
  }
  // ⚠⚠ FOLHA AUSENTE NÃO É ZERO — a regra do módulo. Tratá-la como zero diria ao contador que ele
  // precisa criar a folha inteira do nada, quando pode já existir folha que ninguém informou.
  if (folha12mAtual == null || !Number.isFinite(Number(folha12mAtual))) {
    return {
      recusa: RECUSA.SEM_FOLHA,
      motivo: "A folha dos 12 meses não foi informada. Sem ela não dá para dizer quanto FALTA — e "
        + "tratar a ausência como zero diria que é preciso criar a folha inteira.",
    };
  }
  // ⚠ No Anexo IV a CPP fica FORA do DAS: cada real de pró-labore custa 20% à empresa por cima, e
  // a premissa desta conta deixa de valer. RECUSA em vez de calcular errado.
  if (String(anexoDestino).toUpperCase() === "IV") {
    return {
      recusa: RECUSA.ANEXO_IV,
      motivo: "No Anexo IV a contribuição patronal fica FORA do DAS (art. 18, § 5º-C): subir o "
        + "pró-labore custa 20% a mais à empresa, e esta simulação não vale.",
    };
  }

  const atual = Number(folha12mAtual);
  const necessaria = r * FATOR_R_LIMITE;
  const faltaNoAno = necessaria - atual;

  if (faltaNoAno <= 0) {
    return {
      recusa: RECUSA.JA_ATINGE,
      motivo: `A folha já alcança o Fator R: ${(atual / r * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% `
        + `contra os ${(FATOR_R_LIMITE * 100).toFixed(0)}% exigidos. A margem até cair para o Anexo V é de `
        + `${(atual - necessaria).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} no ano.`,
      fatorRAtual: atual / r,
      margemAnual: atual - necessaria,
    };
  }

  // ⚠ POR MÊS, porque é assim que o pró-labore se decide — e porque o IRRF é mensal e progressivo:
  // dividir o custo anual por 12 depois daria outro número.
  const aumentoMensal = faltaNoAno / 12;

  // ⚠⚠ O CUSTO É O INCREMENTAL, não o total. O sócio já paga INSS e IRRF sobre o pró-labore de
  // hoje; o que a decisão custa é a DIFERENÇA. Comparar o custo do pró-labore novo com a economia
  // do DAS somaria imposto que já era pago de qualquer jeito.
  const proLaboreHoje = atual / 12;
  const hoje = custoMensalDoSocio(proLaboreHoje);
  const depois = custoMensalDoSocio(proLaboreHoje + aumentoMensal);
  const custoMensalIncremental = (depois.inss + depois.irrf) - (hoje.inss + hoje.irrf);
  const custoAnualIncremental = custoMensalIncremental * 12;

  // ⚠⚠ `Number(null)` É `0`, E PASSA EM `isFinite` — a armadilha mais repetida deste projeto, e eu
  // a reintroduzi aqui. Com `Number.isFinite(Number(economiaNoDas))`, uma economia NÃO INFORMADA
  // virava zero, o saldo virava `-custo`, e a decisão aparecia como SEMPRE RUIM por falta de
  // metade da conta — exatamente o que o comentário do `saldoAnual` diz que não pode acontecer.
  // É a mesma família de `fatorR(null, rbt)` devolvendo 0 e caindo no Anexo V. O teste pegou.
  const economia = economiaNoDas == null || !Number.isFinite(Number(economiaNoDas))
    ? null
    : Number(economiaNoDas);

  return {
    recusa: null,
    fatorRAtual: atual / r,
    folhaNecessaria: necessaria,
    faltaNoAno,
    aumentoMensal,
    proLaboreHoje,
    proLaboreDepois: proLaboreHoje + aumentoMensal,
    hoje,
    depois,
    custoMensalIncremental,
    custoAnualIncremental,
    economiaNoDas: economia,
    // ⚠ `null` quando a economia não foi calculada — nunca `custoAnual * -1`, que faria a decisão
    // parecer sempre ruim por falta de metade da conta.
    saldoAnual: economia == null ? null : economia - custoAnualIncremental,
    compensa: economia == null ? null : economia > custoAnualIncremental,
    anexoDestino,
    premissas: [
      `Tabelas do IRPF e teto do INSS com vigência ${VIGENCIA_PESSOA_FISICA} (fonte oficial versionada)`,
      `INSS do sócio: ${(ENCARGOS_FOLHA.inssContribuinteIndividual * 100).toFixed(0)}% do pró-labore, limitado ao teto de `
        + `${INSS_SALARIO_CONTRIBUICAO.teto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      "IRRF pelo desconto simplificado, com o redutor da Lei 15.270/2025",
      // ⚠⚠ A PREMISSA QUE DECIDE O RESULTADO. Ela vai IMPRESSA, e não é rodapé: se ela não valer, a
      // conta inteira muda de sinal.
      `Anexo ${anexoDestino}: a contribuição patronal está DENTRO do DAS (LC 123/2006, art. 13, VI), `
        + "então subir o pró-labore NÃO custa 20% de CPP à empresa",
    ],
    naoConsiderado: [
      "RAT/FAP e contribuições a terceiros — variam por CNAE e pelo FAP da empresa",
      "13º pró-labore, dependentes e outras deduções do sócio",
      "o efeito previdenciário para o sócio (o benefício futuro sobe junto)",
    ],
  };
}
