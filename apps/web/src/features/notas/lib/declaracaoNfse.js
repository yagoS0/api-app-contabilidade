// O QUE A NOTA VAI DECLARAR — a regra de tela do assistente de emissão de NFS-e.
//
// ⚠ POR QUE ISTO É UM MÓDULO
//
// O assistente tinha DUAS descrições da mesma nota: o espelho do passo "Conferir" (sete linhas) e
// o texto do `window.confirm` (duas — valor e tomador). Quem clica em Emitir lê o segundo, e ele
// omitia justamente o que muda dinheiro e responsabilidade: alíquota, ISS retido, competência e o
// percentual total de tributos. Ato de consequência confirma REPETINDO os dados; com duas listas,
// a que o contador lê no momento do clique era a mais pobre. Agora as duas saem de
// `linhasDoEspelho` — uma lista só, e o `confirm` é a mesma lista em texto.
//
// ⚠ ISTO NÃO É REGRA FISCAL, E NÃO É A REGRA DO XML.
// Nada aqui calcula tributo, alíquota ou percentual, e nada aqui decide o que vai no XML — quem
// decide é `apps/api/src/application/nfse/dpsCodigos.js`. Este módulo ESPELHA aquelas tabelas para
// que o contador veja o desfecho ANTES de clicar em Emitir, em vez de descobri-lo numa recusa.
// O número do `pTotTribSN` é dado fiscal e entra pela mão do contador — ver `FONTE_P_TOT_TRIB_SN`.
//
// ⚠ ESTE ARQUIVO É ACOPLADO AO BACKEND DE PROPÓSITO. Mudou `dpsCodigos.js`, muda aqui — senão a
// tela volta a prometer um desfecho e o servidor a entregar outro, que é o defeito que ela existe
// para não ter.

import { rotuloRegime } from "../../../lib/vocabulario";

// TSOpSimpNac no grupo `prest/regTrib` da DPS.
export const OP_SIMP_NAC = {
  1: "Não optante pelo Simples Nacional",
  2: "MEI",
  3: "Simples Nacional — ME/EPP",
};

// ⚠ ESPELHO DE `OP_SIMP_NAC_POR_REGIME` (`apps/api/.../nfse/dpsCodigos.js`).
// O conjunto de chaves é o que importa: regime FORA dele **recusa a emissão** no servidor
// (`NFSE_REGIME_INDEFINIDO`), não vira "3" por omissão como era antes. MEI está fora de propósito
// (o valor de `opSimpNac` para MEI não tem evidência no projeto).
export const OP_SIMP_NAC_POR_REGIME = {
  SIMPLES_NACIONAL: { opSimpNac: "3", ehSimples: true },
  LUCRO_PRESUMIDO: { opSimpNac: "1", ehSimples: false },
  LUCRO_REAL: { opSimpNac: "1", ehSimples: false },
};

export const RESOLUCAO = { RESOLVIDO: "resolvido", INDEFINIDO: "indefinido" };

// Por que o campo existe. Fica junto do campo, não num tooltip: quem preenche precisa saber que o
// número não é decoração, e quem NÃO tem o número precisa saber que a emissão para sem ele.
export const MOTIVO_P_TOT_TRIB_SN =
  "Percentual total de tributos do Simples Nacional. O Padrão Nacional o exige em toda nota "
  + "declarada como Simples Nacional. Sem ele o servidor recusa a nota.";

// ⚠ DE ONDE O NÚMERO VEM — e por que a tela NÃO o preenche sozinha.
// O percentual é dado fiscal: sai do extrato do PGDAS-D (alíquota efetiva do Simples Nacional) e
// depende do anexo do serviço desta nota. O sistema não tem esse número em forma utilizável no
// momento da emissão: o extrato que guardamos é PDF (não campo), e a alíquota efetiva que o motor
// de apuração calcula é POR ANEXO e só existe depois de apurada a competência — a nota é emitida
// durante o mês. Sugerir ali um número seria a tela inventando dado fiscal.
export const FONTE_P_TOT_TRIB_SN =
  "O número é dado fiscal e a tela não o preenche: ele sai do extrato do PGDAS-D (alíquota efetiva "
  + "do Simples Nacional) e depende do anexo do serviço desta nota. A apuração da competência ainda "
  + "não existe quando a nota é emitida, então não há de onde copiá-lo com segurança — confira no "
  + "extrato ou com quem responde pela apuração.";

// ⚠ EMPRESA NÃO OPTANTE AINDA NÃO EMITE POR AQUI, e o motivo é do servidor, não da tela.
// Quem não é do Simples declara a carga tributária aproximada (Lei 12.741/2012) em
// `totTrib.pTotTribFed/Est/Mun`. O backend RECUSA sem eles (`MISSING_TOT_TRIB_NAO_SIMPLES`) em vez
// de emitir `0,00`, que afirmaria carga zero — e o próprio código registra que a estrutura desse
// grupo **ainda não foi confirmada com o dono**. Coletar os três campos aqui, antes dessa
// confirmação, seria montar um grupo de XML por suposição.
export const MOTIVO_NAO_OPTANTE_BLOQUEADO =
  "A emissão para empresa NÃO optante do Simples ainda não está liberada: o Padrão Nacional exige "
  + "os percentuais de tributos aproximados (federal, estadual e municipal, da Lei 12.741/2012) e a "
  + "estrutura desse grupo no XML ainda não foi confirmada. O servidor recusaria a nota. Decisão do "
  + "dono — não emita por outro caminho enquanto isso.";

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

export function formatarDoc(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(doc || "");
}

export function fmtBRL(v) {
  const n = Number(v || 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

/**
 * O REGIME QUE A NOTA VAI DECLARAR, pela MESMA tabela do servidor.
 *
 * Três respostas, como `obrigatoriedadeDefis` / `obrigatoriedadeEfd`: o regime resolve para
 * `opSimpNac`, ou é `indefinido` — e `indefinido` não vira "provavelmente Simples", porque foi
 * exatamente isso (o `opSimpNac="3"` cravado) que fez toda empresa do Lucro Presumido emitir nota
 * declarando Simples ME/EPP.
 *
 * ⚠ A TELA VÊ UMA FONTE DE REGIME E O SERVIDOR VÊ OUTRA PRIMEIRO. Aqui chega
 * `legacyCompany.regimeTributario` (valores `SIMPLES` / `LUCRO_PRESUMIDO` / `LUCRO_REAL`, do
 * formulário da empresa); o servidor prefere `CadastroFiscal.regime` (`SIMPLES_NACIONAL`, do
 * cadastro fiscal). As duas grafias do Simples convivem no projeto — `obrigatoriedadeDefis` e
 * `obrigatoriedadeEfd` aceitam as duas de propósito. Por isso `SIMPLES` **não** é tratado como
 * desconhecido aqui: ele é o mesmo regime, escrito pela outra fonte.
 */
export function regimeDeclaradoNaNota(regimeCadastrado) {
  const chave = String(regimeCadastrado || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const cadastrado = chave || null;
  const rotuloCadastrado = cadastrado ? rotuloRegime(cadastrado) : null;

  // `SIMPLES` e `SIMPLES_NACIONAL` são o MESMO regime em duas fontes; a tabela do XML só nomeia a
  // segunda. Normalizar aqui é reconhecer o vocabulário do projeto, não inventar mapeamento novo.
  const chaveDoXml = chave === "SIMPLES" ? "SIMPLES_NACIONAL" : chave;
  const entrada = OP_SIMP_NAC_POR_REGIME[chaveDoXml] || null;

  if (!entrada) {
    const motivo = !cadastrado
      ? "Esta empresa não tem regime tributário cadastrado, e o regime é o que a nota declara "
        + "(opSimpNac). Sem ele não se afirma nem 'optante do Simples' nem 'não optante' — cadastre "
        + "o regime na aba Fiscal → Cadastro antes de emitir."
      : chaveDoXml === "MEI"
        ? "MEI não está mapeado para opSimpNac: o projeto não tem nota real, emissão aceita nem "
          + "documento oficial mostrando esse código, e o MEI recolhe por valor fixo — declarar por "
          + "analogia seria inventar regra fiscal. O servidor recusa a emissão."
        : `O regime "${rotuloCadastrado || regimeCadastrado}" não está mapeado para opSimpNac. `
          + "O servidor recusa a emissão em vez de escolher um código por conta própria.";
    // ⚠ DUAS VERSÕES DO MESMO MOTIVO, de propósito: a longa explica no bloco do regime; a curta
    // cabe no `title` do botão desabilitado e na lista de pendências, que ficam a um palmo dela.
    // Repetir o parágrafo inteiro nos dois lugares faz o olho pular os dois.
    const motivoCurto = !cadastrado
      ? "cadastre o regime tributário da empresa (aba Fiscal → Cadastro): sem ele o servidor recusa a emissão"
      : chaveDoXml === "MEI"
        ? "MEI ainda não tem código de regime confirmado para a NFS-e — o servidor recusa a emissão"
        : `o regime "${rotuloCadastrado || regimeCadastrado}" não tem código de regime mapeado — o servidor recusa a emissão`;
    return {
      motivoCurto,
      resolucao: RESOLUCAO.INDEFINIDO,
      opSimpNac: null,
      rotuloDeclarado: "não definido — a emissão será recusada",
      regimeCadastrado: cadastrado,
      rotuloCadastrado,
      ehSimples: null,
      // Sem resolução não dá para dizer que o percentual do Simples é dispensável. Exigi-lo é o
      // lado barato do erro: informado à toa, o servidor o ignora; faltando, ele recusa.
      exigePTotTribSN: true,
      exigeTotTribNaoSimples: false,
      bloqueiaEmissao: true,
      motivoDoBloqueio: motivo,
      aviso: motivo,
    };
  }

  const naoOptante = !entrada.ehSimples;
  return {
    motivoCurto: naoOptante
      ? "empresa não optante do Simples: a emissão por aqui ainda não está liberada (falta confirmar o grupo de tributos aproximados no XML)"
      : null,
    resolucao: RESOLUCAO.RESOLVIDO,
    opSimpNac: entrada.opSimpNac,
    rotuloDeclarado: OP_SIMP_NAC[entrada.opSimpNac],
    regimeCadastrado: cadastrado,
    rotuloCadastrado,
    ehSimples: entrada.ehSimples,
    exigePTotTribSN: entrada.ehSimples,
    exigeTotTribNaoSimples: naoOptante,
    bloqueiaEmissao: naoOptante,
    motivoDoBloqueio: naoOptante ? MOTIVO_NAO_OPTANTE_BLOQUEADO : null,
    aviso: naoOptante ? MOTIVO_NAO_OPTANTE_BLOQUEADO : null,
  };
}

/**
 * Lê o campo do percentual total de tributos.
 *
 * ⚠ O QUE BLOQUEIA É O QUE O SERVIDOR BLOQUEIA: ausente (`MISSING_P_TOT_TRIB_SN`) e fora de 0–100
 * (`p_tot_trib_sn_invalido`, no validador). Fora dessa faixa não é "um número grande": é outra
 * unidade — provavelmente o valor em reais no lugar do percentual.
 */
export function lerPTotTribSN(entrada, { exigido = true } = {}) {
  const texto = String(entrada ?? "").trim();
  if (!texto) {
    return {
      preenchido: false,
      valor: null,
      problema: exigido
        ? "informe o percentual total de tributos do Simples Nacional — a nota é declarada como "
          + "Simples e o servidor recusa a emissão sem ele"
        : null,
    };
  }
  const n = Number(texto.replace(",", "."));
  if (!Number.isFinite(n)) {
    return { preenchido: true, valor: null, problema: "o percentual total de tributos precisa ser um número (ex.: 6 ou 6,00)" };
  }
  if (n < 0 || n > 100) {
    return {
      preenchido: true,
      valor: null,
      problema: "o percentual total de tributos precisa estar entre 0 e 100 — este campo é um "
        + "PERCENTUAL (%), não o valor dos tributos em reais",
    };
  }
  return { preenchido: true, valor: n, problema: null };
}

/**
 * O que a retenção SIGNIFICA, não só "sim/não".
 *
 * ⚠ Marcar retido muda QUEM RECOLHE o ISS e quanto o prestador recebe. O rótulo antigo ("ISS
 * retido pelo tomador") descrevia o campo; este descreve a consequência. E a retenção não era só
 * mal rotulada: ela era CALCULADA E DESCARTADA no servidor — o XML saía sempre com
 * `tpRetISSQN=1` (não retido). Hoje o valor vai de verdade, então o que a tela manda importa.
 */
export function textoIssRetido(issRetido) {
  return issRetido
    ? "sim — quem recolhe o ISS é o TOMADOR; o prestador recebe o valor do serviço menos o ISS"
    : "não — quem recolhe o ISS é o PRESTADOR (a empresa que está emitindo esta nota)";
}

/**
 * ⚠ COM RETENÇÃO, A ALÍQUOTA DEIXA DE SER OPCIONAL.
 * O provedor exige alíquota > 0 quando há retenção (erro E0625), e o servidor recusa antes de
 * emitir (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`). Deixar "a da prefeitura" marcado junto com "ISS retido"
 * é uma combinação que a tela pode recusar na hora, em vez de gastar uma emissão.
 */
export function problemaAliquotaComRetencao({ issRetido, aliquota }) {
  if (!issRetido) return null;
  const n = Number(String(aliquota ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    return "com ISS retido é obrigatório informar a alíquota de ISS maior que zero — o Padrão "
      + "Nacional recusa retenção sem alíquota";
  }
  return null;
}

function textoEndereco(endereco) {
  if (!endereco) return "não informado";
  const compl = endereco.xCpl ? ` — ${endereco.xCpl}` : "";
  return `${endereco.xLgr}, ${endereco.nro}${compl} · ${endereco.xBairro} · CEP ${endereco.CEP} · município ${endereco.cMun}`;
}

function textoRegime(regime) {
  if (!regime) return "não informado";
  if (regime.resolucao !== RESOLUCAO.RESOLVIDO) return regime.rotuloDeclarado;
  return `${regime.rotuloDeclarado} (opSimpNac ${regime.opSimpNac})`;
}

/**
 * A DESCRIÇÃO ÚNICA DA NOTA — o espelho do passo "Conferir" e o texto do `confirm` saem daqui.
 *
 * @param {Object} dados
 *   `{ tomador:{nome,doc,email}, endereco|null, servico:{descricao,valor,aliquota,issRetido},
 *      competencia, referencia, pTotTribSN, regime }`
 * @returns {Array<{rotulo: string, valor: string, forte?: boolean, separadorAntes?: boolean}>}
 */
export function linhasDoEspelho(dados = {}) {
  const { tomador = {}, endereco = null, servico = {}, competencia, referencia, pTotTribSN, regime } = dados;
  const linhas = [];

  linhas.push({ rotulo: "Tomador", valor: `${String(tomador.nome || "").trim()} · ${formatarDoc(tomador.doc)}` });
  if (tomador.email) linhas.push({ rotulo: "E-mail", valor: String(tomador.email).trim() });
  linhas.push({ rotulo: "Endereço", valor: textoEndereco(endereco) });
  linhas.push({ rotulo: "Serviço", valor: String(servico.descricao || "").trim() });
  linhas.push({ rotulo: "Competência", valor: competencia || "não informada" });
  if (referencia) linhas.push({ rotulo: "Referência", valor: String(referencia).trim() });

  linhas.push({ rotulo: "Valor dos serviços", valor: fmtBRL(servico.valor), forte: true, separadorAntes: true });
  linhas.push({
    rotulo: "Alíquota de ISS",
    valor: servico.aliquota == null || servico.aliquota === "" ? "a da prefeitura" : fmtPercent(servico.aliquota),
  });
  linhas.push({ rotulo: "ISS retido", valor: textoIssRetido(Boolean(servico.issRetido)) });

  // ⚠ O regime e o percentual ficam NO ESPELHO, não só no formulário: são os dois dados que o
  // contador não digitou pensando em declaração e que vão inteiros para o XML.
  linhas.push({ rotulo: "Regime declarado", valor: textoRegime(regime) });
  if (!regime || regime.exigePTotTribSN) {
    linhas.push({
      rotulo: "Total de tributos (Simples)",
      valor: pTotTribSN == null || pTotTribSN === "" ? "não informado" : fmtPercent(pTotTribSN),
    });
  }

  return linhas;
}

export const AVISO_IRREVERSIVEL =
  "A emissão é um ato fiscal: depois de autorizada, desfazer exige cancelamento com justificativa, "
  + "dentro do prazo da prefeitura.";

/**
 * O texto do `window.confirm` — a MESMA lista do espelho, em linhas.
 *
 * ⚠ Não resumir. Era "Emitir nota de R$ X para Fulano?" e o contador confirmava sem ver alíquota,
 * retenção, regime declarado nem percentual de tributos — os campos que ele acabou de digitar e
 * que mais erram.
 */
export function textoDeConfirmacao(dados = {}) {
  const linhas = linhasDoEspelho(dados).map((l) => `• ${l.rotulo}: ${l.valor}`);
  return `Emitir esta nota de serviço?\n\n${linhas.join("\n")}\n\n${AVISO_IRREVERSIVEL}`;
}
