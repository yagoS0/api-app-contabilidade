/**
 * O DRE GERENCIAL — a REGRA PURA (29/08/2026).
 *
 * > Dono: *"a nossa DRE para o cliente deve ser montada baseada no nosso plano de contas."*
 *
 * O desenho inteiro está em `docs/dre-fluxo-caixa.md` §3.1, **conferido contra SINTROPIA, LENTE e
 * ERISANGELA** antes de qualquer linha ser escrita. Nada aqui é tabela de mapeamento nova: **a
 * hierarquia do plano É a árvore**, e cada linha do DRE sai de um PREFIXO de `codigoCompleto`.
 *
 * ⚠⚠ **A CHAVE É `codigoCompleto`, NUNCA O REDUZIDO.** Medido: 41 contas têm os dois apontando para
 * grupos diferentes — reduzido `5` é CAIXA-MATRIZ, completo `5` é IRPJ/CSLL. Usar o reduzido troca
 * receita por despesa **sem erro nenhum**.
 *
 * ⚠⚠ **O SINAL É DECLARADO, nunca inferido de `natureza`:** grupo 3 soma `C − D`; grupos 4 e 5
 * somam `D − C`. Com isso `33 (-) DEDUÇÕES` sai NEGATIVO dentro do grupo 3, e o total do grupo já é
 * a receita líquida — que é o que o dono quer ver.
 *
 * ⚠⚠ **ISTO NÃO É PEÇA FISCAL, e o nome tem de dizer.** O projeto já recusa entregar balanço e
 * balancete a partir de lançamentos (`features/relatorios`); "DRE gerencial" e "não é peça fiscal"
 * são obrigatórios na tela.
 *
 * ⚠ Esta regra **não classifica, não escreve, não corrige conta e não chama nada externo**.
 */

/**
 * ⚠⚠ AS LINHAS, e a ordem é a do §3.1 — ela não é estética: cada subtotal depende do que veio antes.
 *
 * `prefixos` é lista FECHADA. Conta cujo `codigoCompleto` não comece por nenhum deles cai em **NÃO
 * CLASSIFICADO**, nomeada — nunca num balde "outros", que a esconderia dentro de um número.
 *
 * ⚠ `41104 DESPESAS FINANCEIRAS` vive dentro de `411 DESPESAS ADMINISTRATIVAS` no plano e SAI de lá
 * aqui — decisão do dono, 21/08/2026, e é a **única reordenação autorizada**. Ela é do DRE, não do
 * plano: nenhuma conta muda de pai, nenhum `codigoCompleto` é reescrito, nenhuma migration.
 * ⚠⚠ A consequência tem de aparecer na tela: o subtotal administrativo do DRE fica MENOR que a soma
 * das filhas de `411` no plano, e quem conferir contra o razão vai bater nessa diferença.
 * ⚠ Por isso `41102` (gerais) exclui explicitamente o que foi remanejado — ver `EXCLUSOES`.
 */
export const LINHAS_DO_DRE = Object.freeze([
  { chave: "receitaBruta", rotulo: "Receita bruta", tipo: "linha", grupo: 3, prefixos: ["311"] },
  { chave: "deducoes", rotulo: "(-) Deduções", tipo: "linha", grupo: 3, prefixos: ["33"] },
  { chave: "receitaLiquida", rotulo: "= Receita líquida", tipo: "subtotal", soma: ["receitaBruta", "deducoes"] },
  { chave: "custos", rotulo: "(-) Custos", tipo: "linha", grupo: 4, prefixos: ["42"], sinal: -1 },
  { chave: "lucroBruto", rotulo: "= Lucro bruto", tipo: "subtotal", soma: ["receitaLiquida", "custos"] },
  { chave: "pessoal", rotulo: "(-) Despesas com pessoal", tipo: "linha", grupo: 4, prefixos: ["41101"], sinal: -1 },
  { chave: "gerais", rotulo: "(-) Despesas gerais", tipo: "linha", grupo: 4, prefixos: ["41102"], sinal: -1 },
  { chave: "tributarias", rotulo: "(-) Despesas tributárias", tipo: "linha", grupo: 4, prefixos: ["41103"], sinal: -1 },
  { chave: "depreciacao", rotulo: "(-) Depreciação/amortização", tipo: "linha", grupo: 4, prefixos: ["41105"], sinal: -1 },
  {
    chave: "resultadoOperacional",
    rotulo: "= Resultado operacional",
    tipo: "subtotal",
    soma: ["lucroBruto", "pessoal", "gerais", "tributarias", "depreciacao"],
  },
  // ⚠ O BLOCO FINANCEIRO — fora do operacional, por decisão do dono (21/08/2026).
  { chave: "receitasFinanceiras", rotulo: "(+) Receitas financeiras", tipo: "linha", grupo: 3, prefixos: ["312"] },
  { chave: "despesasFinanceiras", rotulo: "(-) Despesas financeiras", tipo: "linha", grupo: 4, prefixos: ["41104"], sinal: -1 },
  { chave: "outrasReceitas", rotulo: "(+) Outras receitas operacionais", tipo: "linha", grupo: 3, prefixos: ["32"] },
  { chave: "irpjCsll", rotulo: "(-) IRPJ/CSLL", tipo: "linha", grupo: 5, prefixos: ["5"], sinal: -1 },
  {
    chave: "resultadoDoPeriodo",
    rotulo: "= Resultado do período",
    tipo: "resultado",
    soma: [
      "resultadoOperacional", "receitasFinanceiras", "despesasFinanceiras",
      "outrasReceitas", "irpjCsll",
    ],
  },
]);

/**
 * ⚠⚠ AS TRÊS CAUSAS DE "NÃO CLASSIFICADO", separadas porque o CONSERTO é diferente.
 *
 * Medido na base: a conta EM BRANCO carrega R$ 687.355,94 — dos quais R$ 321.822,26 de RECEITA e
 * R$ 20.274,56 de DAS. Some com essa linha e a empresa some do DRE.
 *
 * ⚠ Conta em branco **não é erro**: a provisão de guia nasce assim, e é estado legítimo. As outras
 * duas são: conta que não existe no plano da empresa, e conta sem `codigoCompleto` (não reimportada).
 */
export const CAUSA_NAO_CLASSIFICADO = Object.freeze({
  CONTA_EM_BRANCO: "conta_em_branco",
  FORA_DO_PLANO: "fora_do_plano",
  SEM_CODIGO_COMPLETO: "sem_codigo_completo",
});

export const FRASE_DA_CAUSA = Object.freeze({
  [CAUSA_NAO_CLASSIFICADO.CONTA_EM_BRANCO]:
    "Estas linhas ainda não têm conta contábil. É um estado normal — a provisão de guia nasce assim —, e o seu contador ainda vai classificá-las.",
  [CAUSA_NAO_CLASSIFICADO.FORA_DO_PLANO]:
    "Estas linhas usam uma conta que não existe no plano de contas desta empresa.",
  [CAUSA_NAO_CLASSIFICADO.SEM_CODIGO_COMPLETO]:
    "Estas contas não têm o código completo gravado, então não dá para saber em que grupo do DRE elas entram.",
});

/**
 * ⚠⚠ O QUE UM PREFIXO **NÃO** PEGA — e a exclusão é o que impede a conta de entrar DUAS vezes.
 *
 * `41102` não exclui nada (ela é irmã de `41104`, não mãe). O caso real é o prefixo mais CURTO
 * engolindo o mais longo: sem isto, `5` (IRPJ/CSLL) e qualquer prefixo futuro de um dígito somariam
 * o que já foi contado. ⚠ A lista é FECHADA e vazia hoje **de propósito**: os prefixos do §3.1 não
 * se contêm. Ela existe para o dia em que alguém acrescentar um que contenha — e para esse dia
 * chegar com um lugar declarado, em vez de um número silenciosamente dobrado.
 */
const EXCLUSOES = Object.freeze({});

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string" || !v.trim()) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * ⚠ ZERO É ZERO — nunca `-0`.
 *
 * `0 * -1` em JS dá `-0`, e ele sobrevive: `Object.is(-0, 0)` é `false`, e um formatador que
 * respeite o sinal imprime **"-R$ 0,00"** numa linha que simplesmente não teve movimento. O JSON o
 * serializa como `0`, então o defeito não chega ao navegador por esse caminho — mas chega a
 * qualquer consumidor que leia o objeto direto (o próximo serviço, um teste, o extrato).
 */
const semZeroNegativo = (n) => (n === 0 ? 0 : n);

/**
 * ⚠ A qual LINHA do DRE um `codigoCompleto` pertence — ou `null`.
 *
 * ⚠⚠ **O PREFIXO MAIS LONGO VENCE**, e isso não é detalhe: `41104` casa com `41104` e com nada mais
 * na lista, mas um prefixo futuro de `4` casaria com tudo do grupo 4. Escolher o mais longo é o que
 * mantém a linha específica ganhando da genérica — a mesma regra que `filhasDiretas` já aplica.
 */
export function linhaDoCodigo(codigoCompleto) {
  const c = texto(codigoCompleto);
  if (!c) return null;
  let escolhida = null;
  let tamanho = -1;
  for (const linha of LINHAS_DO_DRE) {
    if (linha.tipo !== "linha") continue;
    for (const p of linha.prefixos) {
      if (!c.startsWith(p)) continue;
      const excluidos = EXCLUSOES[linha.chave] || [];
      if (excluidos.some((e) => c.startsWith(e))) continue;
      if (p.length > tamanho) {
        tamanho = p.length;
        escolhida = linha.chave;
      }
    }
  }
  return escolhida;
}

/**
 * ⚠⚠ O SINAL DE UMA LINHA DE LANÇAMENTO dentro do grupo dela.
 *
 * Grupo 3 (receitas) soma `C − D`; grupos 4 e 5 (custos, despesas, IRPJ/CSLL) somam `D − C`. É por
 * isso que `33 (-) DEDUÇÕES` sai NEGATIVO dentro do 3 — ela é débito numa árvore de crédito.
 *
 * ⚠ E o valor de cada linha do DRE ainda leva o `sinal` da própria linha (`-1` nos grupos 4 e 5),
 * para que o TOTAL seja uma soma simples: `receita − custo − despesa`. Sem isso, cada consumidor
 * teria de lembrar de subtrair — e um dia um deles não lembraria.
 */
function valorNoGrupo(linha, grupo) {
  const valor = numero(linha?.valor);
  const debito = texto(linha?.tipo).toUpperCase() === "D";
  if (grupo === 3) return debito ? -valor : valor;
  return debito ? valor : -valor;
}

/**
 * ⚠⚠ O DRE GERENCIAL DE UMA COMPETÊNCIA.
 *
 * @param {object} p
 * @param {Array} p.lancamentos os lançamentos da competência, cada um com `lines[]`
 * @param {Map<string, object>} p.planoPorCodigo o resultado de `resolverPlanoPorCodigo` — a chave é
 *   o código REDUZIDO (é o que `AccountingEntryLine.conta` guarda, texto, sem FK), e o valor traz o
 *   `codigoCompleto`, que é o que decide o grupo.
 * @param {string} p.competencia
 */
export function montarDreGerencial({ lancamentos, planoPorCodigo, competencia } = {}) {
  const porLinha = new Map();
  for (const l of LINHAS_DO_DRE) if (l.tipo === "linha") porLinha.set(l.chave, { valor: 0, contas: new Map() });

  const naoClassificado = new Map();
  const registrarNaoClassificado = (causa, codigo, valor, nome) => {
    if (!naoClassificado.has(causa)) naoClassificado.set(causa, { causa, valor: 0, contas: new Map() });
    const bloco = naoClassificado.get(causa);
    bloco.valor += Math.abs(valor);
    const chave = codigo || "(sem conta)";
    const atual = bloco.contas.get(chave) || { codigo: chave, nome: nome || null, valor: 0, linhas: 0 };
    atual.valor += Math.abs(valor);
    atual.linhas += 1;
    bloco.contas.set(chave, atual);
  };

  let temLancamento = false;
  for (const lanc of Array.isArray(lancamentos) ? lancamentos : []) {
    for (const linha of Array.isArray(lanc?.lines) ? lanc.lines : []) {
      temLancamento = true;
      const codigo = texto(linha?.conta);
      const valor = numero(linha?.valor);

      // ⚠ Conta EM BRANCO: 76 linhas e R$ 687 mil na base. NÃO é erro — é estado legítimo.
      if (!codigo) {
        registrarNaoClassificado(CAUSA_NAO_CLASSIFICADO.CONTA_EM_BRANCO, "", valor, null);
        continue;
      }
      const conta = planoPorCodigo?.get?.(codigo) || null;
      if (!conta) {
        registrarNaoClassificado(CAUSA_NAO_CLASSIFICADO.FORA_DO_PLANO, codigo, valor, null);
        continue;
      }
      const completo = texto(conta.codigoCompleto);
      if (!completo) {
        registrarNaoClassificado(CAUSA_NAO_CLASSIFICADO.SEM_CODIGO_COMPLETO, codigo, valor, conta.nome);
        continue;
      }
      const chave = linhaDoCodigo(completo);
      if (!chave) {
        // ⚠ Conta que EXISTE no plano e cujo grupo não é do DRE (ativo, passivo, patrimônio). Ela
        // não é "não classificada": ela simplesmente não é do resultado. Sair em silêncio aqui é o
        // certo — o DRE não é o balancete.
        continue;
      }

      const definicao = LINHAS_DO_DRE.find((l) => l.chave === chave);
      const bruto = valorNoGrupo(linha, definicao.grupo);
      const alvo = porLinha.get(chave);
      alvo.valor += bruto;
      const daConta = alvo.contas.get(completo)
        || { codigo: completo, reduzido: codigo, nome: conta.nome || null, valor: 0 };
      daConta.valor += bruto;
      alvo.contas.set(completo, daConta);
    }
  }

  // As linhas, com o sinal de exibição aplicado.
  const valores = new Map();
  const linhas = [];
  for (const def of LINHAS_DO_DRE) {
    if (def.tipo === "linha") {
      const acumulado = porLinha.get(def.chave);
      const valor = semZeroNegativo(acumulado.valor * (def.sinal === -1 ? -1 : 1));
      valores.set(def.chave, valor);
      linhas.push({
        chave: def.chave,
        rotulo: def.rotulo,
        tipo: def.tipo,
        valor,
        prefixos: def.prefixos,
        // ⚠ As contas viajam para o detalhe. ⚠⚠ Linha de receita NEGATIVA aparece com o sinal que
        // tem: na validação, `311020002 MANUTENCAO −3.213,00` é um estorno, e zerá-la o esconderia.
        contas: [...acumulado.contas.values()]
          .map((c) => ({ ...c, valor: semZeroNegativo(c.valor * (def.sinal === -1 ? -1 : 1)) }))
          .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      });
      continue;
    }
    const valor = semZeroNegativo(def.soma.reduce((s, k) => s + (valores.get(k) || 0), 0));
    valores.set(def.chave, valor);
    linhas.push({ chave: def.chave, rotulo: def.rotulo, tipo: def.tipo, valor, contas: [] });
  }

  return {
    competencia: competencia || null,
    /**
     * ⚠⚠ **`false` É O CONTRATO QUE APAGA O SELO** no portal do cliente — a leitura de lá é
     * `demonstracao !== false`, nunca `=== true`. Sem este campo, dado REAL seria apresentado com
     * selo de ficção; com ele `true` por engano, o contrário.
     */
    demonstracao: false,
    linhas,
    /**
     * ⚠⚠ **VAZIO É RESPOSTA, E ELE TEM NOME.** Medido: 12 das 34 empresas não têm lançamento nenhum.
     * O DRE delas não pode sair com `R$ 0,00` em toda linha — isso AFIRMA que a empresa não faturou
     * nem gastou nada no mês. Quem consome isto tem de dizer *"seu contador ainda não lançou esta
     * competência"*.
     */
    semLancamento: !temLancamento,
    naoClassificado: [...naoClassificado.values()].map((b) => ({
      causa: b.causa,
      frase: FRASE_DA_CAUSA[b.causa],
      valor: b.valor,
      contas: [...b.contas.values()].sort((a, b2) => b2.valor - a.valor),
    })),
  };
}
