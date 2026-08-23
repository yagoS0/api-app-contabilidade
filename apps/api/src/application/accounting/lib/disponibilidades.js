/**
 * DISPONIBILIDADES — CAIXA e BANCOS pela ESTRUTURA do código completo. Módulo PURO (sem prisma).
 *
 * A regra, uma frase: **o que diz se uma conta é caixa ou banco é o PREFIXO do `codigoCompleto`,
 * nunca o nome.**
 *
 * ## Por que existe (decisão do dono, 21/08/2026)
 *
 * Até aqui a única identificação de caixa era `resolveCaixaAccount` (`InssPagamentoService.js`),
 * que casa o NOME da conta contra uma lista de textos ("caixa matriz", "banco itau", …). Isso
 * pré-preenche um modal e para isso serve; **não serve de base para um demonstrativo de fluxo de
 * caixa**, que é para onde vai. O dono pediu para trocar a lista de textos por um padrão.
 *
 * ## ⚠ O PADRÃO NÃO É O DA RECEITA FEDERAL — e isso foi medido, não suposto
 *
 * O dono supôs que existisse um plano da RFB obrigatório para todas as empresas, e que bater contra
 * ele resolveria. **A premissa não se sustenta**, por três motivos apurados em 21/08/2026:
 *
 * 1. O que a RFB publica é o **Plano de Contas Referencial** das *Tabelas Dinâmicas* da ECD/ECF
 *    (tabelas `L100A` — patrimoniais — e `L300A` — resultado; há versões por perfil: PJ em geral,
 *    instituições financeiras, seguradoras, imunes/isentas). Ele **não substitui** o plano da
 *    empresa: no registro **I051 da ECD** o contador AMARRA cada conta analítica própria à conta
 *    referencial, uma a uma. Ou seja, o referencial é o DESTINO de um de-para feito à mão — não é
 *    uma chave que a gente possa calcular.
 * 2. **Não dá para afirmar que é obrigatório para os nossos clientes — nem que não é.** Medido:
 *    **23 Simples Nacional e 11 LUCRO PRESUMIDO** em 34 empresas. Pela IN RFB nº 2003/2021, art. 3º,
 *    o Simples é dispensado (§ 1º, I), mas o Lucro Presumido só é dispensado **condicionalmente**
 *    (§ 1º, V + § 3º): depende de manter Livro Caixa e de quanto distribuiu de lucro sem IRRF — dois
 *    fatos que **não existem no nosso schema**. Logo: pergunta ao dono, não conclusão do sistema.
 *    ⚠ Detalhe da medição em `CLAUDE.md` desta pasta — inclusive a armadilha de contar regime por
 *    `CadastroFiscal` (cobre 4 de 34) em vez de `Company.regimeTributario` (cobre 34 de 34).
 * 3. **Não temos o de-para em lugar nenhum.** `ChartOfAccount` não tem campo de conta referencial,
 *    e não há tabela nem importação disso no projeto. Construir o de-para por conta própria só
 *    daria certo casando o NOME das nossas contas com o NOME das contas do referencial — que é
 *    exatamente o palpite textual do qual estamos saindo, agora com uma etapa a mais.
 *
 * ⚠ **A intuição do dono continua certa por outro caminho.** O plano REALMENTE é praticamente o
 * mesmo para todas as empresas — não por causa da RFB, mas porque **nós servimos um plano global**:
 * 593 contas com `portalClientId = null` atendem 33 dos 34 clientes (uma única empresa tem plano
 * próprio, com 606 contas quase idênticas). E esse plano global **já traz uma hierarquia estável no
 * `codigoCompleto`**, de largura fixa por nível: `1` · `2` · `3` · `5` · `9` caracteres
 * (`1` → `11` → `111` → `11101` → `111010001`), com cobertura de **98,9%** (13 contas de 1199 sem
 * `codigoCompleto`). É esse o padrão que sustenta a identificação — de graça, já no banco, sem
 * tabela externa para acompanhar.
 *
 * ## O que foi medido no plano real (21/08/2026, produção, somente leitura)
 *
 * | `codigoCompleto` | nome no plano | n |
 * |---|---|---|
 * | `111`   | DISPONIVEL                     | 52 contas na subárvore |
 * | `11101` | CAIXA GERAL                    | → CAIXA |
 * | `11102` | BANCOS - CONTAS COM MOVIMENTOS | → BANCOS |
 * | `11103` | APLICACOES DE LIQUIDEZ IMEDIATA | → APLICACOES |
 *
 * ⚠ **A contraprova é o que dá valor a isto.** 55 contas citam "caixa" ou "banco" no nome, e só 38
 * estão sob `111`. As outras 17 são **passivo e realizável**: `112030001` DUPLICATAS DESCONTADAS
 * BANCO ITAU, `211060001` EMPRESTIMOS BANCO ITAU CONTRATO XXXXXX, `221010001` EMPRESTIMO BANCO
 * ITAU. Um demonstrativo de caixa alimentado por nome somaria empréstimo bancário como
 * disponibilidade. O prefixo não erra isso.
 *
 * ## ⚠ SEMPRE PELO `codigoCompleto`, NUNCA PELO REDUZIDO
 *
 * Medido na base: **518 contas** têm o primeiro dígito do reduzido diferente do primeiro dígito do
 * completo. O caso didático é o reduzido `"5"` = CAIXA - MATRIZ contra o completo `"5"` =
 * (-) IRPJ/CSLL. Agrupar pelo reduzido troca disponibilidade por dedução de resultado **sem erro
 * nenhum na tela**.
 *
 * ## ⚠ O MODO DE FALHAR É PARTE DA REGRA — ausência declarada vence afirmação falsa
 *
 * Conta que não tem `codigoCompleto` sai como **`INDETERMINADO`**, com o nome, para o contador
 * decidir. Ela **nunca** vira "não é caixa" em silêncio — são 13 contas hoje, **todas da SINTROPIA
 * TECNOLOGIA LTDA**, a única empresa com plano próprio e ela mesma Lucro Presumido (`DISTRIBUICAO DO
 * SOCIO …`, `(-) ANTECIPACAO DE LUCROS E DIVIDENDOS`); afirmar que não são
 * disponibilidade é uma afirmação que não temos como fazer. Do mesmo modo, conta que está sob `111`
 * mas fora dos três ramos conhecidos sai como **`DISPONIVEL_NAO_CLASSIFICADO`**: sabemos que é
 * disponibilidade, não sabemos se é caixa ou banco. Quem consome tem de mostrar as duas listas.
 *
 * ## ⚠ O NOME É TRIPWIRE, NUNCA CLASSIFICADOR
 *
 * `conferirAncoras` compara o nome das contas âncora (`11101`, `11102`, `11103`) com o que foi
 * medido. Ele **não classifica nada** — serve para gritar se o plano global for reimportado com
 * outra numeração, em vez de o sistema seguir classificando pelo prefixo antigo, calado.
 */

/** Os ramos de disponibilidade, ancorados no `codigoCompleto`. Medidos no plano real em 21/08/2026. */
export const ANCORAS_DISPONIBILIDADE = Object.freeze({
  /** Raiz das disponibilidades. Tudo que classificamos como caixa/banco está sob ela. */
  DISPONIVEL: Object.freeze({ codigoCompleto: "111", nomeMedido: "DISPONIVEL" }),
  CAIXA: Object.freeze({ codigoCompleto: "11101", nomeMedido: "CAIXA GERAL" }),
  BANCOS: Object.freeze({ codigoCompleto: "11102", nomeMedido: "BANCOS - CONTAS COM MOVIMENTOS" }),
  APLICACOES: Object.freeze({ codigoCompleto: "11103", nomeMedido: "APLICACOES DE LIQUIDEZ IMEDIATA" }),
});

/** As classes que `classificarDisponibilidade` pode devolver. Fechada de propósito. */
export const CLASSE = Object.freeze({
  CAIXA: "CAIXA",
  BANCOS: "BANCOS",
  APLICACOES: "APLICACOES",
  /** Está sob `111`, mas em ramo que não conhecemos. Sabemos que é disponibilidade; não sabemos qual. */
  DISPONIVEL_NAO_CLASSIFICADO: "DISPONIVEL_NAO_CLASSIFICADO",
  /** Tem código completo e ele está fora de `111`. É a única classe que AFIRMA "não é caixa". */
  NAO_DISPONIVEL: "NAO_DISPONIVEL",
  /** Sem `codigoCompleto`: não há resposta. ⚠ NUNCA colapsar em `NAO_DISPONIVEL`. */
  INDETERMINADO: "INDETERMINADO",
});

/** Normaliza o código completo para comparação: string sem espaços. Vazio vira `null`. */
export function normalizarCodigoCompleto(valor) {
  const texto = String(valor ?? "").trim();
  return texto === "" ? null : texto;
}

/**
 * `codigo` está na subárvore de `prefixo`? Verdadeiro para a própria âncora e para as descendentes.
 *
 * ⚠ Prefixo de STRING sobre largura FIXA por nível. É seguro aqui porque os níveis do plano têm
 * largura fixa (1/2/3/5/9), então `"1110"` não existe para colidir com `"111"`. Num plano de largura
 * livre isso seria falso — por isso a checagem vive neste módulo, junto da medição que a sustenta.
 */
export function sobPrefixo(codigoCompleto, prefixo) {
  const codigo = normalizarCodigoCompleto(codigoCompleto);
  if (!codigo) return false;
  return codigo === prefixo || codigo.startsWith(prefixo);
}

/**
 * Classifica UMA conta. Só olha `codigoCompleto`; o nome não entra na decisão.
 * @param {{codigoCompleto?: string|null}} conta
 * @returns {string} um valor de `CLASSE`
 */
export function classificarDisponibilidade(conta) {
  const codigo = normalizarCodigoCompleto(conta?.codigoCompleto);
  if (!codigo) return CLASSE.INDETERMINADO;
  if (!sobPrefixo(codigo, ANCORAS_DISPONIBILIDADE.DISPONIVEL.codigoCompleto)) return CLASSE.NAO_DISPONIVEL;
  if (sobPrefixo(codigo, ANCORAS_DISPONIBILIDADE.CAIXA.codigoCompleto)) return CLASSE.CAIXA;
  if (sobPrefixo(codigo, ANCORAS_DISPONIBILIDADE.BANCOS.codigoCompleto)) return CLASSE.BANCOS;
  if (sobPrefixo(codigo, ANCORAS_DISPONIBILIDADE.APLICACOES.codigoCompleto)) return CLASSE.APLICACOES;
  return CLASSE.DISPONIVEL_NAO_CLASSIFICADO;
}

/**
 * Classifica um plano inteiro e devolve as listas SEPARADAS — inclusive as que não sabemos.
 *
 * ⚠ Devolve `indeterminadas` e `disponiveisNaoClassificadas` NOMEADAS. Quem consome é obrigado a
 * decidir o que faz com elas; esconder é que não é opção.
 *
 * @param {Array<{codigo?: string, codigoCompleto?: string|null, nome?: string}>} contas
 */
export function separarDisponibilidades(contas) {
  const saida = {
    caixa: [], bancos: [], aplicacoes: [],
    disponiveisNaoClassificadas: [], indeterminadas: [], naoDisponiveis: [],
  };
  for (const conta of contas || []) {
    const classe = classificarDisponibilidade(conta);
    const item = { ...conta, classe };
    if (classe === CLASSE.CAIXA) saida.caixa.push(item);
    else if (classe === CLASSE.BANCOS) saida.bancos.push(item);
    else if (classe === CLASSE.APLICACOES) saida.aplicacoes.push(item);
    else if (classe === CLASSE.DISPONIVEL_NAO_CLASSIFICADO) saida.disponiveisNaoClassificadas.push(item);
    else if (classe === CLASSE.INDETERMINADO) saida.indeterminadas.push(item);
    else saida.naoDisponiveis.push(item);
  }
  return saida;
}

/**
 * TRIPWIRE. Confere se as contas âncora ainda têm o nome que foi medido em 21/08/2026.
 *
 * ⚠ Não classifica e não corrige nada: devolve a divergência para quem chama decidir. Existe porque
 * uma reimportação do plano global com outra numeração deixaria a classificação por prefixo errada
 * **em silêncio** — este é o único ponto em que o nome é olhado, e é para desconfiar dele.
 *
 * @returns {{ok: boolean, problemas: Array<{codigoCompleto: string, esperado: string, encontrado: string|null}>}}
 */
export function conferirAncoras(contas) {
  const porCodigo = new Map();
  for (const c of contas || []) {
    const k = normalizarCodigoCompleto(c?.codigoCompleto);
    if (k && !porCodigo.has(k)) porCodigo.set(k, c);
  }
  const problemas = [];
  const normalizar = (v) => String(v ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  for (const ancora of Object.values(ANCORAS_DISPONIBILIDADE)) {
    const achada = porCodigo.get(ancora.codigoCompleto);
    const encontrado = achada ? String(achada.nome ?? "") : null;
    if (achada === undefined || normalizar(encontrado) !== normalizar(ancora.nomeMedido)) {
      problemas.push({ codigoCompleto: ancora.codigoCompleto, esperado: ancora.nomeMedido, encontrado });
    }
  }
  return { ok: problemas.length === 0, problemas };
}
