// QUAL ANEXO DO SIMPLES ESTA EMPRESA USA — E QUANDO NÃO DÁ PARA AFIRMAR NENHUM.
//
// Regra PURA, sem React e sem rede. Ela existe para uma coisa só: alimentar a tabela de referência
// do anexo (`TabelaAnexoReferencia`) sem que a tela afirme mais do que se sabe.
//
// ⚠⚠ POR QUE ISTO NÃO É "LER `atividades[].anexoImplicito`", QUE SERIA A FORMA ÓBVIA:
//
// As quatro atividades de Fator R do catálogo do PGDAS-D têm **`anexoImplicito: "III"` gravado**, e
// o anexo real delas é **III OU V**, conforme a folha. Medido em
// `apps/api/src/application/notas/apuracao/v2/seeds/AtividadePgdasdSeeds.js:24-26,43`:
//
//     [10, "Serviços (interno) — Fator R, sem retenção ISS, ISS devido a OUTRO município", "III", …, true,  null],
//     [11, "Serviços (interno) — Fator R, …ao PRÓPRIO município",                          "III", …, true,  "SERVICO_FATOR_R"],
//     [12, "Serviços (interno) — Fator R, com retenção/substituição de ISS",               "III", …, true,  null],
//     [29, "Serviços p/ exterior — Fator R",                                               "III", …, true,  "SERVICO_FATOR_R"],
//
// A tela de hoje se salva porque imprime `III ★FR` (`FechamentoModal.jsx:424`) — o `★FR` avisa que
// aquilo não está decidido. **Uma TABELA não tem como avisar**: ela desenharia as seis faixas do
// Anexo III com ar de resposta, para toda empresa de serviço com folha abaixo de 28%. Por isso:
//
//   `sujeitoFatorR === true` ⇒ o `anexoImplicito` é DESCARTADO e quem decide é a folha.
//   Sem folha informada ⇒ NÃO SE ESCOLHE: devolve III **e** V, e a tela mostra as duas.
//
// É o mesmo princípio do `escolherCodigoServicoNacional` (`apps/api/.../codigoServicoDaNota.js`):
// *"nunca o primeiro da lista"* — sem base para decidir, quem decide é o contador, não o sistema.

import { ANEXOS, LIMITES_SIMPLES, FATOR_R_LIMITE } from "../../planejamento/lib/tabelasFiscais";
import {
  faixaDoRbt12,
  aliquotaEfetiva,
  repartirPorTributo,
  tributosForaDoDasNaSextaFaixa,
  fatorR,
  anexoPorFatorR,
} from "../../planejamento/lib/simplesNacional";

// ⚠ IMPORT DIRETO ENTRE FEATURES DO MESMO APP, e não uma extração para `src/lib/`. Dois motivos
// medidos: (1) `App.jsx` já importa `PlanejamentoPage` de forma ESTÁTICA, então `tabelasFiscais.js`
// já está no bundle inicial — o custo aqui é ZERO; (2) `tabelasFiscais.js` é a única tabela do
// projeto com **citação de lei por valor** (`fonte: "FONTES_FISCAIS §1.5"` em cada anexo), e mexer
// nela para acomodar um segundo consumidor arriscaria o Planejamento sem necessidade.
//
// ⚠⚠ E NÃO SE COPIA A TABELA PARA CÁ. A cópia do backend (`AliquotaSimplesNacionalSeeds.js`) já
// existe e **não tem partilha por tributo nenhuma** — é a prova viva de que a segunda cópia nasce
// incompleta e ninguém percebe.

/** Como a tela deve tratar o conjunto de anexos devolvido. Lista FECHADA. */
export const SITUACAO_ANEXO = Object.freeze({
  /** Sabemos exatamente qual(is) anexo(s). */
  RESOLVIDO: "RESOLVIDO",
  /** Atividade de Fator R sem folha informada: é III **ou** V, e a folha decide. */
  DEPENDE_DO_FATOR_R: "DEPENDE_DO_FATOR_R",
  /** Nenhuma atividade escolhida na competência — não há o que afirmar. */
  SEM_ATIVIDADE: "SEM_ATIVIDADE",
});

/** Como a tela deve tratar a faixa. Lista FECHADA. */
export const SITUACAO_FAIXA = Object.freeze({
  RESOLVIDA: "RESOLVIDA",
  /** RBT12 ausente, vazio ou zero — a tabela sai inteira, sem linha marcada. */
  RBT12_DESCONHECIDO: "RBT12_DESCONHECIDO",
  /** RBT12 acima de R$ 4,8 mi — resposta DIFERENTE de "não sabemos". */
  RBT12_ACIMA_DO_LIMITE: "RBT12_ACIMA_DO_LIMITE",
});

const ORDEM_DOS_ANEXOS = ["I", "II", "III", "IV", "V"];

/**
 * ⚠⚠ RBT12 AUSENTE NÃO É ZERO, E ZERO CASA COM A 1ª FAIXA.
 *
 * `faixaDoRbt12` (`simplesNacional.js:16-17`) faz `Number(rbt12) || 0`, e a faixa 1 começa em
 * `de: 0` — então `null`, `undefined` e `""` **encontram faixa**, e a tela marcaria a primeira como
 * se fosse a da empresa. É a mesma família do `Number.isFinite(Number(null)) === true` que já
 * produziu um "0%" na tela do cliente, e do `folhaAusenteNaoEZero` do planejamento.
 *
 * As três partes são necessárias e nenhuma é redundante:
 *   · `!= null`                      — pega `null` e `undefined`
 *   · `Number.isFinite(Number(v))`   — pega `""` (que vira 0), `"abc"` (NaN) e `Infinity`
 *   · `> 0`                          — pega o zero, que aqui quer dizer "não informado"
 *
 * ⚠ Zero **não** é tratado como fato: numa empresa sem RBT12 informado ele é o valor de sistema,
 * não uma afirmação de receita. É a mesma leitura que `aliquotaEfetiva` já faz (`v <= 0 → null`).
 */
export function rbt12Conhecido(valor) {
  return valor != null && Number.isFinite(Number(valor)) && Number(valor) > 0;
}

/**
 * Os anexos que esta empresa usa na competência.
 *
 * @param {object} p
 * @param {Array<{anexoImplicito?: string, sujeitoFatorR?: boolean}>} p.atividades  do payload do fechamento
 * @param {number|string|null} p.folha12m  a folha de 12 meses — ⚠ `null` é "não informada"
 * @param {number|string|null} p.rbt12
 * @returns {{anexos: string[], situacao: string, fatorR: number|null, limiteFatorR: number}}
 */
export function anexosDaEmpresa({ atividades = [], folha12m = null, rbt12 = null } = {}) {
  const lista = Array.isArray(atividades) ? atividades : [];
  const fr = fatorR(folha12m, rbt12);

  if (!lista.length) {
    return { anexos: [], situacao: SITUACAO_ANEXO.SEM_ATIVIDADE, fatorR: fr, limiteFatorR: FATOR_R_LIMITE };
  }

  const achados = new Set();
  let dependeDoFatorR = false;

  for (const atv of lista) {
    if (atv?.sujeitoFatorR === true) {
      // ⚠⚠ `anexoImplicito` NÃO É LIDO AQUI — ver o cabeçalho. Ele diz "III" nas quatro atividades
      // de Fator R, e "III" é metade da resposta.
      //
      // ⚠ E a decisão é RECALCULADA, nunca lida de `snapshot.fatorR`: `decidirFatorR` recebe
      // `Number(null) === 0`, que passa em `Number.isFinite`, e devolve `anexoDecidido: "V"` — quem
      // protege é o chamador. `anexoPorFatorR` já devolve `null` para folha ausente, e é essa a
      // guarda que queremos.
      const decidido = anexoPorFatorR(folha12m, rbt12);
      if (decidido) {
        achados.add(decidido);
      } else {
        dependeDoFatorR = true;
        achados.add("III");
        achados.add("V");
      }
      continue;
    }
    const chave = String(atv?.anexoImplicito || "").trim().toUpperCase();
    if (ANEXOS[chave]) achados.add(chave);
  }

  // Atividade com anexo irreconhecível não vira anexo inventado; some do conjunto. Se TODAS forem
  // assim, a resposta é a mesma de não haver atividade — não se desenha tabela de anexo nenhum.
  if (!achados.size) {
    return { anexos: [], situacao: SITUACAO_ANEXO.SEM_ATIVIDADE, fatorR: fr, limiteFatorR: FATOR_R_LIMITE };
  }

  return {
    anexos: ORDEM_DOS_ANEXOS.filter((a) => achados.has(a)),
    situacao: dependeDoFatorR ? SITUACAO_ANEXO.DEPENDE_DO_FATOR_R : SITUACAO_ANEXO.RESOLVIDO,
    fatorR: fr,
    limiteFatorR: FATOR_R_LIMITE,
  };
}

/**
 * A tabela de UM anexo, com a linha da empresa marcada quando dá para marcar.
 *
 * @returns {{
 *   anexo: object, faixas: Array, faixaDaEmpresa: number|null, situacao: string,
 *   aliquotaEfetiva: number|null, reparticao: object|null,
 *   cppForaDoDas: boolean, foraDoDasNaSextaFaixa: string[],
 * }|null}  `null` quando a chave não é um anexo conhecido.
 */
export function tabelaDoAnexo(chaveDoAnexo, rbt12) {
  const anexo = ANEXOS[String(chaveDoAnexo || "").trim().toUpperCase()];
  if (!anexo) return null;

  const comum = {
    anexo,
    faixas: anexo.faixas,
    // ⚠ O Anexo IV é o único em que a CPP fica FORA do DAS (a empresa recolhe INSS patronal por
    // fora). Sem dizer isso na própria tabela, o contador soma a CPP ao DAS e erra o custo.
    cppForaDoDas: anexo.cppForaDoDas === true,
    // ⚠ Na 6ª faixa ICMS/ISS saem do DAS (LC 123/2006, art. 13-A). Qual deles sai é derivado da
    // própria tabela por `tributosForaDoDasNaSextaFaixa` — nunca uma lista escrita à mão.
    foraDoDasNaSextaFaixa: tributosForaDoDasNaSextaFaixa(anexo),
  };

  if (!rbt12Conhecido(rbt12)) {
    // Tabela inteira, NENHUMA linha marcada, e a tela diz que não sabemos.
    return { ...comum, faixaDaEmpresa: null, situacao: SITUACAO_FAIXA.RBT12_DESCONHECIDO, aliquotaEfetiva: null, reparticao: null };
  }

  if (Number(rbt12) > LIMITES_SIMPLES.epp) {
    // ⚠ RESPOSTA PRÓPRIA, e não "desconhecido": acima de R$ 4,8 mi a empresa não pode optar pelo
    // Simples, e isso é uma informação forte — dizer "não sabemos" ali esconderia o problema.
    return { ...comum, faixaDaEmpresa: null, situacao: SITUACAO_FAIXA.RBT12_ACIMA_DO_LIMITE, aliquotaEfetiva: null, reparticao: null };
  }

  const faixa = faixaDoRbt12(anexo, rbt12);
  return {
    ...comum,
    faixaDaEmpresa: faixa ? faixa.faixa : null,
    situacao: SITUACAO_FAIXA.RESOLVIDA,
    aliquotaEfetiva: aliquotaEfetiva(anexo, rbt12),
    // Já vem com o teto de 5% do ISS aplicado (`repartirPorTributo`) — não se reimplementa aqui.
    reparticao: repartirPorTributo(anexo, rbt12),
  };
}
