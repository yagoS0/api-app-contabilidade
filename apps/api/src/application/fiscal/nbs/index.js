// A NBS (Nomenclatura Brasileira de Serviços) — leitura, e nada além disso.
//
// ⚠⚠ SEM CONSUMIDOR HOJE, POR DECISÃO DO DONO (25/08/2026). O `cNBS` é campo OPCIONAL da DPS e
// este projeto não o preenche. Eu recomendei esperar haver leitor — dado que ninguém lê é o defeito
// que o próprio Perfil Fiscal tem hoje — e ele decidiu gerar agora, para estar pronta.
//
// ⚠ LIGAR O `cNBS` NA EMISSÃO MUDA O XML DE NOTA FISCAL EM PRODUÇÃO. Isso é ato do dono, não
// consequência de a tabela existir. Nada aqui é importado por `NfseService` nem por `buildDpsXml`.
//
// ⚠ NBS ≠ `cTribNac` ≠ item da LC 116 — três listas, três granularidades, três finalidades.

import { NBS } from "./nbs.data.js";

export { NBS };

const POR_CODIGO = new Map(NBS.map((n) => [n.codigo, n]));

/** ⚠ Só `trim`. Nada de `padStart`: fabricar dígito é a classe do `cLocEmi="0000000"`. */
export function normalizarCodigoNbs(bruto) {
  const t = String(bruto ?? "").trim();
  return /^\d\.\d{4}(\.\d{1,2}){0,2}$/.test(t) ? t : null;
}

/** O registro, ou `null` quando o código não está na lista. */
export function nbsPorCodigo(codigo) {
  const n = normalizarCodigoNbs(codigo);
  return n ? (POR_CODIGO.get(n) || null) : null;
}

/**
 * A descrição, ou `null`.
 *
 * ⚠ Duas linhas da NBS ("não classificado", terminais) vêm SEM descrição na planilha oficial.
 * Elas devolvem `null` — que é o que a fonte diz. Inventar um rótulo ali seria escrever o que a
 * norma não escreveu.
 */
export function descricaoNbs(codigo) {
  return nbsPorCodigo(codigo)?.descricao ?? null;
}
