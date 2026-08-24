/**
 * A FAMÍLIA DE UMA CONTA, derivada do `codigoCompleto`. Módulo PURO (sem prisma, sem rede).
 *
 * A regra, uma frase: **quem diz o que uma conta é para o motor de verificação é o PREFIXO do
 * `codigoCompleto`, nunca o nome e nunca o código reduzido.**
 *
 * ## ⚠⚠ POR QUE O `codigoCompleto` — instrução do dono, 24/08/2026
 *
 * > *"leve sempre em conta para verificação os códigos completos do plano de contas, os códigos
 * > 2.1.1.05.0001 por exemplo, pois eles são imutáveis enquanto os reduzidos mutáveis."*
 *
 * A máscara é **1‑1‑1‑2‑4** (9 caracteres): `211050001` ⇒ `2.1.1.05.0001`. Bate com as larguras já
 * documentadas em `lib/disponibilidades.js` (1 · 2 · 3 · 5 · 9).
 *
 * ⚠ **`AccountingEntryLine.conta` guarda o REDUZIDO** (TEXTO, sem FK). Logo quem chama este módulo
 * tem de **resolver reduzido → conta pelo plano A CADA LEITURA** e passar a conta resolvida. A
 * classificação **nunca é gravada**: um reduzido renumerado deixaria a classificação gravada
 * mentindo em silêncio, enquanto resolvida na leitura ela se conserta sozinha.
 * ⚠ Medido em `disponibilidades.js`: **518 contas** têm o primeiro dígito do reduzido diferente do
 * primeiro dígito do completo — o caso didático é o reduzido `"5"` = CAIXA - MATRIZ contra o
 * completo `"5"` = (-) IRPJ/CSLL.
 *
 * ## As famílias, medidas no plano real de produção (24/08/2026) e provadas contra o balancete
 *
 * O dono forneceu um Balancete de Verificação do sistema de DESTINO (Nasajon), e os pares batem
 * centavo a centavo — é a evidência que sustenta este arquivo:
 *
 * | prefixo | nome no plano | papel |
 * |---|---|---|
 * | `33103` | `3.3.1.03` IMPOSTOS INCIDENTES | débito da provisão de tributo sobre a RECEITA |
 * | `33101` `33102` | devoluções · descontos concedidos | ⚠ deduzem receita, **não são tributo** |
 * | `41103` | `4.1.1.03` DESPESAS TRIBUTARIAS | débito da provisão de tributo sobre o LUCRO |
 * | `21105` | `2.1.1.05` OBRIGACOES TRIBUTARIAS | crédito da provisão de tributo · débito do pagamento |
 * | `21104` | `2.1.1.04` OBRIGACOES TRABALHISTAS | ⚠ é onde mora `INSS A PAGAR` |
 * | `41104` | `4.1.1.04` DESPESAS FINANCEIRAS | ⚠ `JUROS` e `MULTAS` — as pernas de acréscimo da baixa |
 * | `111` | `1.1.1` DISPONIVEL | crédito de todo pagamento (via `disponibilidades.js`) |
 *
 * ## ⚠⚠ O RAMO `5` FICA FORA DE TODAS AS FAMÍLIAS, DE PROPÓSITO
 *
 * `5.1.1.01.0001 (-) IRPJ` e `5.1.1.01.0002 (-) CSLL` existem no plano, e **é onde os lançamentos
 * de hoje estão**. Mas o balancete do sistema de destino traz a linha de resumo
 * **`(-) IRPJ/CSLL ....... 0,00`** e leva IRPJ para `4.1.1.03.0006` e CSLL para `4.1.1.03.0005`.
 * Decisão do dono: o certo é `4.1.1.03`.
 *
 * Como as regras do motor são de **INCLUSÃO**, o ramo `5` cai em violação **por construção** — e
 * não por uma linha escrita contra ele, que alguém removeria daqui a seis meses achando ser
 * exceção esquecida. Não acrescente `"5"` a `FAMILIA`.
 *
 * ## ⚠⚠ O PARCELAMENTO MORA DENTRO DE `21105`, E O PREFIXO SOZINHO NÃO O DISTINGUE
 *
 * Medido: `2.1.1.05.0021` a `2.1.1.05.0032` são **PARCELAMENTO … A RECOLHER** (INSS, ISS, PIS,
 * COFINS, C.S., IRPJ, SIMPLES, ICMS, dívida ativa, INSS s/receita, IR s/NF, PERT). Um prefixo puro
 * chamaria `PARCELAMENTO ISS A RECOLHER` de tributo comum a recolher, e a provisão que transfere
 * dívida para um parcelamento passaria como se fosse uma provisão normal.
 *
 * A saída é uma **lista FECHADA de folhas, versionada AQUI** — e não uma coluna nova no banco, que
 * seria mutável e contrariaria a instrução do dono sobre a imutabilidade do código completo.
 * ⚠ **Folha nova dentro de `21105` que não esteja na lista cai em `OBRIGACAO_TRIBUTARIA`.** É um
 * falso-negativo brando, nomeado aqui, e preferível a casar pelo NOME da conta — que é o palpite
 * textual que este projeto proíbe em toda parte.
 */

import { classificarDisponibilidade, CLASSE, sobPrefixo } from "../lib/disponibilidades.js";

/** As famílias que este módulo pode devolver. Lista FECHADA. */
export const FAMILIA = Object.freeze({
  /** `3.3.1.03` — o débito da provisão de ISS, PIS, COFINS, DAS (tributo sobre a RECEITA). */
  RETIFICADORA_DE_RECEITA: "RETIFICADORA_DE_RECEITA",
  /** `3.3.1.01` e `3.3.1.02` — devolução e desconto. Deduzem receita e ⚠ NÃO são tributo. */
  DEDUCAO_NAO_TRIBUTARIA: "DEDUCAO_NAO_TRIBUTARIA",
  /** `4.1.1.03` — o débito da provisão de IRPJ e CSLL (tributo sobre o LUCRO). */
  DESPESA_TRIBUTARIA: "DESPESA_TRIBUTARIA",
  /** `2.1.1.05` menos as folhas de parcelamento — o crédito de toda provisão de TRIBUTO. */
  OBRIGACAO_TRIBUTARIA: "OBRIGACAO_TRIBUTARIA",
  /**
   * `2.1.1.04` OBRIGACOES TRABALHISTAS — e ⚠ **é aqui que mora `2.1.1.04.0009 INSS A PAGAR`**.
   *
   * ⚠⚠ ESTA FAMÍLIA NASCEU DE UM FALSO POSITIVO MEDIDO. A primeira versão da regra de pagamento
   * exigia débito em `21105*`, e acusou **todo pagamento de INSS da carteira** — porque o INSS é
   * obrigação **trabalhista/previdenciária**, não tributária, e o plano o põe em `2.1.1.04`. Rodar
   * o diagnóstico contra produção antes de ligar a tela foi o que pegou isso.
   */
  OBRIGACAO_TRABALHISTA: "OBRIGACAO_TRABALHISTA",
  /**
   * `4.1.1.04` DESPESAS FINANCEIRAS — `411040001 JUROS` e `411040006 MULTAS`.
   *
   * ⚠⚠ SEGUNDO FALSO POSITIVO MEDIDO, e a razão é a FORMA DA BAIXA neste projeto: ela é **três
   * lançamentos separados** (`D principal / C caixa` · `D juros / C caixa` · `D multa / C caixa`),
   * decisão do dono registrada no `CLAUDE.md` desta pasta — *"um único lançamento 3D/1C esconde os
   * acréscimos (…) juros e multa são despesa do mês do pagamento"*. As duas contas são as mesmas
   * de `contasAcrescimo.js` (`CONTAS_ACRESCIMO` = 501 juros / 506 multa).
   */
  DESPESA_FINANCEIRA: "DESPESA_FINANCEIRA",
  /** `2.1.1.05.0021`–`0032` — dívida já dentro de um parcelamento. */
  PASSIVO_PARCELAMENTO: "PASSIVO_PARCELAMENTO",
  /** `1.1.1` — caixa, bancos, aplicações. O crédito de todo pagamento. */
  DISPONIBILIDADE: "DISPONIBILIDADE",
  /** Tem `codigoCompleto` e ele está fora de todas as famílias acima. ⚠ Inclui o ramo `5`. */
  FORA_DAS_FAMILIAS: "FORA_DAS_FAMILIAS",
  /** Sem `codigoCompleto`, sem conta, ou conta fora do plano. ⚠ NUNCA colapsar em FORA_DAS_FAMILIAS. */
  INDETERMINADO: "INDETERMINADO",
});

/**
 * As âncoras, com o nome MEDIDO no plano real. Mesmo desenho de `ANCORAS_DISPONIBILIDADE`.
 *
 * ⚠ O nome aqui é **tripwire, nunca classificador** — `conferirAncorasDeFamilia` grita se o plano
 * global for reimportado com outra numeração, em vez de o motor seguir classificando pelo prefixo
 * antigo, calado.
 */
export const ANCORAS_FAMILIA = Object.freeze({
  RETIFICADORA_DE_RECEITA: Object.freeze({ codigoCompleto: "33103", nomeMedido: "IMPOSTOS INCIDENTES" }),
  DEVOLUCOES: Object.freeze({ codigoCompleto: "33101", nomeMedido: "DEVOLUCOES DE VENDAS E SERVIÇOS" }),
  DESCONTOS: Object.freeze({ codigoCompleto: "33102", nomeMedido: "ABATIMENTOS E DESCONTOS CONCEDIDOS" }),
  DESPESA_TRIBUTARIA: Object.freeze({ codigoCompleto: "41103", nomeMedido: "DESPESAS TRIBUTARIAS" }),
  OBRIGACAO_TRIBUTARIA: Object.freeze({ codigoCompleto: "21105", nomeMedido: "OBRIGACOES TRIBUTARIAS" }),
  OBRIGACAO_TRABALHISTA: Object.freeze({ codigoCompleto: "21104", nomeMedido: "OBRIGACOES TRABALHISTAS" }),
  DESPESA_FINANCEIRA: Object.freeze({ codigoCompleto: "41104", nomeMedido: "DESPESAS FINANCEIRAS" }),
});

/**
 * As folhas de `2.1.1.05` que são PARCELAMENTO. Lista FECHADA, medida em produção (24/08/2026).
 *
 * ⚠ Guardadas como `codigoCompleto` INTEIRO, não como faixa numérica: uma faixa (`0021`–`0032`)
 * pareceria mais elegante e passaria a incluir sozinha qualquer folha nova nesse intervalo — o que
 * é exatamente o palpite que este módulo evita.
 */
export const FOLHAS_DE_PARCELAMENTO = Object.freeze([
  "211050021", // PARCELAMENTO INSS A RECOLHER
  "211050022", // PARCELAMENTO ISS A RECOLHER
  "211050023", // PARCELAMENTO PIS A RECOLHER
  "211050024", // PARCELAMENTO COFINS A RECOLHER
  "211050025", // PARCELAMENTO C.S. A RECOLHER
  "211050026", // PARCELAMENTO IRPJ A RECOLHER
  "211050027", // PARCELAMENTO SIMPLES A RECOLHER
  "211050028", // PARCELAMENTO ICMS A RECOLHER
  "211050029", // PARCELAMENTO DIV. ATIV. UNIAO LEI 11.941/09
  "211050030", // PARCELAMENTO INSS S/RECEITA A RECOLHER
  "211050031", // PARCELAMENTO IR S/NF SERV PJ A RECOLHER
  "211050032", // PARCELAMENTO PERT A RECOLHER
]);

const PARCELAMENTO = new Set(FOLHAS_DE_PARCELAMENTO);

/**
 * Em que família esta conta entra.
 *
 * @param conta `{ codigoCompleto, codigo?, nome? }` já RESOLVIDA no plano, ou `null`.
 *
 * ⚠ A ORDEM DOS TESTES IMPORTA. `33103` é conferido antes de `33101`/`33102` só por clareza (eles
 * não colidem entre si), mas a folha de parcelamento **tem** de ser conferida antes de `21105`,
 * senão todo parcelamento vira obrigação tributária comum.
 */
export function classificarFamilia(conta) {
  const cc = String(conta?.codigoCompleto ?? "").trim();
  if (!cc) return FAMILIA.INDETERMINADO;

  // ⚠ A folha exata vem PRIMEIRO — ver o comentário acima.
  if (PARCELAMENTO.has(cc)) return FAMILIA.PASSIVO_PARCELAMENTO;

  if (sobPrefixo(cc, "33103")) return FAMILIA.RETIFICADORA_DE_RECEITA;
  if (sobPrefixo(cc, "33101") || sobPrefixo(cc, "33102")) return FAMILIA.DEDUCAO_NAO_TRIBUTARIA;
  if (sobPrefixo(cc, "41103")) return FAMILIA.DESPESA_TRIBUTARIA;
  if (sobPrefixo(cc, "41104")) return FAMILIA.DESPESA_FINANCEIRA;
  if (sobPrefixo(cc, "21105")) return FAMILIA.OBRIGACAO_TRIBUTARIA;
  if (sobPrefixo(cc, "21104")) return FAMILIA.OBRIGACAO_TRABALHISTA;

  // ⚠ DISPONIBILIDADE É DELEGADA, e não reimplementada. `disponibilidades.js` já existe com 15
  // testes e é a autoridade de "isto é caixa?" neste projeto — este é o primeiro consumidor dela em
  // produção. Um segundo classificador de caixa divergiria na primeira correção.
  const classe = classificarDisponibilidade(conta);
  if (classe !== CLASSE.NAO_DISPONIVEL && classe !== CLASSE.INDETERMINADO) {
    return FAMILIA.DISPONIBILIDADE;
  }

  // ⚠ Chegou aqui COM código completo ⇒ sabemos que está fora das famílias. É afirmação, e é o que
  // faz o ramo `5` (`(-) IRPJ/CSLL`) ser pego pelas regras de inclusão do motor.
  return FAMILIA.FORA_DAS_FAMILIAS;
}

/** A conta é uma folha de parcelamento? Atalho legível para o motor. */
export function ehContaDeParcelamento(conta) {
  return classificarFamilia(conta) === FAMILIA.PASSIVO_PARCELAMENTO;
}

/**
 * O `codigoCompleto` na grafia pontuada que o contador lê (`211050001` ⇒ `2.1.1.05.0001`).
 *
 * ⚠ É a grafia que o DONO usou ao ditar a regra e a que o balancete do sistema de destino imprime —
 * a tela e as mensagens do motor usam ela, para o contador conferir contra o outro sistema sem
 * traduzir de cabeça.
 * ⚠ Código fora da máscara de 9 dígitos volta **como veio**, sem inventar pontuação: um código de
 * outro comprimento é sinal de plano diferente, e mascará-lo esconderia isso.
 */
export function pontuarCodigoCompleto(codigoCompleto) {
  const cc = String(codigoCompleto ?? "").trim();
  if (!/^\d{9}$/.test(cc)) return cc;
  return `${cc[0]}.${cc[1]}.${cc[2]}.${cc.slice(3, 5)}.${cc.slice(5)}`;
}

/**
 * As âncoras ainda batem com o plano? **Não classifica nada** — é tripwire.
 *
 * Devolve as âncoras cujo nome no plano divergiu do medido, para o diagnóstico gritar quando o
 * plano global for reimportado com outra numeração.
 */
export function conferirAncorasDeFamilia(contas) {
  const porCodigo = new Map();
  for (const c of Array.isArray(contas) ? contas : []) {
    const cc = String(c?.codigoCompleto ?? "").trim();
    if (cc && !porCodigo.has(cc)) porCodigo.set(cc, c);
  }
  const divergentes = [];
  for (const [chave, ancora] of Object.entries(ANCORAS_FAMILIA)) {
    const achada = porCodigo.get(ancora.codigoCompleto);
    if (!achada) {
      divergentes.push({ ancora: chave, codigoCompleto: ancora.codigoCompleto, motivo: "ausente_no_plano" });
      continue;
    }
    const nome = String(achada.nome ?? "").trim().toUpperCase();
    if (nome !== ancora.nomeMedido.toUpperCase()) {
      divergentes.push({
        ancora: chave,
        codigoCompleto: ancora.codigoCompleto,
        motivo: "nome_divergente",
        nomeMedido: ancora.nomeMedido,
        nomeAtual: achada.nome ?? null,
      });
    }
  }
  return divergentes;
}
