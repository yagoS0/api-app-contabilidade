// O QUE A TELA DO PERFIL FISCAL PODE AFIRMAR — e o que ela vinha afirmando sem base.
//
// ⚠⚠ O DEFEITO QUE ISTO CONSERTA É O QUE MAIS CONFUNDIU O DONO. Ele abriu Empresa → Perfil fiscal e
// viu "Regime tributário: Simples Nacional" com duas atividades ATIVAS; abriu a aba Apuração da
// MESMA empresa e leu "A empresa não tem Cadastro Fiscal preenchido (regime + CNAE)". Duas telas
// dizendo coisas opostas sobre a mesma empresa.
//
// Medido em produção (25/08/2026, `scripts/diag-cadastro-fiscal-vs-perfil.mjs`):
// **28 das 34 empresas NÃO TÊM LINHA em `cadastros_fiscais`.** Para elas o backend MONTA um
// cadastro a partir da `Company` — com `regime` vindo de um `return "SIMPLES_NACIONAL"` de default
// (`apuracaoV2.js:43`) e `ativo: true` por omissão em toda atividade (`PerfilFiscalService.js:135`)
// — e devolve `temCadastro: false` para distinguir os dois casos.
//
// ⚠⚠ **E NINGUÉM NO FRONT LIA ESSE CAMPO.** A tela desenhava o objeto sintético com a mesma cara de
// um cadastro salvo. O contador via um perfil "preenchido" que não existe no banco, marcava
// atividades que já pareciam marcadas, e não tinha como saber que nada daquilo estava gravado.
//
// ⚠ NÃO É BUG DO BACKEND. Ele responde certo, e o prefill existe de propósito: sem ele a tela
// nasceria vazia numa empresa que TEM CNAE na ficha. O defeito é a tela não dizer qual dos dois
// está mostrando.

/** Os dois estados possíveis do perfil — e eles pedem ações diferentes do contador. */
export const ORIGEM_DO_PERFIL = Object.freeze({
  /** Existe linha em `cadastros_fiscais`: o que está na tela foi salvo por alguém. */
  SALVO: "salvo",
  /** ⚠ Montado a partir dos CNAEs da ficha da empresa. NADA disto está gravado. */
  DERIVADO: "derivado",
});

/**
 * De onde veio o que a tela está mostrando.
 *
 * @param {{temCadastro?: boolean, candidatos?: Array}} perfil — a resposta de `GET /perfil-fiscal`.
 */
export function origemDoPerfil(perfil) {
  const derivado = perfil?.temCadastro === false;
  if (!derivado) {
    return { origem: ORIGEM_DO_PERFIL.SALVO, aviso: null };
  }
  return {
    origem: ORIGEM_DO_PERFIL.DERIVADO,
    aviso: {
      titulo: "Este perfil ainda NÃO está salvo",
      // ⚠ A frase diz as TRÊS coisas que mudam a leitura: de onde vieram as atividades, que os
      // marcadores são default, e que o regime pode não ter sido conferido por ninguém.
      texto: "As atividades abaixo foram montadas a partir dos CNAEs da ficha da empresa, e não de "
        + "um cadastro fiscal. Todas aparecem ATIVAS por padrão, nenhuma está marcada como padrão, "
        + "e o regime pode ser o default do sistema — ninguém conferiu ainda. "
        + "Clique em \"Salvar perfil\" para gravar o que está na tela.",
      // ⚠⚠ E a consequência PRÁTICA, que é o que fecha a contradição que o dono viu: enquanto não
      // houver linha, o motor de apuração recusa a competência dizendo que falta o cadastro.
      consequencia: "Enquanto este perfil não for salvo, a aba Apuração recusa a competência com "
        + "\"A empresa não tem Cadastro Fiscal preenchido\" — é a mesma empresa, e as duas telas "
        + "estão certas: uma mostra o que dá para derivar, a outra exige o que foi gravado.",
    },
  };
}

/**
 * O aviso do Fator R.
 *
 * ⚠⚠ A TELA DIZIA "atenção à zona 27%–29%" — UM NÚMERO QUE NENHUM CÓDIGO CALCULA. Varredura em
 * 25/08/2026: **zero ocorrências de 0.27 ou 0.29 no repositório inteiro.** Era texto fixo, e um
 * número inventado numa tela fiscal é pior que texto nenhum: ele parece resultado de conta.
 *
 * O que o perfil REALMENTE sabe é quais atividades ATIVAS são de Fator R — e isso vem da regra
 * `sujeitoAoFatorR`, que já é a mesma do Planejamento. O quanto o Fator R está exige folha e RBT12,
 * que esta tela não tem: quem responde isso é a Apuração (medidor por competência) e o
 * Planejamento (gauge com a linha dos 28%). A frase manda para lá em vez de inventar uma faixa.
 */
export function avisoDoFatorR(perfil) {
  const fatorR = perfil?.fatorR || null;
  // ⚠ `temFatorR` é o booleano do contrato antigo; `fatorR.resposta` é a regra nova. Ler os dois
  // mantém a tela funcionando enquanto o backend não tiver subido — e o valor de VERDADE é o novo.
  const temFatorR = fatorR ? fatorR.resposta === "sim" : Boolean(perfil?.temFatorR);
  if (!temFatorR) return null;

  const cnaes = Array.isArray(fatorR?.cnaes) ? fatorR.cnaes.filter(Boolean) : [];
  return {
    // ⚠ Nomeia os CNAEs quando os conhece. "Há atividade sujeita a Fator R" não diz QUAL, e numa
    // empresa com seis CNAEs isso é uma caça ao tesouro na própria tabela abaixo.
    texto: cnaes.length
      ? `${cnaes.length === 1 ? "A atividade" : "As atividades"} ${cnaes.join(", ")} `
        + `${cnaes.length === 1 ? "é sujeita" : "são sujeitas"} ao Fator R: o anexo (III ou V) sai da `
        + "folha dos 12 meses ÷ RBT12, não da escolha."
      : "Há atividade sujeita ao Fator R: o anexo (III ou V) sai da folha dos 12 meses ÷ RBT12, "
        + "não da escolha.",
    // ⚠ Onde ver o número, já que ESTA tela não o calcula.
    ondeVerOValor: "O valor do Fator R e a distância até os 28% aparecem na aba Apuração (por "
      + "competência) e no Planejamento tributário.",
    divergencia: fatorR?.divergencia?.frase || null,
  };
}

/**
 * ⚠⚠ AS COLUNAS QUE ACEITAM DIGITAÇÃO E NÃO SÃO LIDAS POR NINGUÉM.
 *
 * Medido por varredura em 25/08/2026: dos oito campos gravados em `perfilAtividades`, só
 * `aliquotaIss` tem leitor — e um só (`DadosPlanejamentoService`, para desempatar o ISS do
 * comparativo). `codigoServicoMunicipal`, `retencaoFonte`, `domicilioFiscal` e `obs` são
 * **write-only**: o contador digita, o servidor grava, e nada no sistema consulta.
 *
 * ⚠ ELAS NÃO FORAM REMOVIDAS, e a decisão é deliberada — a mesma já registrada neste projeto a
 * propósito do `DefisNaoDevida.jsx`: *"não foi apagado — apagar componente é decisão à parte"*.
 * Pode haver valor já digitado, e apagar coluna leva o dado junto. O que a tela passa a fazer é
 * DIZER, no cabeçalho da coluna, que aquilo ainda não alimenta nada.
 *
 * ⚠ E o `codigoServicoMunicipal` daqui NÃO é o da emissão: quem a emissão de NFS-e lê é
 * `Company.codigoServicoMunicipal`, que é UM por empresa. Este é por CNAE — outra granularidade.
 * Ligar um no outro exigiria decidir qual CNAE manda, e isso é decisão do dono.
 */
export const COLUNAS_SEM_LEITOR = Object.freeze({
  codigoServicoMunicipal: "Ainda não alimenta nada: a emissão de NFS-e lê o código do cadastro da "
    + "empresa (um por empresa), não este, que é por CNAE.",
  retencaoFonte: "Ainda não alimenta nada — nenhum cálculo do portal consulta este campo.",
  domicilioFiscal: "Ainda não alimenta nada — nenhum cálculo do portal consulta este campo.",
  obs: "Anotação livre — não entra em cálculo nenhum.",
});

/** ⚠ Só `aliquotaIss` tem leitor hoje, e a tela diz QUEM lê. */
export const COLUNAS_COM_LEITOR = Object.freeze({
  aliquotaIss: "Usada pelo Planejamento tributário para o ISS do comparativo de regimes "
    + "(a atividade PADRÃO desempata).",
});

/** `true` quando a coluna aceita digitação e ninguém a consulta. */
export const semLeitor = (campo) => Object.hasOwn(COLUNAS_SEM_LEITOR, campo);

/** Os três estados do regime — e o do meio é o que faltava. */
export const ESTADO_DO_REGIME = Object.freeze({
  /** Existe cadastro fiscal salvo, e ele diz o regime. */
  CADASTRADO: "cadastrado",
  /** ⚠ Veio da ficha da empresa (ou do DEFAULT do sistema). Ninguém conferiu. */
  DERIVADO: "derivado",
  /** Não há regime em lugar nenhum. */
  AUSENTE: "ausente",
});

/**
 * ⚠⚠ A OUTRA METADE DO DEFEITO, e a mais silenciosa.
 *
 * `RegimeDaEmpresa` já recusava afirmar um regime VAZIO — está escrito lá, e é a regra certa. Mas o
 * caso que morde em produção não é o vazio: é o regime **PREENCHIDO POR DEFAULT**.
 * `apuracaoV2.mapRegime` termina em `return "SIMPLES_NACIONAL"` ("a maioria das empresas do app é
 * SN"), então uma empresa sem cadastro chega à tela com `regime: "SIMPLES_NACIONAL"` — e a tela o
 * imprimia em VERDE, que nesta casa quer dizer CONCLUÍDO.
 *
 * O backend já devolve `prefill: true` justamente para distinguir os dois casos. ⚠ Ninguém no front
 * lia esse campo — é o achado que ficou nomeado em 25/08/2026 e que este bloco fecha.
 *
 * ⚠ `prefill` AUSENTE não vira "derivado": contrato antigo não pode acender um alarme que afirma
 * algo sobre o banco.
 */
export function estadoDoRegime({ regime, prefill } = {}) {
  const bruto = String(regime || "").trim();
  if (!bruto) {
    return {
      estado: ESTADO_DO_REGIME.AUSENTE,
      rotulo: "não cadastrado",
      nota: "Sem o regime não dá para afirmar o enquadramento desta empresa — informe no cadastro.",
      confiavel: false,
    };
  }
  const ehSimples = bruto.toUpperCase() === "SIMPLES_NACIONAL";
  const rotulo = ehSimples ? "Simples Nacional" : bruto;

  if (prefill === true) {
    return {
      estado: ESTADO_DO_REGIME.DERIVADO,
      rotulo,
      // ⚠ A frase diz de ONDE veio e o que isso significa. "Pode ser o default" não é hedge: o
      // `mapRegime` responde Simples Nacional para texto irreconhecível E para texto ausente.
      nota: "Vem da ficha da empresa, não de um cadastro fiscal salvo — e o sistema assume "
        + "Simples Nacional quando não reconhece o regime da ficha. Confirme antes de usar.",
      confiavel: false,
    };
  }
  return { estado: ESTADO_DO_REGIME.CADASTRADO, rotulo, nota: null, confiavel: true };
}
