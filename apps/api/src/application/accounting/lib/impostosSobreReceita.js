/**
 * A ALÍQUOTA EFETIVA A PARTIR DOS LANÇAMENTOS — provisão de impostos ÷ receita. Módulo PURO
 * (sem prisma, sem rede).
 *
 * A regra, uma frase: **quem diz se uma conta é receita ou imposto é o PREFIXO do `codigoCompleto`,
 * nunca o nome nem o `tipo` do lançamento.** Mesmo molde de `disponibilidades.js` — e pelo mesmo
 * motivo: casar nome de conta contra lista de texto é palpite, e aqui o resultado vai para a tela
 * do cliente como percentual de carga tributária.
 *
 * ## Por que existe (ordem do dono, 24/08/2026)
 *
 * > *"VAMOS CALCULAR A ALIQUOTA EFETIVA DO PRESUMIDO BASEADO NO LANÇAMENTOS CONTABIL DE PROVISAO E
 * > RECEITA."*
 *
 * O que havia antes, para o Lucro Presumido, era `impostosPagos ÷ faturamento` — guias com
 * `paymentStatus: "PAID"` sobre notas emitidas. Medido em produção em 24/08/2026: **2 de 11**
 * empresas do Presumido têm alguma guia paga, porque
 * `SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED` não está definida e `PAID` só acontece por clique
 * manual. Ou seja: em 9 de 11 clientes o número simplesmente não existia.
 *
 * ⚠ **A conta do SIMPLES NÃO MUDA.** Ela sai do extrato do PGDAS-D (`CompanyMonthlyCircular.
 * dasTotal`), que é a declaração transmitida à Receita — prova mais forte que qualquer lançamento
 * nosso. Este módulo é a resposta para quem **não tem** PGDAS-D. Ver o cabeçalho de
 * `apps/portal-cliente-web/src/features/emitir/lib/aliquotaEfetiva.js` para as contas que já
 * existiam e qual tela usa qual.
 *
 * ## ⚠⚠ A ESTRUTURA NÃO FOI INVENTADA — ELA JÁ ESTAVA NO PLANO DE CONTAS
 *
 * Medido em produção (24/08/2026, somente leitura), no plano global que atende 33 dos 34 clientes:
 *
 * | prefixo | nome no plano | papel aqui |
 * |---|---|---|
 * | `311`   | RECEITA BRUTA DE VENDA E PRESTACAO DE SERVICOS | **denominador** |
 * | `33101` | DEVOLUCOES DE VENDAS E SERVIÇOS | reduz o denominador — **não é imposto** |
 * | `33102` | ABATIMENTOS E DESCONTOS CONCEDIDOS | idem |
 * | `33103` | **IMPOSTOS INCIDENTES** (`(-) ISS`, `(-) PIS`, `(-) COFINS`, `(-) ICMS`, `(-) IPI`, `(-) ICMS ST`, `(-) ISS RETIDO`, `(-) INSS S/RECEITA`, `(-) DAS`) | **numerador** |
 * | `5`     | o ramo INTEIRO é `(-) IRPJ/CSLL` (6 contas, nenhuma outra coisa) | **numerador** |
 * | `312`   | RECEITAS FINANCEIRAS | fora |
 * | `32`    | OUTRAS RECEITAS OPERACIONAIS (aluguéis, sucata, dividendos, venda de ativo) | fora |
 *
 * ⚠ **`33101`/`33102` são irmãs de `33103` dentro de "(-) DEDUCOES DE RECEITAS", e mesmo assim NÃO
 * entram no numerador.** Devolução e desconto reduzem a receita; imposto é o que se paga sobre ela.
 * Somá-los inflaria a alíquota com dinheiro que nunca foi tributo. Eles reduzem o DENOMINADOR —
 * incluir no denominador uma venda cancelada diluiria a alíquota com receita que não existiu.
 * ⚠ Medido: hoje as duas têm **movimento zero** nas empresas do Presumido, então a escolha é
 * INERTE. Está escrita assim porque é o que o plano estrutura, e para que a reversão seja de uma
 * linha caso o dono decida o contrário.
 *
 * ⚠ **O ramo `4` (DESPESAS) fica inteiro de fora.** ⚠ Não confundir `411010021 INSS` (o INSS sobre
 * a FOLHA, despesa) com `331030008 (-) INSS S/RECEITA LEI 12.546/2011`, que é a CPRB: essa incide
 * sobre a RECEITA e por isso está dentro. São dois tributos diferentes com a mesma sigla.
 *
 * ## ⚠⚠ O INSS SOBRE A FOLHA — `aliquotaComFolha`, UM SEGUNDO NÚMERO (30/08/2026)
 *
 * > Dono, com a tela na frente: *"a porcentagem do imposto líquido sumiu, **não calcula o INSS
 * > junto**"*.
 *
 * ⚠⚠ **ESTA LINHA DIZIA QUE O INSS SOBRE FOLHA FICAVA DE FORA, citando o dono — e a citação estava
 * no lugar errado.** O que ele decidiu em 18/08/2026 (*"apenas a DAS, o INSS não entraria"*) era
 * sobre a **NOTA FISCAL** (`pTotTribSN`), e o `CLAUDE.md` do portal do cliente registra a distinção
 * com todas as letras: *"o PAINEL responde quanto esta empresa paga de imposto? (tudo, INSS
 * incluso — é gestão); a NOTA responde quanto desta nota é tributo do Simples? (só o DAS)"*.
 * A regra da NOTA tinha sido aplicada ao PAINEL por engano.
 *
 * ⚠⚠ **POR ISSO SÃO DOIS NÚMEROS, E NÃO UM NÚMERO CORRIGIDO.** `aliquota` continua sendo só
 * imposto sobre receita/resultado. `aliquotaComFolha` acrescenta o INSS patronal e é a de GESTÃO.
 * Trocar o primeiro pelo segundo estragaria a tela de destino nos dois sentidos — é o mesmo
 * argumento que este projeto já escreveu sobre `efetiva` × `deReceita`.
 *
 * ### ⚠ De onde ele sai, MEDIDO — nunca deduzido do nome
 *
 * Varredura de leitura da carteira inteira (34 empresas, 02–07/2026,
 * `scripts/diag-inss-lancado.mjs`): **existe UMA conta com movimento de INSS**, `211040009 INSS A
 * PAGAR`, em 9 empresas — D R$ 14.935,01 · C R$ 6.597,48. **Não há lançamento de INSS em conta de
 * DESPESA**: na ERISANGELA ele nasce dentro da provisão de pró-labore
 * (`D 411010001 PRO LABORE 1.621,00 / C 211040002 1.442,69 + C 211040009 178,31`).
 *
 * ⚠⚠ **E É POR ISSO QUE SE LÊ SÓ O CRÉDITO — a razão é aritmética, não gosto.** `211040009` é
 * conta de PASSIVO: o crédito é a obrigação NASCENDO (a carga do mês) e o débito é ela sendo PAGA.
 * Em 07/2026 a ERISANGELA provisionou e pagou na mesma competência, então o SALDO da conta é
 * **zero** — somar o saldo apagaria justamente o INSS que o dono quer ver. E o débito costuma
 * quitar saldo de meses anteriores (D 14.935 contra C 6.597 na janela medida): netá-lo daria INSS
 * **negativo**.
 *
 * ⚠ **A lista é de CÓDIGOS COMPLETOS EXATOS, nunca prefixo.** ⚠⚠ `211050019 INSS S/RECEITA … A
 * RECOLHER` **fica de fora**: é o passivo da CPRB, cuja despesa (`331030008`) já está no
 * numerador — incluí-lo contaria o mesmo tributo duas vezes.
 * ⚠ Este é o ÚNICO ponto do módulo que olha o LADO da linha em vez da natureza da conta. Está
 * assim porque a informação que se quer — obrigação nascida — só existe no lado.
 *
 * ⚠ **NADA AQUI OLHA O `tipo` DO LANÇAMENTO.** Medido: as provisões de PIS/COFINS/ISS chegam com
 * `tipo: "PROVISAO"`, mas há linha em conta de receita dentro de lançamento `tipo: "DESPESA"`. O
 * `tipo` é rótulo de tela; a conta é o fato contábil.
 *
 * ⚠⚠ **E O MAIOR LIMITE É A CONTA VAZIA.** `AccountingEntryLine.conta` é TEXTO sem FK, e medido nas
 * empresas do Presumido: **11 de 37 provisões têm pelo menos uma perna SEM conta** (nascem assim
 * quando não há memória em `AccountingHistorico`). Essas linhas são invisíveis para qualquer regra
 * baseada em conta — então elas **voltam contadas em `naoClassificadas`**, nunca somem. Uma
 * alíquota calculada por cima de metade das provisões seria menor que a real, e nada na tela
 * diria isso.
 */

/** Grupos, vocabulário FECHADO. */
export const GRUPO = Object.freeze({
  RECEITA_BRUTA: "RECEITA_BRUTA",
  DEDUCAO_NAO_TRIBUTARIA: "DEDUCAO_NAO_TRIBUTARIA",
  IMPOSTO_SOBRE_RECEITA: "IMPOSTO_SOBRE_RECEITA",
  IMPOSTO_SOBRE_RESULTADO: "IMPOSTO_SOBRE_RESULTADO",
  // ⚠⚠ O INSS PATRONAL (30/08/2026). Ele NÃO entra em `aliquota` — entra em
  // `aliquotaComFolha`. Ver o bloco próprio no cabeçalho.
  IMPOSTO_SOBRE_FOLHA: "IMPOSTO_SOBRE_FOLHA",
  FORA_DA_CONTA: "FORA_DA_CONTA",
  INDETERMINADO: "INDETERMINADO",
});

/** Situação da alíquota, vocabulário FECHADO. ⚠ Nenhuma delas é "zero por cento". */
export const SITUACAO = Object.freeze({
  CALCULADA: "CALCULADA",
  SEM_RECEITA_LANCADA: "SEM_RECEITA_LANCADA",
  SEM_IMPOSTO_LANCADO: "SEM_IMPOSTO_LANCADO",
  SEM_LANCAMENTO: "SEM_LANCAMENTO",
});

// ⚠ ORDEM IMPORTA: os prefixos mais LONGOS primeiro. `33103` tem de ser testado antes de `33101`
// não por colisão entre eles, mas porque qualquer encurtamento futuro desta lista para `33`
// mandaria "impostos incidentes" para "deduções" e esvaziaria o numerador em silêncio.
const PREFIXOS = Object.freeze([
  ["33101", GRUPO.DEDUCAO_NAO_TRIBUTARIA],
  ["33102", GRUPO.DEDUCAO_NAO_TRIBUTARIA],
  ["33103", GRUPO.IMPOSTO_SOBRE_RECEITA],
  ["311", GRUPO.RECEITA_BRUTA],
  ["5", GRUPO.IMPOSTO_SOBRE_RESULTADO],
]);

/**
 * ⚠⚠ O INSS PATRONAL, POR CÓDIGO COMPLETO EXATO — ver o bloco no cabeçalho.
 *
 * ⚠ Igualdade, NUNCA `startsWith`: `21104` inclui `211040002 PRO LABORE A PAGAR`, e um prefixo
 * aqui somaria **salário** ao imposto.
 * ⚠ `211040010 INSS AUTONOMOS- RPA A PAGAR` entra por ser a mesma natureza. Medido: **sem
 * movimento** hoje na carteira — ela está aqui para não virar buraco no dia em que tiver.
 */
export const CONTAS_DE_INSS_SOBRE_FOLHA = Object.freeze(["211040009", "211040010"]);

/**
 * Em que grupo esta conta entra.
 *
 * ⚠ Conta SEM `codigoCompleto` responde `INDETERMINADO`, nunca `FORA_DA_CONTA`. "Não sei o que é"
 * e "sei que não entra" são respostas diferentes, e a primeira precisa aparecer na tela — é a
 * mesma disciplina do `analitica` tri-estado e do `DISPONIVEL_NAO_CLASSIFICADO`.
 */
export function classificarConta(conta) {
  const cc = String(conta?.codigoCompleto ?? "").trim();
  if (!cc) return GRUPO.INDETERMINADO;
  // ⚠ ANTES DOS PREFIXOS, e por igualdade: `211040009` começa com `2`, que não está na lista de
  // prefixos, então a ordem é indiferente hoje — mas um prefixo `2` acrescentado amanhã engoliria
  // o INSS em silêncio se esta conferência viesse depois.
  if (CONTAS_DE_INSS_SOBRE_FOLHA.includes(cc)) return GRUPO.IMPOSTO_SOBRE_FOLHA;
  for (const [prefixo, grupo] of PREFIXOS) if (cc.startsWith(prefixo)) return grupo;
  return GRUPO.FORA_DA_CONTA;
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Soma as linhas e devolve os componentes da alíquota.
 *
 * @param linhas  `[{ conta, tipo: "D"|"C", valor, parcelamentoId? }]` — a conta já RESOLVIDA no
 *                plano (`{ codigo, nome, codigoCompleto }`) ou `null` quando não foi possível
 *                resolver.
 *
 * ⚠ O SINAL segue a natureza da conta, não o `tipo` da linha. Receita é CREDORA (C soma, D
 * subtrai); as contas de imposto e de dedução são retificadoras, natureza DEVEDORA (D soma, C
 * subtrai). Trocar isso faria um estorno virar aumento.
 */
export function somarComponentes(linhas) {
  const zero = () => ({ total: 0, porConta: new Map() });
  const acc = {
    [GRUPO.RECEITA_BRUTA]: zero(),
    [GRUPO.DEDUCAO_NAO_TRIBUTARIA]: zero(),
    [GRUPO.IMPOSTO_SOBRE_RECEITA]: zero(),
    [GRUPO.IMPOSTO_SOBRE_RESULTADO]: zero(),
    [GRUPO.IMPOSTO_SOBRE_FOLHA]: zero(),
  };
  const naoClassificadas = [];

  for (const l of Array.isArray(linhas) ? linhas : []) {
    // ⚠ PARCELAMENTO NÃO É A CARGA DO MÊS. A provisão de abertura de um parcelamento é dívida
    // ANTIGA sendo reconhecida; somá-la aqui faria a alíquota do mês estourar por causa de imposto
    // de outros anos. Fora, e fora ANTES da classificação — o motivo não é a conta.
    if (l?.parcelamentoId) continue;

    const grupo = l?.conta ? classificarConta(l.conta) : GRUPO.INDETERMINADO;
    if (grupo === GRUPO.INDETERMINADO) {
      naoClassificadas.push({
        conta: String(l?.conta?.codigo ?? l?.contaCodigo ?? "").trim() || null,
        valor: numero(l?.valor),
        tipo: l?.tipo === "C" ? "C" : "D",
        motivo: l?.conta ? "conta_sem_codigo_completo" : "conta_fora_do_plano",
      });
      continue;
    }
    if (grupo === GRUPO.FORA_DA_CONTA) continue;

    // ⚠⚠ O INSS PATRONAL É O ÚNICO QUE LÊ O LADO, E SÓ O CRÉDITO. Ele mora numa conta de PASSIVO
    // (`211040009 INSS A PAGAR`): o crédito é a obrigação nascendo — a carga do mês — e o débito é
    // ela sendo paga, muitas vezes de competências anteriores. O motivo inteiro está no cabeçalho.
    // ⚠ O débito não é "descartado por conveniência": ele é outro fato (pagamento), e este número
    // pergunta quanto NASCEU no mês.
    if (grupo === GRUPO.IMPOSTO_SOBRE_FOLHA) {
      if (l?.tipo !== "C") continue;
      const v = numero(l?.valor);
      acc[grupo].total += v;
      const cod = String(l.conta.codigo ?? "").trim() || String(l.conta.codigoCompleto);
      const antes = acc[grupo].porConta.get(cod) || { codigo: cod, nome: l.conta.nome ?? null, total: 0 };
      antes.total += v;
      acc[grupo].porConta.set(cod, antes);
      continue;
    }

    const credora = grupo === GRUPO.RECEITA_BRUTA;
    const sinal = (l?.tipo === "C" ? 1 : -1) * (credora ? 1 : -1);
    const v = sinal * numero(l?.valor);
    acc[grupo].total += v;
    const cod = String(l.conta.codigo ?? "").trim() || String(l.conta.codigoCompleto);
    const antes = acc[grupo].porConta.get(cod) || { codigo: cod, nome: l.conta.nome ?? null, total: 0 };
    antes.total += v;
    acc[grupo].porConta.set(cod, antes);
  }

  const emLista = (g) => [...acc[g].porConta.values()].sort((a, b) => b.total - a.total);
  return {
    receitaBruta: acc[GRUPO.RECEITA_BRUTA].total,
    receitaBrutaPorConta: emLista(GRUPO.RECEITA_BRUTA),
    devolucoesEDescontos: acc[GRUPO.DEDUCAO_NAO_TRIBUTARIA].total,
    impostoSobreReceita: acc[GRUPO.IMPOSTO_SOBRE_RECEITA].total,
    impostoSobreResultado: acc[GRUPO.IMPOSTO_SOBRE_RESULTADO].total,
    impostoSobreFolha: acc[GRUPO.IMPOSTO_SOBRE_FOLHA].total,
    // ⚠ O INSS entra na LISTA por conta — quem lê a composição tem de vê-lo —, mas NÃO em
    // `impostos`. Os dois números de cima são a alíquota da NOTA; este é o da GESTÃO.
    impostosPorConta: [
      ...emLista(GRUPO.IMPOSTO_SOBRE_RECEITA),
      ...emLista(GRUPO.IMPOSTO_SOBRE_RESULTADO),
      ...emLista(GRUPO.IMPOSTO_SOBRE_FOLHA),
    ],
    naoClassificadas,
  };
}

/**
 * A alíquota efetiva, com a situação que a explica.
 *
 * ⚠⚠ **NUNCA DEVOLVE `0` COMO ALÍQUOTA.** Sem receita ou sem imposto lançado, `aliquota` é `null`
 * e `situacao` diz qual das duas faltou. Zero por cento é uma AFIRMAÇÃO sobre carga tributária —
 * é o mesmo raciocínio do `pTotTribSN` da nota e do `folhaAusenteNaoEZero`.
 *
 * ⚠ Base = receita bruta **menos devoluções e descontos**. Ver o cabeçalho: escolha estrutural do
 * plano, hoje inerte (movimento zero nessas contas).
 */
export function aliquotaEfetivaDeLancamentos(linhas) {
  const c = somarComponentes(linhas);
  const base = c.receitaBruta - c.devolucoesEDescontos;
  const impostos = c.impostoSobreReceita + c.impostoSobreResultado;
  const impostosComFolha = impostos + c.impostoSobreFolha;

  // ⚠⚠ A SITUAÇÃO CONTINUA SENDO DECIDIDA PELOS IMPOSTOS **SEM** A FOLHA, e isso é deliberado.
  // Uma competência com INSS provisionado e nenhum DAS não é uma competência "com imposto
  // lançado": o tributo sobre a receita é que está faltando, e é isso que a tela precisa dizer.
  // ⚠ Consequência aceita: nesse caso `aliquotaComFolha` também sai `null`. Um percentual só de
  // INSS sobre a receita se leria como a carga tributária da empresa, e não é.
  let situacao = SITUACAO.CALCULADA;
  if (base <= 0 && impostos <= 0) situacao = SITUACAO.SEM_LANCAMENTO;
  else if (base <= 0) situacao = SITUACAO.SEM_RECEITA_LANCADA;
  else if (impostos <= 0) situacao = SITUACAO.SEM_IMPOSTO_LANCADO;

  return {
    ...c,
    base,
    impostos,
    impostosComFolha,
    aliquota: situacao === SITUACAO.CALCULADA ? (impostos / base) * 100 : null,
    // ⚠⚠ O NÚMERO DA GESTÃO — o do PAINEL do cliente. Ele nunca é zero por ausência: segue a
    // MESMA `situacao`, e sem ela é `null`, como o irmão.
    aliquotaComFolha: situacao === SITUACAO.CALCULADA ? (impostosComFolha / base) * 100 : null,
    situacao,
  };
}
