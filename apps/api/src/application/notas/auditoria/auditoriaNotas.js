// A AUDITORIA PRÉ-APURAÇÃO — cinco PERGUNTAS sobre as notas do mês, nenhuma sentença.
//
// ─── O PEDIDO DO DONO (17/08/2026) ──────────────────────────────────────────────────────────────
//
// > *"nos ajuda em uma auditoria pré-apuração para entender se a nota está correta ou não, baseado
// >  na atividade e baseado na data de emissão"*
//
// ─── ⚠ CADA ACHADO É UMA PERGUNTA, NUNCA UM VEREDITO ────────────────────────────────────────────
//
// O sistema **não sabe** se a nota está errada. Ele sabe que algo **não bate** com o cadastro, ou
// que a numeração da DPS tem um salto, ou que o mês da emissão não é o mês em que a nota está
// sendo contada. Quem julga é o contador — e é por isso que o texto de cada pergunta mora AQUI,
// em `PERGUNTAS`, e sobe pronto para a tela: se a frase vivesse no componente, a próxima tela a
// consumir esta regra escreveria a sua, e uma delas diria "nota errada".
//
// Concretamente: `"esta nota usa um código de serviço que não está no cadastro da empresa"`,
// não `"nota errada"`. A diferença não é de tom — é de quem assina a afirmação fiscal.
//
// ─── ⚠ AUSÊNCIA NUNCA É RESPOSTA — `CONFERIDA` COM ZERO ACHADOS ≠ `NAO_CONFERIVEL` ──────────────
//
// Este é o eixo do módulo, e ele foi medido antes de ser escrito. Em produção (17/08/2026),
// **0 das 33 empresas** tem um único código em `Company.codigosServicoNacional`. Se a pergunta 1
// respondesse "0 achados", a tela diria *"nenhuma nota fora da atividade cadastrada"* — que é uma
// afirmação sobre um cadastro que não existe, e é falsa em toda empresa da carteira.
//
// A resposta certa é **`NAO_CONFERIVEL`** com o motivo `EMPRESA_SEM_CODIGOS_CADASTRADOS`, isto é:
// *"não dá para conferir: cadastre os códigos de serviço da empresa"*. Ausência de critério não
// vira acusação — nem vira aprovação, que é o erro simétrico e mais perigoso, porque passa
// despercebido.
//
// A mesma disciplina desce ao nível da NOTA: uma nota sem o campo que a pergunta lê não conta como
// aprovada nem como reprovada — ela sai em `naoAvaliadas`, com o motivo. Nada some em silêncio.
// É a forma de `riscoRescisao.avaliavel` e de `obrigatoriedadeDefis.indefinida`.
//
// ─── ⚠ A AUDITORIA NÃO ESCREVE NADA ────────────────────────────────────────────────────────────
//
// Não marca nota, não classifica, não altera apuração, não cria pendência. É LEITURA. Este módulo
// é puro (nenhum import de prisma, nenhuma rede, nenhum relógio implícito) e o serviço que o
// alimenta também não escreve — provado em `__tests__/auditoriaNaoEscreve.test.js`, no mesmo
// molde de `planejamento/__tests__/dadosPlanejamento.test.js`.
//
// Mesma disciplina de `accounting/fechamentoBlockers.js`, `accounting/parcelamento/riscoRescisao.js`
// e `whatsapp/vinculoTelefone.js`: a regra recebe dados JÁ CARREGADOS e devolve a resposta, para
// que rota, script de medição e teste digam a MESMA coisa sobre a mesma nota.
//
// ─── ⚠ E NÃO SE INVENTA REGRA FISCAL ───────────────────────────────────────────────────────────
//
// São cinco perguntas porque foram cinco as nomeadas pelo dono. Uma sexta é proposta em relatório,
// nunca implementada aqui — regra fiscal é decisão dele (princípio 1 do `CLAUDE.md` da raiz).

import { dataCivilISO } from "../../../utils/dataCivil.js";

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A POPULAÇÃO — e por que ela NÃO é a mesma nas cinco perguntas
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ `"autorizada"` é o valor que `FechamentoService.whereFaturamentoEmit()` (a definição do projeto
// para "o que conta como faturamento": `{papel:"EMIT", statusEfetivo:"autorizada"}`) usa. Ele não é
// importado de lá porque aquele módulo carrega o prisma no topo e este é puro por exigência da
// fase. O teste `auditoriaNotas.test.js` nomeia os dois valores lado a lado para que a divergência
// apareça em vermelho, e não em produção.
const STATUS_QUE_A_APURACAO_CONTA = "autorizada";
const PAPEL_EMITIDA = "EMIT";
const TIPO_NFSE = "NFSE";

export const POPULACAO = Object.freeze({
  /**
   * O que a apuração conta: NFS-e EMITIDA e autorizada. É sobre ESTAS notas que "a atividade está
   * certa?", "o mês está certo?" e "o ISS está certo?" fazem sentido — uma nota cancelada não entra
   * em apuração nenhuma, e apontá-la seria pedir ao contador que corrigisse o que já foi desfeito.
   */
  APURADA: "APURADA",
  /**
   * ⚠ TODA NFS-e EMITIDA, INCLUSIVE A CANCELADA. Vale para a numeração da DPS e para "a nota não
   * pôde ser lida", e o motivo é o mesmo dos dois lados: **não existe inutilização na NFS-e**
   * (varrido nos 16 eventos do Anexo II — ver `apps/api/CLAUDE.md`). A nota cancelada CONSUMIU o
   * número; tirá-la da conta transformaria cada cancelamento num "buraco" inventado pela auditoria.
   */
  EMITIDA: "EMITIDA",
});

/** ⚠ NF-e não passa por aqui: `nfeProc/NFe/infNFe` não tem `cTribNac`, nem DPS, nem ISSQN. */
const ehNfse = (n) => String(n?.type || "").toUpperCase() === TIPO_NFSE;
const ehEmitida = (n) => String(n?.papel || "").toUpperCase() === PAPEL_EMITIDA;
const ehAutorizada = (n) => String(n?.statusEfetivo || "") === STATUS_QUE_A_APURACAO_CONTA;

function filtrarPopulacao(notas, populacao) {
  const base = (Array.isArray(notas) ? notas : []).filter((n) => n && ehNfse(n) && ehEmitida(n));
  return populacao === POPULACAO.APURADA ? base.filter(ehAutorizada) : base;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS CINCO PERGUNTAS — o texto é DADO, não string solta no componente
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// `pergunta` é a frase que a tela mostra no cabeçalho do bloco; `achado` é a frase de UMA linha.
// As duas são interrogativas ou descritivas — nunca conclusivas. `escopo` documenta em que janela a
// pergunta é respondida, porque nem todas são mensais (ver `NUMERACAO_DA_DPS`).

export const PERGUNTAS = Object.freeze({
  ATIVIDADE_FORA_DO_CADASTRO: Object.freeze({
    id: "ATIVIDADE_FORA_DO_CADASTRO",
    titulo: "Atividade fora do cadastro",
    pergunta: "Alguma nota saiu num código de serviço que não está cadastrado na empresa?",
    achado: "esta nota usa um código de serviço que não está no cadastro da empresa",
    populacao: POPULACAO.APURADA,
    escopo: "COMPETENCIA",
    // ⚠ A AUTORIDADE É O CADASTRO, e ele é uma LISTA (`Company.codigosServicoNacional`, N códigos
    // escolhidos da lista oficial de 335 em `apps/web/src/lib/servicosNacionais/`). Sem lista não
    // há critério — e sem critério não há achado. Ver `EMPRESA_SEM_CODIGOS_CADASTRADOS`.
    fonte: "Company.codigosServicoNacional × PortalInvoice.cTribNac",
  }),

  EMISSAO_FORA_DA_COMPETENCIA: Object.freeze({
    id: "EMISSAO_FORA_DA_COMPETENCIA",
    titulo: "Emissão fora da competência",
    pergunta: "Alguma nota está sendo contada num mês diferente do mês em que foi emitida?",
    achado: "esta nota está contada numa competência diferente do mês da data de emissão",
    populacao: POPULACAO.APURADA,
    escopo: "COMPETENCIA",
    // ⚠ NÃO É UM ERRO POR SI. A competência da NFS-e vem do próprio documento (`dCompet`) e pode
    // legitimamente ser o mês anterior ao da emissão — é o caso do serviço prestado em julho e
    // faturado no dia 1º de agosto. Medido em produção: 1.727 das 1.738 divergências são de
    // exatamente um mês, e a emissão cai nos primeiros dias. Por isso o achado traz
    // `mesesDeDesvio` — o contador precisa distinguir "virada de mês" de "cinco meses atrás".
    fonte: "PortalInvoice.competencia × PortalInvoice.issueDate (data CIVIL, nunca fuso local)",
  }),

  ISS_ZERADO_ONDE_TRIBUTA: Object.freeze({
    id: "ISS_ZERADO_ONDE_TRIBUTA",
    titulo: "ISS zerado onde a atividade tributa",
    pergunta: "Alguma nota tem base ou alíquota de ISSQN e mesmo assim saiu com imposto zero?",
    achado: "esta nota tem base/alíquota de ISSQN e o valor do imposto saiu zerado",
    populacao: POPULACAO.APURADA,
    escopo: "COMPETENCIA",
    // ⚠ NOTA SEM NENHUM DOS TRÊS CAMPOS NÃO É ACHADO. Alíquota, base e valor ausentes ao mesmo
    // tempo é o desenho de uma nota imune, isenta ou com ISS retido pelo tomador — e chamar isso de
    // "ISS zerado" acusaria a nota certa. Medido: 202 das 209 notas sem alíquota também não têm nem
    // base nem valor. Elas saem em `naoAvaliadas`, nomeadas.
    fonte: "PortalInvoice.issqnBaseCalculo / issqnAliquota / issqnValor",
  }),

  NUMERACAO_DA_DPS: Object.freeze({
    id: "NUMERACAO_DA_DPS",
    titulo: "Numeração da DPS",
    pergunta: "Dentro de uma mesma série, algum número de DPS foi repetido ou pulado?",
    achado: "a numeração desta série tem um número repetido ou um intervalo sem nota",
    populacao: POPULACAO.EMITIDA,
    // ⚠ NUMERAÇÃO NÃO É FATO MENSAL, e tratá-la como tal fabricaria buracos: a nota nº 100 de
    // julho e a nº 101 de agosto vizinham numa série e não numa competência. Por isso esta pergunta
    // é respondida sobre uma JANELA declarada (que o chamador escolhe) e o resultado devolve
    // `janela` + a faixa observada de cada série — a tela diz **entre quais números** conferiu.
    escopo: "JANELA_DA_SERIE",
    // ⚠ E NÃO SE REPORTA BURACO NA BORDA: um salto exige número dos DOIS lados. O menor e o maior
    // número observados são o limite do que sabemos, não prova de que nada existe além.
    fonte: "PortalInvoice.dpsSerie + PortalInvoice.dpsNumero",
  }),

  NOTA_NAO_LIDA: Object.freeze({
    id: "NOTA_NAO_LIDA",
    titulo: "Nota que não pôde ser lida",
    pergunta: "De alguma nota deste mês não conseguimos extrair os campos fiscais do XML?",
    achado: "os campos fiscais desta nota não foram extraídos do XML",
    populacao: POPULACAO.EMITIDA,
    escopo: "COMPETENCIA",
    // ⚠ ELA APARECE, COM O MOTIVO — não some. Uma nota ilegível é justamente a que as outras quatro
    // perguntas não conseguem avaliar; escondê-la faria o mês parecer conferido.
    fonte: "PortalInvoice.camposFiscaisMotivo + camposFiscaisExtraidosEm",
  }),
});

/** A resposta de uma pergunta: ou ela foi respondida, ou se diz por que não foi. Nunca as duas. */
export const SITUACAO = Object.freeze({
  /** A pergunta foi respondida. `achados: []` aqui significa **nada a apontar** — e isso é notícia. */
  CONFERIDA: "CONFERIDA",
  /** Não havia como responder. `motivo` diz o quê falta. **Não** é o mesmo que zero achados. */
  NAO_CONFERIVEL: "NAO_CONFERIVEL",
});

/** Por que uma pergunta INTEIRA não pôde ser respondida. Vocabulário fechado. */
export const MOTIVO_NAO_CONFERIVEL = Object.freeze({
  /** Não há nota na população desta pergunta — mês sem nota emitida, por exemplo. */
  SEM_NOTAS: "SEM_NOTAS",
  /**
   * ⚠ O CASO QUE ESTE MÓDULO EXISTE PARA NÃO ERRAR. A empresa não tem nenhum código de serviço
   * cadastrado, então não há critério contra o qual conferir a atividade. **Não são "todas as notas
   * erradas"** — é "cadastre os códigos". Medido em produção (17/08/2026): 33 de 33 empresas.
   */
  EMPRESA_SEM_CODIGOS_CADASTRADOS: "EMPRESA_SEM_CODIGOS_CADASTRADOS",
  /** Nenhuma nota da população tem o campo que a pergunta lê — a pergunta fica sem base. */
  NENHUMA_NOTA_AVALIAVEL: "NENHUMA_NOTA_AVALIAVEL",
});

/** Por que UMA nota ficou de fora de uma pergunta que foi respondida. Vocabulário fechado. */
export const MOTIVO_NOTA_NAO_AVALIADA = Object.freeze({
  SEM_CODIGO_DE_SERVICO: "SEM_CODIGO_DE_SERVICO",
  SEM_DATA_DE_EMISSAO: "SEM_DATA_DE_EMISSAO",
  SEM_COMPETENCIA: "SEM_COMPETENCIA",
  /** Nem base, nem alíquota, nem valor de ISSQN: o desenho de nota imune/isenta/retida na fonte. */
  SEM_ISSQN_NO_XML: "SEM_ISSQN_NO_XML",
  SEM_NUMERO_DE_DPS: "SEM_NUMERO_DE_DPS",
  SEM_SERIE_DE_DPS: "SEM_SERIE_DE_DPS",
  /** `dpsNumero` presente e não numérico — não entra na conta de salto, e não vira zero. */
  NUMERO_DE_DPS_NAO_NUMERICO: "NUMERO_DE_DPS_NAO_NUMERICO",
});

/** As espécies de achado dentro de uma mesma pergunta. */
export const ESPECIE = Object.freeze({
  /** ISSQN: há alíquota maior que zero e o valor do imposto é nulo ou zero. */
  ALIQUOTA_SEM_VALOR: "ALIQUOTA_SEM_VALOR",
  /** ISSQN: há base de cálculo maior que zero e o valor do imposto é nulo ou zero. */
  BASE_SEM_VALOR: "BASE_SEM_VALOR",
  /** DPS: o mesmo (série, número) em mais de uma nota. */
  NUMERO_REPETIDO: "NUMERO_REPETIDO",
  /** DPS: faixa de números sem nota nenhuma, ENTRE duas notas que existem. */
  NUMERO_PULADO: "NUMERO_PULADO",
  /** A extração rodou e falhou, com motivo nomeado por `camposFiscaisNfse.MOTIVO`. */
  LEITURA_FALHOU: "LEITURA_FALHOU",
  /**
   * ⚠ O QUARTO ESTADO, e ele é diferente de "o XML não traz o campo". `camposFiscaisExtraidosEm`
   * nulo numa NFS-e quer dizer que o extrator **nunca passou por esta linha** — é o defeito que a
   * captura pagou uma vez (notas nascendo com as colunas nulas durante o backfill) e é a razão de a
   * coluna do carimbo existir. Medido em produção (17/08/2026): **5 notas EMIT**, todas com XML de
   * ~9,8 KB guardado, criadas às 15:38. Se esta pergunta lesse só `camposFiscaisMotivo`, essas
   * cinco sumiriam da tela — e sumiriam também das outras quatro perguntas, por falta de campo.
   */
  NUNCA_EXTRAIDA: "NUNCA_EXTRAIDA",
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Leitura de valores — ausente é `null`, nunca `0`
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ As colunas de ISSQN são `Decimal` no Prisma e chegam como objeto (ou string). `Number(null)` é
// `0`, e um `0` aqui afirmaria "ISS apurado: R$ 0,00" — que é uma afirmação fiscal sobre um campo
// que simplesmente não veio. É o mesmo defeito já travado em `folhaAusenteNaoEZero.test.js`.
function numeroOuNulo(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** O MÊS civil (`"2026-08"`) de um valor gravado como data. `""` quando não dá para dizer. */
function mesCivil(v) {
  // ⚠ `dataCivilISO` é a leitura do projeto para "que DIA é este dado?" — ela fatia/lê em UTC, que
  // é a forma em que o backend grava. Ler com fuso local move o dia para trás às 21h em São Paulo,
  // e no dia 1º move o MÊS — que é exatamente o que esta pergunta mede. Não há segunda leitura de
  // data aqui de propósito: `apps/api/src/utils/dataCivil.js` e `apps/web/src/lib/dataCivil.js` são
  // o par, e foi um dia inteiro de conserto em quatro telas que os produziu.
  const iso = dataCivilISO(v);
  return iso ? iso.slice(0, 7) : "";
}

/** Distância em meses entre dois `"AAAA-MM"`. Negativa = a competência está ATRÁS da emissão. */
function mesesEntre(mesA, mesB) {
  const a = /^(\d{4})-(\d{2})$/.exec(mesA);
  const b = /^(\d{4})-(\d{2})$/.exec(mesB);
  if (!a || !b) return null;
  return (Number(a[1]) * 12 + Number(a[2])) - (Number(b[1]) * 12 + Number(b[2]));
}

/** A identificação que toda linha de achado carrega, para a tela poder abrir a nota. */
function identificacao(nota) {
  return {
    notaId: nota?.id ?? null,
    numero: nota?.numero ?? null,
    chaveAcesso: nota?.chaveAcesso ?? null,
    emissao: dataCivilISO(nota?.issueDate) || null,
    competencia: mesCivil(nota?.competencia) || null,
    valor: numeroOuNulo(nota?.total),
  };
}

function respostaConferida(definicao, { achados, avaliadas, naoAvaliadas, extra = {} }) {
  return {
    ...definicao,
    situacao: SITUACAO.CONFERIDA,
    motivo: null,
    avaliadas,
    achados,
    naoAvaliadas,
    ...extra,
  };
}

function respostaNaoConferivel(definicao, motivo, { naoAvaliadas = [], extra = {} } = {}) {
  return {
    ...definicao,
    situacao: SITUACAO.NAO_CONFERIVEL,
    motivo,
    avaliadas: 0,
    achados: [],
    naoAvaliadas,
    ...extra,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1 — ATIVIDADE FORA DO CADASTRO
// ────────────────────────────────────────────────────────────────────────────────────────────────

function perguntaAtividade(notas, codigosCadastrados) {
  const def = PERGUNTAS.ATIVIDADE_FORA_DO_CADASTRO;
  const cadastrados = (Array.isArray(codigosCadastrados) ? codigosCadastrados : [])
    .map((c) => String(c ?? "").replace(/\D+/g, ""))
    .filter(Boolean);
  const extra = { cadastrados };

  // ⚠ A ORDEM IMPORTA: a falta de cadastro é respondida ANTES da falta de notas. Uma empresa sem
  // códigos e sem notas precisa ouvir "cadastre os códigos" — dizer só "não houve nota" esconderia
  // o cadastro vazio até o mês em que ele passasse a custar dinheiro.
  if (!cadastrados.length) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.EMPRESA_SEM_CODIGOS_CADASTRADOS, { extra });
  }
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS, { extra });

  const permitidos = new Set(cadastrados);
  const achados = [];
  const naoAvaliadas = [];
  let avaliadas = 0;

  for (const nota of notas) {
    const codigo = String(nota.cTribNac ?? "").trim();
    if (!codigo) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_CODIGO_DE_SERVICO });
      continue;
    }
    avaliadas += 1;
    // ⚠ Comparação DÍGITO A DÍGITO, sem `padStart`, sem prefixo, sem "começa com". O `cTribNac` é
    // item(2)+subitem(2)+desdobro(2): `310104` e `3101` são serviços diferentes, e casar por
    // prefixo aprovaria o desdobro errado — a granularidade que a lista oficial existe para dar.
    // Completar com zero à esquerda seria adivinhar o que o emitente quis dizer (a armadilha
    // `010101` × `10101` já registrada no gerador da lista).
    if (!permitidos.has(codigo.replace(/\D+/g, ""))) {
      achados.push({
        pergunta: def.id,
        ...identificacao(nota),
        dados: { cTribNac: codigo, descricaoNaNota: nota.xTribNac ?? null, cadastrados },
      });
    }
  }
  if (!avaliadas) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL, { naoAvaliadas, extra });
  }
  return respostaConferida(def, { achados, avaliadas, naoAvaliadas, extra });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2 — DATA DE EMISSÃO FORA DA COMPETÊNCIA
// ────────────────────────────────────────────────────────────────────────────────────────────────

function perguntaEmissao(notas) {
  const def = PERGUNTAS.EMISSAO_FORA_DA_COMPETENCIA;
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS);

  const achados = [];
  const naoAvaliadas = [];
  let avaliadas = 0;

  for (const nota of notas) {
    const mesEmissao = mesCivil(nota.issueDate);
    const mesCompetencia = mesCivil(nota.competencia);
    if (!mesEmissao) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_DATA_DE_EMISSAO });
      continue;
    }
    if (!mesCompetencia) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_COMPETENCIA });
      continue;
    }
    avaliadas += 1;
    if (mesEmissao === mesCompetencia) continue;
    achados.push({
      pergunta: def.id,
      ...identificacao(nota),
      dados: {
        mesDaCompetencia: mesCompetencia,
        mesDaEmissao: mesEmissao,
        // Negativo = a competência está ATRÁS da emissão (serviço de julho faturado em agosto).
        mesesDeDesvio: mesesEntre(mesCompetencia, mesEmissao),
      },
    });
  }
  if (!avaliadas) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL, { naoAvaliadas });
  }
  return respostaConferida(def, { achados, avaliadas, naoAvaliadas });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3 — ISS ZERADO ONDE A ATIVIDADE TRIBUTA
// ────────────────────────────────────────────────────────────────────────────────────────────────

function perguntaIss(notas) {
  const def = PERGUNTAS.ISS_ZERADO_ONDE_TRIBUTA;
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS);

  const achados = [];
  const naoAvaliadas = [];
  let avaliadas = 0;

  for (const nota of notas) {
    const base = numeroOuNulo(nota.issqnBaseCalculo);
    const aliquota = numeroOuNulo(nota.issqnAliquota);
    const valor = numeroOuNulo(nota.issqnValor);

    // ⚠ NENHUM DOS TRÊS ⇒ NÃO É ACHADO. É o desenho de uma nota imune, isenta ou com o ISS retido
    // pelo tomador — e o XML de quem não deve ISS simplesmente não traz o grupo. Acusar aqui seria
    // derivar erro fiscal de AUSÊNCIA de dado, que é o oposto do princípio 1.
    if (base === null && aliquota === null && valor === null) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_ISSQN_NO_XML });
      continue;
    }
    avaliadas += 1;
    const semImposto = valor === null || valor === 0;
    if (!semImposto) continue;

    // Duas espécies porque são dois sinais diferentes, e o contador age diferente em cada um:
    // alíquota positiva sem valor é conta que não fechou; base positiva sem alíquota nem valor é
    // nota que talvez devesse ter destacado o imposto.
    const especie = aliquota !== null && aliquota > 0
      ? ESPECIE.ALIQUOTA_SEM_VALOR
      : (base !== null && base > 0 ? ESPECIE.BASE_SEM_VALOR : null);
    if (!especie) continue;

    achados.push({
      pergunta: def.id,
      ...identificacao(nota),
      dados: { especie, issqnBaseCalculo: base, issqnAliquota: aliquota, issqnValor: valor },
    });
  }
  if (!avaliadas) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL, { naoAvaliadas });
  }
  return respostaConferida(def, { achados, avaliadas, naoAvaliadas });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4 — NÚMERO DA DPS PULADO OU REPETIDO
// ────────────────────────────────────────────────────────────────────────────────────────────────

function perguntaNumeracao(notas, janela) {
  const def = PERGUNTAS.NUMERACAO_DA_DPS;
  const extra = { janela: janela ?? null, series: [] };
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS, { extra });

  const naoAvaliadas = [];
  const porSerie = new Map(); // serie → Map(numero → [notas])
  let avaliadas = 0;

  for (const nota of notas) {
    const serie = String(nota.dpsSerie ?? "").trim();
    const bruto = String(nota.dpsNumero ?? "").trim();
    if (!serie) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_SERIE_DE_DPS });
      continue;
    }
    if (!bruto) {
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_NUMERO_DE_DPS });
      continue;
    }
    if (!/^\d+$/.test(bruto)) {
      // Presente e ilegível não vira zero, e não some: sem ele a faixa da série ficaria menor do
      // que é, e um buraco poderia ser inventado logo ao lado.
      naoAvaliadas.push({ ...identificacao(nota), motivo: MOTIVO_NOTA_NAO_AVALIADA.NUMERO_DE_DPS_NAO_NUMERICO });
      continue;
    }
    avaliadas += 1;
    const numero = Number(bruto);
    if (!porSerie.has(serie)) porSerie.set(serie, new Map());
    const mapa = porSerie.get(serie);
    if (!mapa.has(numero)) mapa.set(numero, []);
    mapa.get(numero).push(nota);
  }

  if (!avaliadas) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL, { naoAvaliadas, extra });
  }

  const achados = [];
  const series = [];

  for (const serie of [...porSerie.keys()].sort()) {
    const mapa = porSerie.get(serie);
    const numeros = [...mapa.keys()].sort((a, b) => a - b);
    const de = numeros[0];
    const ate = numeros[numeros.length - 1];

    for (const numero of numeros) {
      const lista = mapa.get(numero);
      if (lista.length < 2) continue;
      // ⚠ O achado do repetido NÃO tem uma nota só — ele tem o conjunto. Apontar a "segunda"
      // escolheria uma das duas como a errada, e essa escolha é do contador.
      achados.push({
        pergunta: def.id,
        notaId: null,
        numero: null,
        chaveAcesso: null,
        emissao: null,
        competencia: null,
        valor: null,
        dados: {
          especie: ESPECIE.NUMERO_REPETIDO,
          serie,
          numeroDps: numero,
          notas: lista.map((n) => identificacao(n)),
        },
      });
    }

    // Os buracos, agrupados em FAIXAS consecutivas: uma linha "faltam 6580..6602" em vez de 23.
    // ⚠ Só ENTRE dois números observados — a borda da janela não é buraco, é o limite do que
    // sabemos. Sem essa regra, toda série reportaria um "salto" do 1 até o primeiro número visto.
    const faltando = [];
    for (let i = 0; i < numeros.length - 1; i += 1) {
      const atual = numeros[i];
      const proximo = numeros[i + 1];
      if (proximo - atual <= 1) continue;
      faltando.push({ de: atual + 1, ate: proximo - 1, quantidade: proximo - atual - 1, antes: atual, depois: proximo });
    }
    for (const faixa of faltando) {
      achados.push({
        pergunta: def.id,
        notaId: null,
        numero: null,
        chaveAcesso: null,
        emissao: null,
        competencia: null,
        valor: null,
        dados: { especie: ESPECIE.NUMERO_PULADO, serie, ...faixa },
      });
    }

    series.push({
      serie,
      de,
      ate,
      notas: numeros.reduce((s, n) => s + mapa.get(n).length, 0),
      numerosDistintos: numeros.length,
      pulados: faltando.reduce((s, f) => s + f.quantidade, 0),
      repetidos: numeros.filter((n) => mapa.get(n).length > 1).length,
    });
  }

  return respostaConferida(def, { achados, avaliadas, naoAvaliadas, extra: { ...extra, series } });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 5 — NOTA QUE NÃO PÔDE SER LIDA
// ────────────────────────────────────────────────────────────────────────────────────────────────

function perguntaLeitura(notas) {
  const def = PERGUNTAS.NOTA_NAO_LIDA;
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS);

  const achados = [];
  for (const nota of notas) {
    const motivo = nota.camposFiscaisMotivo ? String(nota.camposFiscaisMotivo) : null;
    if (motivo) {
      achados.push({
        pergunta: def.id,
        ...identificacao(nota),
        dados: { especie: ESPECIE.LEITURA_FALHOU, motivo, temXml: Boolean(nota.temXml ?? nota.xmlRaw) },
      });
      continue;
    }
    if (!nota.camposFiscaisExtraidosEm) {
      achados.push({
        pergunta: def.id,
        ...identificacao(nota),
        dados: { especie: ESPECIE.NUNCA_EXTRAIDA, motivo: null, temXml: Boolean(nota.temXml ?? nota.xmlRaw) },
      });
    }
  }
  // ⚠ Toda nota da população é avaliável aqui — é a única pergunta que não depende de campo
  // extraído, e é justamente por isso que ela é a rede das outras quatro.
  return respostaConferida(def, { achados, avaliadas: notas.length, naoAvaliadas: [] });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A ENTRADA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Responde as cinco perguntas da auditoria pré-apuração sobre notas JÁ CARREGADAS.
 *
 * PURA: sem prisma, sem rede, sem escrita. Duas listas porque são duas janelas — ver
 * `PERGUNTAS.NUMERACAO_DA_DPS.escopo`.
 *
 * @param {Object} args
 * @param {string} args.competencia          `"AAAA-MM"` — o mês que está sendo auditado.
 * @param {Array}  args.notas                notas da COMPETÊNCIA (papel/type/status crus; o filtro
 *                                           de população é desta regra, não do chamador).
 * @param {Array}  [args.notasDaSerie]       notas da JANELA usada para a numeração da DPS. Ausente
 *                                           ⇒ usa `notas`, e a janela declarada é a competência.
 * @param {{de?:string, ate?:string}} [args.janelaDaSerie] a janela que o chamador de fato carregou.
 * @param {string[]} [args.codigosServicoNacional] o cadastro da empresa — a AUTORIDADE da pergunta 1.
 * @returns {{competencia:string, totalNotas:number, totalAchados:number,
 *            perguntasConferidas:number, perguntasNaoConferiveis:number, perguntas:Array}}
 */
export function auditarNotasDaCompetencia({
  competencia,
  notas,
  notasDaSerie,
  janelaDaSerie = null,
  codigosServicoNacional = [],
} = {}) {
  const apuradas = filtrarPopulacao(notas, POPULACAO.APURADA);
  const emitidas = filtrarPopulacao(notas, POPULACAO.EMITIDA);
  const daSerie = filtrarPopulacao(notasDaSerie ?? notas, POPULACAO.EMITIDA);

  const perguntas = [
    perguntaAtividade(apuradas, codigosServicoNacional),
    perguntaEmissao(apuradas),
    perguntaIss(apuradas),
    perguntaNumeracao(daSerie, janelaDaSerie ?? { de: competencia ?? null, ate: competencia ?? null }),
    perguntaLeitura(emitidas),
  ];

  return {
    competencia: competencia ?? null,
    // Os dois números que a tela precisa para não confundir "nada a apontar" com "nada a olhar".
    totalNotas: emitidas.length,
    totalNotasApuradas: apuradas.length,
    totalAchados: perguntas.reduce((s, p) => s + p.achados.length, 0),
    perguntasConferidas: perguntas.filter((p) => p.situacao === SITUACAO.CONFERIDA).length,
    perguntasNaoConferiveis: perguntas.filter((p) => p.situacao === SITUACAO.NAO_CONFERIVEL).length,
    perguntas,
  };
}

/**
 * ⚠ Os campos que `auditarNotasDaCompetencia` lê — para o chamador não inventar o `select`.
 * Mesma disciplina de `fechamentoBlockers.SELECT_PARA_BLOQUEIOS`: a regra diz o que precisa, e a
 * query fica no serviço. `xmlRaw` NÃO entra (são até 10 KB por nota, 15 mil notas); quem quiser
 * dizer se há XML passa `temXml`, derivado no serviço.
 */
export const SELECT_PARA_AUDITORIA = Object.freeze({
  id: true, numero: true, chaveAcesso: true, type: true, papel: true, statusEfetivo: true,
  issueDate: true, competencia: true, total: true,
  cTribNac: true, xTribNac: true,
  issqnBaseCalculo: true, issqnAliquota: true, issqnValor: true,
  dpsSerie: true, dpsNumero: true,
  camposFiscaisExtraidosEm: true, camposFiscaisMotivo: true,
});

export const _internos = { mesCivil, mesesEntre, numeroOuNulo, filtrarPopulacao };
