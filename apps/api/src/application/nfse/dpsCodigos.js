// TABELAS DE CÓDIGO DA DPS — o que o XML declara sobre o REGIME e sobre a RETENÇÃO do ISSQN.
//
// Este módulo existe porque os dois valores estavam CRAVADOS no `buildDpsXml`:
//   • `opSimpNac="3"` — toda empresa era declarada Simples ME/EPP, inclusive as do Lucro
//     Presumido (11 das 33 da carteira, medido em 12/08/2026 e registrado no CLAUDE.md da raiz);
//   • `tpRetISSQN=1` — a retenção era CALCULADA e DESCARTADA (três variáveis mortas em
//     `NfseService.js:503` e `:588-589`), então nota com ISS retido saía declarada como não
//     retida.
//
// ─── REGRA 1 DO PROJETO: O QUE NÃO ESTÁ PROVADO NÃO É PREENCHIDO ─────────────────────────────
//
// ⚠ **O XSD do leiaute NÃO está versionado neste repositório** — não há um único `.xsd` na
// árvore. Logo, NENHUMA linha destas tabelas pode se apoiar no schema oficial. Cada entrada traz
// a evidência que a sustenta e um `verificadoNoLeiaute: false` explícito (princípio 3 do
// CLAUDE.md: marcar o não-verificado). O que não tem evidência **não recebe valor** — recebe
// `indefinido`, e a emissão é RECUSADA com o motivo. Chutar aqui é declarar regime tributário
// errado à Receita.
//
// Terceira resposta obrigatória (`indefinido`), na mesma forma de
// `obrigatoriedadeDefis.js` / `obrigatoriedadeEfd.js`: ausência de regime cadastrado **não**
// afirma "não optante", do mesmo jeito que não afirma "Simples".

/** Vocabulário fechado do desfecho de uma resolução de código. */
export const RESOLUCAO = Object.freeze({
  RESOLVIDO: "resolvido",
  INDEFINIDO: "indefinido",
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// opSimpNac — TSOpSimpNac no grupo `prest/regTrib`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ SÓ DUAS DAS TRÊS POSIÇÕES TÊM EVIDÊNCIA NO PROJETO. A terceira (MEI) fica de fora de
// propósito — ver `MEI_NAO_MAPEADO` abaixo.
export const OP_SIMP_NAC_POR_REGIME = Object.freeze({
  // Evidência: a ÚNICA emissão bem-sucedida que este projeto já produziu (homolog, `status:
  // "issued"`) foi de empresa do Simples e usou `opSimpNac=3` — está registrada campo a campo em
  // `docs/nfse-preenchimento.md` §12, com o `numeroNfse` devolvido pelo ambiente.
  SIMPLES_NACIONAL: Object.freeze({
    valor: "3",
    exigeRegApTribSN: true,
    fonte: "docs/nfse-preenchimento.md §12 — emissão homolog aceita (status:issued)",
    verificadoNoLeiaute: false,
  }),

  // Evidência: `docs/leiaute-nfse/nfse-nacional-substituicao.xml` — NFS-e REAL capturada do ADN
  // (só os identificadores foram anonimizados; o cabeçalho do arquivo declara que "códigos de
  // tributação foram mantidos: são estrutura / tabela pública"). Nela, `<opSimpNac>1</opSimpNac>`
  // aparece junto de `<pTotTrib>` com percentuais reais (11,33% federal) e **sem
  // `<regApTribSN>`** — as três coisas que caracterizam quem não é optante.
  LUCRO_PRESUMIDO: Object.freeze({
    valor: "1",
    exigeRegApTribSN: false,
    fonte: "docs/leiaute-nfse/nfse-nacional-substituicao.xml — NFS-e real, opSimpNac=1 + pTotTrib + sem regApTribSN",
    verificadoNoLeiaute: false,
  }),
  LUCRO_REAL: Object.freeze({
    valor: "1",
    exigeRegApTribSN: false,
    fonte: "docs/leiaute-nfse/nfse-nacional-substituicao.xml — mesma evidência do Lucro Presumido (ambos são não optantes)",
    verificadoNoLeiaute: false,
  }),
});

// ⚠ MEI FICA FORA, E ISSO É A DECISÃO, NÃO UM ESQUECIMENTO.
//
// A única coisa que o projeto tem sobre `opSimpNac=2` é um COMENTÁRIO de código escrito à mão
// ("1=Não optante, 2=MEI, 3=Simples (ME/EPP)"), no mesmo bloco que trazia `opSimpNac` cravado —
// ou seja, escrito pela mesma mão que produziu o defeito. Não há nota real, nem emissão aceita,
// nem documento oficial no repositório que mostre um `2`.
//
// E o MEI **não é um detalhe de borda**: ele tem regime de recolhimento próprio (valor fixo), o
// que muda o que mais vai no grupo `regTrib`. Declarar `2` por analogia seria inventar regra
// fiscal — exatamente o que a regra 1 proíbe. Enquanto o dono não confirmar contra o leiaute, MEI
// **recusa a emissão** em vez de emitir um palpite.
export const MEI_NAO_MAPEADO = Object.freeze({
  regime: "MEI",
  porque:
    "O valor de opSimpNac para MEI não tem nenhuma evidência no projeto — só um comentário de " +
    "código, escrito no mesmo bloco que cravava opSimpNac=3 para todo mundo. Confirmar no leiaute " +
    "oficial antes de ligar.",
});

/**
 * Regime tributário da empresa → grupo `regTrib` da DPS.
 *
 * @param {string|null|undefined} regime valor de `CadastroFiscal.regime` (autoridade) ou, na
 *   ausência dele, de `Company.regimeTributario`.
 * @returns {{resolucao: string, opSimpNac?: string, exigeRegApTribSN?: boolean, motivo?: string, fonte?: string}}
 */
// ⚠ O MESMO REGIME TEM DUAS GRAFIAS, EM DUAS FONTES — e ignorar isso recusaria 29 das 33 empresas.
//
// `CadastroFiscal.regime` (a autoridade) grava `SIMPLES_NACIONAL`; `Company.regimeTributario` (o
// fallback, alimentado pelo formulário da empresa) grava `SIMPLES`. Medido em produção 14/08/2026:
//
//   Company.regimeTributario  →  SIMPLES 22 · LUCRO_PRESUMIDO 11
//   CadastroFiscal            →  apenas 4 linhas, todas SIMPLES_NACIONAL
//
// Ou seja **29 de 33 empresas caem no fallback**, e sem este alias todas elas — inclusive 18 das 22
// do Simples — seriam recusadas com `NFSE_REGIME_INDEFINIDO`, que é exatamente o que a Fase 1
// existe para destravar.
//
// O projeto já convive com as duas grafias de propósito em `obrigatoriedadeDefis` e
// `obrigatoriedadeEfd`; esta é a terceira porta, e ela precisa da mesma tolerância.
//
// ⚠ MAS AQUI NÃO SE REUSA `mapRegime` (`routes/firm/apuracaoV2.js`), e o motivo é o desfecho, não o
// estilo: aquela função **assume Simples quando não reconhece** ("a maioria das empresas do app é
// SN"). Na apuração o default é inofensivo; numa DPS ele **declararia o regime da empresa por
// suposição** — regra 1. Aqui a normalização traduz a GRAFIA e nada mais: o que não for reconhecido
// continua caindo em `INDEFINIDO` e recusando.
const ALIAS_REGIME = Object.freeze({
  SIMPLES: "SIMPLES_NACIONAL",
  SIMPLES_NACIONAL: "SIMPLES_NACIONAL",
  LUCRO_PRESUMIDO: "LUCRO_PRESUMIDO",
  LUCRO_REAL: "LUCRO_REAL",
  MEI: "MEI",
});

export function resolverOpSimpNac(regime) {
  const bruta = String(regime || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const chave = ALIAS_REGIME[bruta] || bruta;

  if (!chave) {
    return {
      resolucao: RESOLUCAO.INDEFINIDO,
      motivo:
        "Esta empresa não tem regime tributário cadastrado, e o regime é o que a DPS declara em " +
        "opSimpNac. Sem ele não se afirma nem 'optante do Simples' nem 'não optante' — cadastre o " +
        "regime na aba Fiscal → Cadastro antes de emitir.",
    };
  }

  if (chave === "MEI") {
    return { resolucao: RESOLUCAO.INDEFINIDO, motivo: MEI_NAO_MAPEADO.porque };
  }

  const entrada = OP_SIMP_NAC_POR_REGIME[chave];
  if (!entrada) {
    return {
      resolucao: RESOLUCAO.INDEFINIDO,
      motivo:
        `Regime "${regime}" não está mapeado para opSimpNac. Os mapeados são ` +
        `${Object.keys(OP_SIMP_NAC_POR_REGIME).join(", ")}.`,
    };
  }

  return {
    resolucao: RESOLUCAO.RESOLVIDO,
    opSimpNac: entrada.valor,
    exigeRegApTribSN: entrada.exigeRegApTribSN,
    fonte: entrada.fonte,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// tpRetISSQN — retenção do ISSQN, no grupo `valores/trib/tribMun`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ AQUI HAVIA DOIS COMENTÁRIOS QUE SE CONTRADIZIAM NO MESMO ARQUIVO. `NfseService.js:502` dizia
// "1=retido, 2=não retido"; `:496`, seis linhas acima, dizia "para opSimpNac=3 e **tpRetISSQN=2/3**
// o provedor exige alíquota > 0" — ou seja, tratava 2 e 3 como os casos RETIDOS, o inverso do
// outro comentário. Como o valor nunca chegava ao XML (era cravado `1`), nenhum dos dois foi
// jamais exercido, e a contradição sobreviveu.
//
// Três fontes do projeto convergem para a leitura abaixo, e a que discorda é justamente a que se
// contradiz com o código logo abaixo dela:
//   1. `docs/nfse-preenchimento.md` §7: "`tpRetISSQN`: `1` (não retido)";
//   2. `NfseService.js:496`: 2/3 são os casos com exigência de alíquota (isto é, os retidos);
//   3. `docs/leiaute-nfse/nfse-nacional-substituicao.xml`: NFS-e REAL, serviço sem retenção,
//      `<tpRetISSQN>1</tpRetISSQN>`.
//
// ⚠ O QUE ESTA MUDANÇA NÃO ARRISCA: o caminho `issRetido = false` continua emitindo exatamente o
// `1` que hoje é emitido e que a emissão homolog aceita. Só o caminho RETIDO muda — e ele hoje
// está comprovadamente errado, porque declara como não retida uma nota que é retida.
export const TP_RET_ISSQN = Object.freeze({
  NAO_RETIDO: "1",
  RETIDO_TOMADOR: "2",
});

// ⚠ `3` (retido pelo INTERMEDIÁRIO) não é coberto, e não por esquecimento: o payload de emissão
// não tem a figura do intermediário — `data.servico.issRetido` é um BOOLEANO, e booleano não
// distingue "quem retém". Cobrir o 3 exige campo novo no assistente e é decisão do dono (Fase 2).
export const RETENCAO_POR_INTERMEDIARIO_NAO_SUPORTADA = Object.freeze({
  valor: "3",
  porque:
    "O payload só tem o booleano `issRetido`, que não diz QUEM retém. A retenção pelo " +
    "intermediário precisa de campo próprio no assistente.",
});

/**
 * `issRetido` (booleano do payload) → `tpRetISSQN` do XML.
 *
 * ⚠ Devolve também `exigeAliquota`: com retenção, o provedor exige alíquota > 0 (a observação de
 * `NfseService.js:496`, ligada ao erro E0625). Quem chama tem de recusar quando não houver — não
 * é este módulo que decide o que fazer, só o que o código significa.
 */
export function resolverTpRetIssqn(issRetido) {
  if (issRetido === true) {
    return {
      resolucao: RESOLUCAO.RESOLVIDO,
      tpRetISSQN: TP_RET_ISSQN.RETIDO_TOMADOR,
      exigeAliquota: true,
      fonte: "docs/nfse-preenchimento.md §7 + NfseService.js:496 + NFS-e real em docs/leiaute-nfse/",
      verificadoNoLeiaute: false,
    };
  }
  return {
    resolucao: RESOLUCAO.RESOLVIDO,
    tpRetISSQN: TP_RET_ISSQN.NAO_RETIDO,
    exigeAliquota: false,
    fonte: "docs/nfse-preenchimento.md §7 — e é o valor da emissão homolog aceita (§12)",
    verificadoNoLeiaute: false,
  };
}
