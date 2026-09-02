// A ALÍQUOTA DO ISSQN NA DPS (`tribMun/pAliq`) — regra PURA.
//
// ⚠⚠ ESTE CAMPO É PROIBIDO NUM CENÁRIO E OBRIGATÓRIO EM OUTRO, e os dois são REJEIÇÃO. Não existe
// "mandar por via das dúvidas": informar quando não pode é E0617/E0625/E0631/E0635; omitir quando
// deve é E0619/E0621/E0628/E0640. É por isso que ele nunca foi montado — e é por isso que agora
// só é montado onde a norma PROVA.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// A TABELA-VERDADE, lida do ANEXO_I versionado (aba `RN DPS_NFS-e`, linhas 509-516)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   opSimpNac=3 (Simples ME/EPP), regApTribSN=1 (ISSQN pelo SN):
//     convênio ATIVO      + retido (tpRetISSQN 2|3) → OBRIGATÓRIO, mínimo 1,8%   E0621
//     convênio ATIVO      + não retido (1)          → PROIBIDO                    E0625
//     convênio NÃO ativo  + retido                  → OBRIGATÓRIO, mínimo 1,8%   E0628
//     convênio NÃO ativo  + não retido              → PROIBIDO                    E0631
//
//   opSimpNac=3, regApTribSN=2|3 (ISSQN fora do SN, pela alíquota do município):
//     convênio ATIVO                                → PROIBIDO                    E0635
//     convênio NÃO ativo                            → OBRIGATÓRIO                 E0640
//
//   opSimpNac=1 (não optante):
//     convênio ATIVO                                → PROIBIDO                    E0617
//     convênio NÃO ativo + regEspTrib=0             → OBRIGATÓRIO                 E0619
//
// ⚠⚠ **A DESCOBERTA QUE TORNA ISTO CONSTRUÍVEL, e que corrige o plano desta entrega:** com
// `regApTribSN = 1` — que é o que emitimos hoje e o caso comum do Simples — **o status do convênio
// NÃO IMPORTA**. E0621 e E0628 dizem a mesma coisa (obrigatório) para os dois estados do convênio;
// E0625 e E0631 dizem a mesma coisa (proibido) para os dois. O único discriminante é a RETENÇÃO.
//
// O plano dizia que `pAliq` estava bloqueado pela lista de municípios "ATIVO no Sistema Nacional",
// que de fato não está no repositório. Isso continua verdade — mas **só** para `regApTribSN = 2|3`
// e para o não optante. Ali o convênio decide, e ali continuamos **sem emitir e nomeando**.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FORMA: `TSDec1V2` é `0|[0-9]{1}(\.[0-9]{2})?`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// UM dígito inteiro e EXATAMENTE dois decimais. Duas consequências que não são detalhe:
//
//   • `1.8` **não casa com o pattern** — tem de ser `1.80`. Uma alíquota formatada "certa" para
//     olho humano é recusada por schema.
//   • **alíquota de 10% ou mais é INEXPRIMÍVEL** neste campo. Não é limitação nossa: é o leiaute.
//     O ISS tem teto de 5% (LC 116, art. 8º-A), então na prática não morde — mas se um dia morder,
//     é melhor recusar aqui, nomeando, do que emitir um número truncado.

/** O que a norma decide para este cenário. */
export const DECISAO = Object.freeze({
  /** A norma PROVA que o campo deve ir. */
  EMITIR: "emitir",
  /** A norma PROVA que o campo não pode ir. */
  PROIBIDO: "proibido",
  /** Depende do status do convênio do município, que este projeto não tem. */
  NAO_DECIDIVEL: "nao_decidivel",
});

/** ⚠ Da observação de E0621 e E0628: *"o percentual da alíquota mínima informada permitida é 1,8%"*. */
export const ALIQUOTA_MINIMA_COM_RETENCAO = 1.8;

/** ⚠ `TSDec1V2` aceita UM dígito inteiro. 10% ou mais não cabe no campo. */
export const ALIQUOTA_MAXIMA_DO_CAMPO = 10;

const FORMA_TSDEC1V2 = /^(?:0|[0-9]{1}(?:\.[0-9]{2})?)$/;

/**
 * Formata para `TSDec1V2`, ou devolve `null` quando o número não cabe no campo.
 *
 * ⚠ SEM ARREDONDAR PARA CABER. `toFixed(2)` arredonda a terceira casa (3,456 → "3.46"), que é o
 * comportamento certo para um percentual de duas casas; o que NÃO se faz é truncar a parte inteira
 * de um número que não cabe — isso transformaria 12,5% em 2,50% em silêncio.
 */
export function formatarPAliq(valor) {
  // ⚠⚠ GUARDA POR TIPO ACEITO, não por lista de recusas. A primeira versão fazia
  // `Number(String(valor ?? ""))` e devolvia **`"0.00"` para `null`** — porque `Number("")` é 0,
  // que é finito e cabe na faixa. Ou seja: alíquota que ninguém declarou virava alíquota ZERO
  // declarada, num campo de documento fiscal. Achado pelo próprio teste, e é a TERCEIRA vez que
  // esta família aparece nesta entrega (`dispensadaPeloPiso`, `normalizarItemLc116`, e aqui).
  const ehNumero = typeof valor === "number";
  const ehTextoUtil = typeof valor === "string" && valor.trim() !== "";
  if (!ehNumero && !ehTextoUtil) return null;
  const n = ehNumero ? valor : Number(valor.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= ALIQUOTA_MAXIMA_DO_CAMPO) return null;
  const texto = n.toFixed(2);
  return FORMA_TSDEC1V2.test(texto) ? texto : null;
}

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Decide se `pAliq` vai na DPS, e com que valor.
 *
 * @param {object} p
 * @param {string} p.opSimpNac    `1` não optante · `2` MEI · `3` ME/EPP
 * @param {string} p.regApTribSN  `1` · `2` · `3` — só existe quando `opSimpNac = 3`
 * @param {string} p.tpRetISSQN   `1` não retido · `2` tomador · `3` intermediário
 * @param {number|string|null} p.aliquota  a alíquota declarada (perfil, ou payload no caminho antigo)
 */
export function pAliqDaDps({ opSimpNac, regApTribSN, tpRetISSQN, aliquota }) {
  const retido = tpRetISSQN === "2" || tpRetISSQN === "3";

  // ── O ÚNICO RAMO QUE A NORMA DECIDE SEM O STATUS DO CONVÊNIO ─────────────────────────────
  if (opSimpNac === "3" && regApTribSN === "1") {
    if (!retido) {
      // E0625 (convênio ativo) e E0631 (não ativo) dizem a MESMA coisa: proibido. Por isso o
      // campo não vai — mesmo que o contador tenha declarado uma alíquota no perfil. ⚠ Não é
      // descarte silencioso: o motivo viaja, e a tela do contador pode dizê-lo.
      return {
        ok: true,
        decisao: DECISAO.PROIBIDO,
        informar: false,
        regras: ["E0625", "E0631"],
        motivo:
          "No Simples com apuração do ISSQN pelo Simples Nacional e SEM retenção, informar a "
          + "alíquota é proibido — a nota é rejeitada com ela.",
      };
    }

    const n = numero(aliquota);
    if (n === null) {
      return {
        ok: false,
        codigo: "NFSE_PALIQ_OBRIGATORIA_AUSENTE",
        message:
          "Esta nota tem ISS retido pelo tomador e a empresa é do Simples Nacional: a alíquota do "
          + "ISSQN é obrigatória na DPS (regras E0621/E0628), e nenhuma foi declarada.",
        correcao:
          "O contador declara a alíquota de ISS no perfil de emissão da empresa. "
          + `O mínimo aceito neste cenário é ${ALIQUOTA_MINIMA_COM_RETENCAO}%.`,
        regras: ["E0621", "E0628"],
      };
    }
    if (n < ALIQUOTA_MINIMA_COM_RETENCAO) {
      // ⚠ A observação está NAS DUAS regras: *"o percentual da alíquota mínima informada permitida
      // é 1,8%"*. Recusar aqui evita um round-trip para descobrir algo que está no nosso disco.
      return {
        ok: false,
        codigo: "NFSE_PALIQ_ABAIXO_DO_MINIMO",
        message:
          `A alíquota declarada (${n}%) é menor que o mínimo de ${ALIQUOTA_MINIMA_COM_RETENCAO}% `
          + "permitido quando há retenção do ISSQN no Simples Nacional (E0621/E0628).",
        correcao: "Corrija a alíquota de ISS no perfil de emissão da empresa.",
        regras: ["E0621", "E0628"],
      };
    }
    const texto = formatarPAliq(n);
    if (!texto) {
      return {
        ok: false,
        codigo: "NFSE_PALIQ_FORA_DO_CAMPO",
        message:
          `A alíquota declarada (${n}%) não cabe no campo da DPS: o leiaute aceita um dígito `
          + "inteiro e duas casas (`TSDec1V2`), ou seja, no máximo 9,99%.",
        correcao:
          "Confira a alíquota de ISS no perfil de emissão — o ISS tem teto de 5% (LC 116, art. 8º-A).",
        regras: ["TSDec1V2"],
      };
    }
    return {
      ok: true,
      decisao: DECISAO.EMITIR,
      informar: true,
      pAliq: texto,
      regras: ["E0621", "E0628"],
    };
  }

  // ── O RESTO DEPENDE DO CONVÊNIO DO MUNICÍPIO, QUE NÃO TEMOS ──────────────────────────────
  //
  // ⚠⚠ AQUI NÃO SE CHUTA, E TAMBÉM NÃO SE RECUSA. Recusar quebraria a emissão que funciona hoje
  // (as notas do Lucro Presumido saem sem `pAliq` e são aceitas em produção — o que sugere, sem
  // provar, que o convênio do município delas está ativo). O comportamento fica **exatamente o de
  // hoje** — sem `pAliq` —, e o risco sai NOMEADO para quem consumir.
  const naoDecidivel = (regras, motivo) => ({
    ok: true,
    decisao: DECISAO.NAO_DECIDIVEL,
    informar: false,
    regras,
    motivo,
  });

  if (opSimpNac === "3") {
    return naoDecidivel(
      ["E0635", "E0640"],
      "Com apuração do ISSQN fora do Simples Nacional (regApTribSN 2 ou 3), a alíquota é proibida "
      + "se o convênio do município estiver ativo e obrigatória se não estiver. O status do "
      + "convênio não está neste projeto, então a nota sai como hoje: sem alíquota.",
    );
  }
  return naoDecidivel(
    ["E0617", "E0619"],
    "Fora do Simples Nacional, a alíquota é proibida se o convênio do município estiver ativo e "
    + "obrigatória se não estiver (sem regime especial). O status do convênio não está neste "
    + "projeto, então a nota sai como hoje: sem alíquota.",
  );
}
