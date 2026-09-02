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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A CONVERSÃO PARA O `cNBS` DA DPS — e por que 292 códigos legítimos NÃO cabem lá
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `TSCodNBS` (XSD 1.01) é **`[0-9]{9}`** — nove dígitos, sem ponto. A tabela guarda a forma
// pontuada (`1.1502.10.00`), que é como a fonte oficial publica e como uma pessoa lê. Medido nos
// 1.210 códigos, contando só os dígitos:
//
//   9 dígitos  918  ← terminais; são estes que cabem na DPS
//   8 dígitos   10  ┐
//   7 dígitos   50  │ 292 NÍVEIS INTERMEDIÁRIOS da hierarquia
//   6 dígitos  130  │ (`1.0101` é o galho de `1.0101.11.00`)
//   5 dígitos  102  ┘
//
// ⚠⚠ **"NÃO TERMINAL" NÃO É "INVÁLIDO", E A RECUSA TEM DE DIZER ISSO.** `1.0101` é um código NBS
// legítimo, publicado, com descrição própria — ele só não identifica um serviço, identifica uma
// família. Chamá-lo de inválido mandaria o contador procurar erro de digitação onde o que falta é
// ESCOLHER um código mais específico. Por isso a recusa carrega os descendentes terminais: recusa
// sem saída manda quem lê adivinhar.
//
// ⚠ **NENHUM `padStart`, em nenhuma direção.** Completar `1.0101` até nove dígitos fabricaria um
// código plausível e errado — a classe do `cLocEmi="0000000"`. Cinco dígitos são cinco dígitos.
//
// ⚠ **A TABELA É A AUTORIDADE.** Nove dígitos bem formados que não estejam na lista oficial são
// recusados, e não emitidos porque "cabem no pattern". Mesma disciplina de
// `escolherCodigoServicoNacional`: o `[0-9]{9}` do XSD é FORMA; a lista é CONTEÚDO.

/** As três recusas. ⚠ `NAO_TERMINAL` é sobre a HIERARQUIA; as outras duas, sobre o código. */
export const RECUSA_NBS = Object.freeze({
  FORMA_INVALIDA: "forma_invalida",
  NAO_TERMINAL: "nao_terminal",
  FORA_DA_TABELA: "fora_da_tabela",
});

const soDigitos = (c) => c.replace(/\D/g, "");

/** ⚠ Construído uma vez: `115021000` → o registro. Só os 918 terminais entram. */
const POR_NOVE_DIGITOS = new Map(
  NBS.map((n) => [soDigitos(n.codigo), n]).filter(([d]) => d.length === 9),
);

/**
 * O `cNBS` que a DPS aceita, ou uma recusa NOMEADA.
 *
 * Aceita a forma pontuada (`1.1502.10.00`) e a de nove dígitos (`115021000`) — a segunda porque é
 * o que fica guardado depois de escolhido, e revalidá-la é o caminho normal.
 *
 * ⚠ **SÓ STRING.** Guarda por TIPO ACEITO, não por lista de recusas: um NÚMERO perderia o zero à
 * esquerda em silêncio, e a metade dos códigos da NBS começa por dígito baixo. Mesma lição de
 * `dispensadaPeloPiso` (`fiscal/retencao/`), onde enumerar as ausências deixou o `[]` escapar.
 */
export function nbsParaDps(codigo) {
  if (typeof codigo !== "string") {
    return { ok: false, motivo: RECUSA_NBS.FORMA_INVALIDA, codigo: null };
  }
  const bruto = codigo.trim();

  // A forma já pronta para a DPS. Continua passando pela tabela — o pattern do XSD é FORMA.
  if (/^\d{9}$/.test(bruto)) {
    const achado = POR_NOVE_DIGITOS.get(bruto);
    return achado
      ? { ok: true, cNBS: bruto, codigo: achado.codigo, descricao: achado.descricao ?? null }
      : { ok: false, motivo: RECUSA_NBS.FORA_DA_TABELA, codigo: bruto };
  }

  const pontuado = normalizarCodigoNbs(bruto);
  if (!pontuado) return { ok: false, motivo: RECUSA_NBS.FORMA_INVALIDA, codigo: bruto };
  if (!POR_CODIGO.has(pontuado)) {
    return { ok: false, motivo: RECUSA_NBS.FORA_DA_TABELA, codigo: pontuado };
  }

  const digitos = soDigitos(pontuado);
  if (digitos.length !== 9) {
    // ⚠ A SAÍDA VIAJA JUNTO DA RECUSA. Sem os descendentes, "escolha um mais específico" é um beco.
    return {
      ok: false,
      motivo: RECUSA_NBS.NAO_TERMINAL,
      codigo: pontuado,
      descendentes: descendentesTerminais(pontuado),
    };
  }
  // ⚠ `descricao` VIAJA COM O SUCESSO, e pode ser `null`: medido, DOIS códigos da NBS oficial
  // vêm sem descrição — `9.9999` (galho) e **`9.9999.99.99`**, que é TERMINAL e portanto
  // convertível. Ele é o "não classificado", e emiti-lo declara ao fisco um serviço sem
  // classificação. **Não é bloqueado aqui** — é código publicado e recusá-lo seria inventar
  // regra —, mas quem monta a tela precisa poder DIZER isso, e sem a descrição no retorno ela
  // não tem como. É a mesma família do `990101` da classificação e do `99.01.01` do ANEXO VIII.
  return { ok: true, cNBS: digitos, codigo: pontuado, descricao: POR_CODIGO.get(pontuado)?.descricao ?? null };
}

/**
 * Os códigos terminais abaixo de um nível da hierarquia.
 *
 * ⚠ O parentesco é por PREFIXO DE DÍGITOS, não pela contagem de pontos: a NBS mistura grupos de um
 * e de dois dígitos (`1.0101.1` e `1.0101.11.00` convivem), então contar separadores erraria.
 * ⚠ Devolve `[]` para código terminal — um terminal não tem filhos, e isso é resposta.
 */
export function descendentesTerminais(codigo) {
  const pontuado = normalizarCodigoNbs(String(codigo ?? ""));
  if (!pontuado) return [];
  const prefixo = soDigitos(pontuado);
  if (prefixo.length === 9) return [];
  return NBS.filter((n) => {
    const d = soDigitos(n.codigo);
    return d.length === 9 && d.startsWith(prefixo);
  }).map((n) => n.codigo);
}
