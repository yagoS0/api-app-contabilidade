// QUAL CONTA ESTA DESPESA DEVE USAR — a sugestão, e de onde ela veio.
//
// ⚠⚠ ISTO SUGERE. NÃO CONTABILIZA. Nada aqui cria `AccountingEntry`, e nenhuma resposta deste
// módulo autoriza sozinha um lançamento: quem leva ao razão continua sendo o contador, confirmando
// na fila. A automação por regra (o "nível 1" do plano) é um passo à parte, e ele **não** está
// construído — ver o fim deste arquivo.
//
// ⚠ ESTE MÓDULO É PURO: sem prisma, sem relógio, sem I/O. A ligação com o banco fica no serviço.
//
// ## ⚠⚠ AS DUAS ÂNCORAS NÃO SÃO INTERCAMBIÁVEIS, E A MEDIÇÃO DIZ POR QUÊ
//
// Medido em produção (25/08/2026, `scripts/diag-fase-c.mjs`):
//
// | âncora | alcance MEDIDO | por quê |
// |---|---|---|
// | **CNPJ do fornecedor** | **140 de 211** pares empresa×fornecedor têm 2+ notas (66,4%) | a nota TRAZ o CNPJ |
// | **descrição** | **15 de 1.887** notas (0,8%) | a memória foi construída sobre memos de EXTRATO e planilha, não sobre nomes de prestadores |
//
// ⚠ A âncora por descrição **não é inútil** — ela é o caminho natural dos débitos de **OFX**, cujo
// memo bancário é exatamente o tipo de texto que `AccountingHistorico` guarda. Ela entrega pouco
// nas NOTAS e deve entregar bem nos DÉBITOS. Por isso as duas existem, e por isso o CNPJ vence.

/** ⚠ De onde a sugestão veio. Vocabulário FECHADO — vai para a tela e para a auditoria. */
export const PROCEDENCIA = Object.freeze({
  /** Regra ativa, ancorada no CNPJ do fornecedor. A mais forte: o CNPJ identifica. */
  REGRA_CNPJ: "REGRA_CNPJ",
  /** Regra ativa, ancorada na descrição normalizada. Ela se PARECE; não identifica. */
  REGRA_DESCRICAO: "REGRA_DESCRICAO",
  /** O histórico do próprio contador (`AccountingHistorico`), por descrição. */
  HISTORICO: "HISTORICO",
});

export const FRASE_DA_PROCEDENCIA = Object.freeze({
  [PROCEDENCIA.REGRA_CNPJ]: "Uma regra deste fornecedor (pelo CNPJ) aponta esta conta.",
  [PROCEDENCIA.REGRA_DESCRICAO]: "Uma regra desta descrição aponta esta conta.",
  [PROCEDENCIA.HISTORICO]: "Você já lançou esta descrição nesta conta antes.",
});

/** ⚠ Por que NÃO houve sugestão. A tela precisa distinguir "não sei" de "sei e não digo". */
export const SEM_SUGESTAO = Object.freeze({
  NADA_CONHECIDO: "nada_conhecido",
  /** ⚠⚠ Duas contas disputam a mesma chave. O sistema NÃO escolhe. */
  DIVIDIDO: "dividido",
  /** ⚠ A regra casou, mas o valor caiu fora da faixa dela. Isso é sinal, não silêncio. */
  FORA_DA_FAIXA: "fora_da_faixa",
  /** ⚠ A conta que a memória guarda não existe no plano DESTA empresa. */
  CONTA_FORA_DO_PLANO: "conta_fora_do_plano",
});

export const FRASE_DO_SEM_SUGESTAO = Object.freeze({
  [SEM_SUGESTAO.NADA_CONHECIDO]:
    "Nenhuma regra e nenhum histórico conhecem esta despesa. Escolha a conta — e o sistema aprende.",
  [SEM_SUGESTAO.DIVIDIDO]:
    "Esta despesa já foi lançada em contas diferentes. O sistema não escolhe entre elas.",
  [SEM_SUGESTAO.FORA_DA_FAIXA]:
    "Há uma regra para esta despesa, mas o valor está fora da faixa dela. Confira antes de aplicar.",
  [SEM_SUGESTAO.CONTA_FORA_DO_PLANO]:
    "A conta usada antes não existe no plano de contas desta empresa.",
});

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * ⚠⚠ A NORMALIZAÇÃO DA DESCRIÇÃO — e ela é DELIBERADAMENTE a mesma do diagnóstico.
 *
 * Maiúsculas, sem acento, pontuação vira espaço. ⚠ Ela **não** é `normalizarParaDedupe`
 * (`dedupeOfx.js`), que é congelada e existe para DISTINGUIR duas linhas do extrato — lá remover
 * números faria duas tarifas iguais colapsarem numa só. Aqui a pergunta é o oposto: **duas grafias
 * do mesmo fornecedor devem casar**.
 *
 * ⚠ Ela também não remove datas nem números de documento, e isso é uma limitação DECLARADA: o
 * plano previa `normalizarDescricao` fazendo isso, e a memória deste projeto já guarda a
 * competência canonizada como `{{competencia}}` (`historicoCompetencia.js`, no lado do web). Trazer
 * uma segunda canonização para cá faria as duas divergirem na primeira correção. Quando a âncora
 * por descrição precisar disso, o certo é REUSAR aquela, não escrever a terceira.
 */
export function chaveDaDescricao(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const naoSugere = (motivo, extra = {}) => ({
  conta: null,
  procedencia: null,
  motivo,
  frase: FRASE_DO_SEM_SUGESTAO[motivo],
  ...extra,
});

/**
 * ⚠⚠ A CONTA SUGERIDA É SEMPRE `codigoCompleto`, e a tradução acontece AQUI.
 *
 * `RegraContabilizacao.contaDestino` já guarda `codigoCompleto` (é o contrato do model). Mas
 * `AccountingHistorico.contaDebito` guarda o **REDUZIDO** — medido: 209 de 209 casam com um
 * reduzido do plano, **zero** com um `codigoCompleto`.
 *
 * ⚠ O reduzido é **mutável**; o completo é a âncora desta casa (*"eles são imutáveis enquanto os
 * reduzidos mutáveis"*). Gravar o reduzido numa regra faria a regra apontar para outra conta no dia
 * em que alguém renumerasse o plano — em silêncio, e em série.
 *
 * ⚠⚠ E a tradução é pelo plano **DESTA** empresa. Medido: hoje nenhum reduzido é ambíguo entre
 * empresas (0 de 606), mas isso é um fato de hoje, não uma garantia — o plano tem contas globais e
 * contas próprias, e nada impede uma empresa de renumerar a dela.
 */
function completoDoReduzido(reduzido, plano) {
  const alvo = String(reduzido ?? "").trim();
  if (!alvo) return null;
  const achados = (plano || []).filter((c) => String(c.codigo).trim() === alvo);
  // ⚠ Duas contas com o mesmo reduzido no MESMO plano ⇒ não se escolhe. Mesma disciplina de
  // `formaDoLancamento.js`, que recusa conta ambígua em vez de eleger uma.
  if (achados.length !== 1) return null;
  return String(achados[0].codigoCompleto);
}

/** ⚠ A regra casa pelo CNPJ **ou** pela descrição — nunca por semelhança, nunca por valor sozinho. */
function regraCasa(regra, { cnpj, descricaoNormalizada }) {
  if (regra?.cnpjFornecedor && cnpj && soDigitos(regra.cnpjFornecedor) === cnpj) return PROCEDENCIA.REGRA_CNPJ;
  if (regra?.padraoDescricao && descricaoNormalizada && chaveDaDescricao(regra.padraoDescricao) === descricaoNormalizada) {
    return PROCEDENCIA.REGRA_DESCRICAO;
  }
  return null;
}

/**
 * ⚠⚠ AUSÊNCIA NÃO É ZERO — e a guarda anterior era CÓDIGO MORTO.
 *
 * Achado por auditoria em 25/08/2026: `Number.isFinite(Number(null))` é **`true`**, porque
 * `Number(null)` é `0`. A guarda de finitude, escrita justamente para pegar faixa ausente, não
 * pegava nada — `valorMin: null` virava **R$ 0,00** e a metade inferior da faixa sumia em silêncio.
 *
 * ⚠ E a faixa é o que impede uma regra de aplicar a conta de uma mensalidade de R$ 300 a uma compra
 * de R$ 30.000 do mesmo fornecedor. Sem piso, ela deixa de fazer isso sem nada na tela dizer.
 *
 * Mesma família do `folhaAusenteNaoEZero` e do "0%" que já foi parar na tela do cliente.
 */
const numeroDeVerdade = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const dentroDaFaixa = (valor, regra) => {
  const v = numeroDeVerdade(valor);
  const min = numeroDeVerdade(regra?.valorMin);
  const max = numeroDeVerdade(regra?.valorMax);
  // ⚠ Faltando qualquer um dos três, a regra NÃO se aplica. Faixa incompleta é faixa ausente, e
  // faixa ausente casa com tudo — que é o oposto do que ela existe para fazer.
  if (v === null || min === null || max === null) return false;
  return v >= min && v <= max;
};

/**
 * A sugestão de conta para UM declarado.
 *
 * A ordem é FECHADA e para na primeira que casar:
 *
 *   1. regra ativa por **CNPJ**   — a âncora forte: o CNPJ identifica o fornecedor
 *   2. regra ativa por **descrição** — a âncora fraca: ela se parece
 *   3. **histórico** do contador (`AccountingHistorico`), por descrição
 *   4. nada
 *
 * ⚠⚠ **CNPJ VENCE DESCRIÇÃO** quando as duas casam, e não é preferência: o CNPJ **identifica**, a
 * descrição apenas **se parece**. Duas empresas podem ter descrições quase iguais; o CNPJ é único.
 *
 * @param {object} declarado   `{ cnpjFornecedor, descricaoOriginal, valor, valorAjustado }`
 * @param {object} contexto    `{ regras, historico, plano }`
 * @returns {{conta: string|null, procedencia: string|null, motivo: string|null, frase: string, regraId?: string}}
 */
export function sugerirConta(declarado, { regras = [], historico = [], plano = [] } = {}) {
  const cnpj = soDigitos(declarado?.cnpjFornecedor);
  const descricaoNormalizada = chaveDaDescricao(declarado?.descricaoOriginal);
  // ⚠ O valor AJUSTADO vence o original — é ele que vira lançamento, e é ele que a faixa avalia.
  const valor = declarado?.valorAjustado ?? declarado?.valor;

  // ── 1 e 2. AS REGRAS ────────────────────────────────────────────────────────────────────────
  // ⚠ Só regra ATIVA e NÃO SUSPENSA entra. Uma regra suspensa continua existindo (a tela a mostra,
  // com o motivo) e **não** decide nada — suspender é o freio, e um freio que ainda dirige não é freio.
  const vivas = (regras || []).filter((r) => r?.ativa !== false && !r?.suspensaEm && !r?.revogadaEm);

  const porCnpj = vivas.filter((r) => regraCasa(r, { cnpj, descricaoNormalizada }) === PROCEDENCIA.REGRA_CNPJ);
  const porDescricao = vivas.filter(
    (r) => regraCasa(r, { cnpj, descricaoNormalizada }) === PROCEDENCIA.REGRA_DESCRICAO,
  );

  for (const [lista, procedencia] of [
    [porCnpj, PROCEDENCIA.REGRA_CNPJ],
    [porDescricao, PROCEDENCIA.REGRA_DESCRICAO],
  ]) {
    if (!lista.length) continue;

    // ⚠⚠ A FAIXA FILTRA **ANTES** DE A AMBIGUIDADE SER JULGADA — e a ordem inversa anulava a faixa.
    //
    // Achado por auditoria em 25/08/2026: o conjunto de contas saía da lista INTEIRA, então duas
    // regras do mesmo fornecedor com faixas DISJUNTAS (`[100,500] → conta A` e `[20000,40000] →
    // conta B`) eram lidas como conflito, e um débito de R$ 300 não recebia sugestão nenhuma.
    //
    // ⚠ Isso é literalmente o cenário que justifica a faixa existir — mensalidade × compra grande
    // do mesmo fornecedor. Ela deveria SEPARAR as duas; julgando antes, o motor calava.
    const naFaixa = lista.filter((r) => dentroDaFaixa(valor, r));

    // ⚠⚠ DUAS REGRAS APLICÁVEIS APONTANDO CONTAS DIFERENTES ⇒ NENHUMA VALE. Escolher "a mais
    // recente" ou "a primeira" poria a despesa numa conta que o contador não escolheu, em série —
    // é o mesmo raciocínio do `AMBIGUO` do casamento e do código de serviço.
    const contas = new Set(naFaixa.map((r) => String(r.contaDestino)));
    if (contas.size > 1) return naoSugere(SEM_SUGESTAO.DIVIDIDO, { procedenciaTentada: procedencia });

    if (!naFaixa.length) {
      // ⚠ "Casou a âncora e o valor fugiu da faixa" NÃO é silêncio: é sinal. A faixa existe para
      // pegar o fornecedor conhecido com um valor 10× fora do normal, e sumir com o aviso
      // desperdiçaria exatamente a informação que ela produz.
      return naoSugere(SEM_SUGESTAO.FORA_DA_FAIXA, {
        procedenciaTentada: procedencia,
        regraId: lista[0].id ?? null,
      });
    }

    const regra = naFaixa[0];
    // ⚠⚠ A CONTA DA REGRA TAMBÉM É CONFERIDA CONTRA O PLANO — achado por auditoria em 25/08/2026.
    //
    // O caminho do HISTÓRICO já recusava conta fora do plano; o da REGRA não conferia nada. Uma
    // conta apagada do plano depois de a regra nascer virava sugestão que a tela mostra e o
    // `montarLancamento` recusa no clique — a tela oferecendo o que o servidor nega.
    //
    // ⚠ `contaDestino` já é `codigoCompleto` (contrato do model), então aqui se confere existência,
    // não se traduz. `String(null)` seria a string `"null"` — por isso a checagem vem antes.
    const contaDaRegra = regra?.contaDestino ? String(regra.contaDestino) : null;
    if (!contaDaRegra || !(plano || []).some((c) => String(c.codigoCompleto) === contaDaRegra)) {
      return naoSugere(SEM_SUGESTAO.CONTA_FORA_DO_PLANO, { procedenciaTentada: procedencia, regraId: regra?.id ?? null });
    }

    return {
      conta: contaDaRegra,
      procedencia,
      motivo: null,
      frase: FRASE_DA_PROCEDENCIA[procedencia],
      regraId: regra.id ?? null,
    };
  }

  // ── 3. O HISTÓRICO ──────────────────────────────────────────────────────────────────────────
  // ⚠⚠ `AccountingHistorico` guarda o REDUZIDO, e por isso passa pela tradução.
  if (descricaoNormalizada) {
    const casam = (historico || []).filter(
      (h) => h?.contaDebito && chaveDaDescricao(h.text) === descricaoNormalizada,
    );
    if (casam.length) {
      const reduzidos = new Set(casam.map((h) => String(h.contaDebito).trim()));
      // ⚠⚠ HISTÓRICO DIVIDIDO NÃO SUGERE. A mesma descrição em duas contas quer dizer que o
      // contador já mudou de ideia — ou que a descrição é genérica demais para identificar.
      if (reduzidos.size > 1) return naoSugere(SEM_SUGESTAO.DIVIDIDO);

      const completo = completoDoReduzido([...reduzidos][0], plano);
      // ⚠ A conta pode não existir no plano DESTA empresa (a memória tem registros globais). Isso é
      // uma resposta nomeada, não um silêncio: o contador precisa saber que havia memória.
      if (!completo) return naoSugere(SEM_SUGESTAO.CONTA_FORA_DO_PLANO);

      return {
        conta: completo,
        procedencia: PROCEDENCIA.HISTORICO,
        motivo: null,
        frase: FRASE_DA_PROCEDENCIA[PROCEDENCIA.HISTORICO],
        regraId: null,
      };
    }
  }

  return naoSugere(SEM_SUGESTAO.NADA_CONHECIDO);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE ESTE MÓDULO NÃO FAZ, E É DECISÃO — NÃO LACUNA
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// **Ele não contabiliza nada.** O plano previa um "nível 1" em que a regra ativa lança direto, sem
// clique. Isso **não** está construído aqui, e a razão é o peso do ato: um lançamento contábil
// nascido sozinho, numa conta errada, erra **em série** e em silêncio — e o dono é contador.
//
// A estrutura para isso já existe (faixa de valor obrigatória, `regraId` no declarado, procedência
// gravada, desfazer transacional). O que falta é a **decisão do dono** de ligar, e o extrato mensal
// "lançados por regra" para ele poder desfazer em lote. Está nomeado no `CLAUDE.md` do módulo.
