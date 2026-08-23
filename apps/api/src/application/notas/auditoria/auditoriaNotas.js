// A AUDITORIA PRÉ-APURAÇÃO — TRÊS PERGUNTAS sobre as notas do mês, nenhuma sentença.
//
// ─── O PEDIDO DO DONO (17/08/2026) ──────────────────────────────────────────────────────────────
//
// > *"nos ajuda em uma auditoria pré-apuração para entender se a nota está correta ou não, baseado
// >  na atividade e baseado na data de emissão"*
//
// ─── ⚠ O CORTE (21/08/2026) — DE CINCO PERGUNTAS PARA TRÊS, POR DECISÃO DO DONO ─────────────────
//
// A aba nasceu com cinco perguntas e chegou a mostrar **~1.799 "pontos a conferir"**, dos quais
// **~18** eram perguntas de verdade. Uma lista em que 99% é ruído treina o contador a não ler a
// lista — e a pergunta que valia (o ISS zerado) sumia no meio. O dono aprovou o corte. O que saiu,
// e por quê:
//
//   • **NUMERACAO_DA_DPS — REMOVIDA (falso positivo, provado na fonte).** Ver o bloco
//     "⚠ POR QUE NÃO EXISTE MAIS UMA PERGUNTA DE NUMERAÇÃO DA DPS", logo abaixo de `PERGUNTAS`.
//     Ela media 0 repetidos e 54 "buracos", e os buracos eram nossos, não do contribuinte.
//   • **NOTA_NAO_LIDA — SAIU DA TELA DO CONTADOR** (continua sendo calculada e sobe no payload,
//     em `manutencao`). São 5 notas e o defeito é do NOSSO extrator, não da escrituração da
//     empresa. Nada se perde na conferência por isso: a nota ilegível continua aparecendo em
//     `naoAvaliadas` das perguntas 1 e 3, com o motivo — que é onde ela é acionável.
//   • **EMISSAO_FORA_DA_COMPETENCIA — ENXUGADA.** Medido: 1.738 divergências, das quais **1.727 de
//     exatamente um mês** (a virada normal: serviço prestado em julho, faturado em 1º de agosto).
//     Essas 1.727 viraram uma CONTAGEM (`viradaDeMes`) numa linha; só as **11** com dois meses ou
//     mais viram linha de achado. ⚠ A contagem é obrigatória — sem ela a pergunta passaria a
//     esconder 1.727 notas que ela de fato olhou, e "nada some em silêncio" deixaria de ser verdade.
//
// ⚠ O QUE O CORTE **NÃO** PODE LEVAR JUNTO (as quatro decisões que já estavam certas): distinguir
// "conferi e não achei" de "não tive como conferir"; cada achado ser PERGUNTA e nunca veredito;
// nunca pintar de vermelho (vermelho trava fechamento); e mostrar a nota que ficou de fora, com o
// motivo. Os quatro seguem travados em teste.
//
// ─── ⚠ CADA ACHADO É UMA PERGUNTA, NUNCA UM VEREDITO ────────────────────────────────────────────
//
// O sistema **não sabe** se a nota está errada. Ele sabe que algo **não bate** com o cadastro, ou
// que o ISS saiu zerado onde havia base/alíquota, ou que o mês da emissão está longe do mês em que
// a nota está sendo contada. Quem julga é o contador — e é por isso que o texto de cada pergunta mora AQUI,
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
// As perguntas são as que o dono nomeou — e SAEM quando ele manda sair. Uma pergunta nova é
// proposta em relatório, nunca implementada aqui: regra fiscal é decisão dele (princípio 1 do
// `CLAUDE.md` da raiz). O mesmo vale para RETIRAR: a numeração da DPS só saiu depois de a ausência
// da norma ser conferida na fonte oficial (ANEXO_I do Padrão Nacional) e o dono aprovar.

import { dataCivilISO } from "../../../utils/dataCivil.js";

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A POPULAÇÃO — e por que ela NÃO é a mesma em todas as perguntas
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
   * ⚠ TODA NFS-e EMITIDA, INCLUSIVE A CANCELADA. É a população da leitura de manutenção ("a nota
   * não pôde ser lida") e a de `foraDaConferencia`: uma nota cancelada continua sendo um documento
   * que existe, e escondê-la faria o mês parecer mais coberto do que é. (Era também a população da
   * antiga pergunta de numeração, porque **não existe inutilização na NFS-e** — varrido nos 16
   * eventos do Anexo II, ver `apps/api/CLAUDE.md`. Aquela pergunta não existe mais; a razão de a
   * cancelada entrar aqui, sim.)
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
// AS PERGUNTAS — o texto é DADO, não string solta no componente
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// `pergunta` é a frase que a tela mostra no cabeçalho do bloco; `achado` é a frase de UMA linha.
// As duas são interrogativas ou descritivas — nunca conclusivas. `escopo` documenta em que janela a
// pergunta é respondida. Hoje as três da tela são mensais.
//
// ⚠ `NOTA_NAO_LIDA` continua definida aqui, mas **não é uma pergunta da tela do contador** desde
// 21/08/2026 — ela sobe em `manutencao`. Ver a nota na própria definição.

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
    titulo: "Emissão em mês distante da competência",
    pergunta: "Alguma nota está sendo contada num mês DOIS ou mais meses distante do da emissão?",
    achado: "esta nota está contada numa competência distante do mês da data de emissão",
    populacao: POPULACAO.APURADA,
    escopo: "COMPETENCIA",
    // ⚠ NÃO É UM ERRO POR SI. A competência da NFS-e vem do próprio documento (`dCompet`) e pode
    // legitimamente ser o mês anterior ao da emissão — é o caso do serviço prestado em julho e
    // faturado no dia 1º de agosto. Medido em produção: 1.727 das 1.738 divergências são de
    // exatamente um mês, e a emissão cai nos primeiros dias.
    //
    // ⚠ POR ISSO A PERGUNTA MUDOU DE RECORTE EM 21/08/2026: um mês de desvio deixou de virar linha e
    // passou a virar a contagem `viradaDeMes`; só dois meses ou mais viram achado (ver
    // `MESES_DE_DESVIO_QUE_VIRAM_ACHADO`). O `titulo` e a `pergunta` acima foram reescritos junto —
    // deixar a frase antiga sobre o recorte novo faria a tela prometer uma varredura que ela não faz.
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

  // ⚠⚠ AQUI HAVIA `NUMERACAO_DA_DPS` ("algum número de DPS foi repetido ou pulado?"). ELA FOI
  // REMOVIDA EM 21/08/2026, com aprovação do dono, porque era um FALSO POSITIVO — e este comentário
  // existe para que ninguém a reintroduza daqui a seis meses achando que fez uma melhoria.
  //
  // ── 1. A NORMA NÃO DIZ O QUE A PERGUNTA AFIRMAVA (fonte oficial, conferida) ────────────────────
  //
  // A regra **E0014** do Padrão Nacional (`ANEXO_I`, aba `RN DPS_NFS-e`, linha 148) define a
  // unicidade da DPS por **QUATRO** componentes: **Série + Número + Município Emissor + CNPJ/CPF do
  // emitente**. A pergunta comparava **DOIS** (série + número), dentro de uma empresa e ignorando o
  // município — ou seja, ela nunca esteve implementando E0014.
  //
  // ── 2. NÃO EXISTE REGRA DE NUMERAÇÃO CONTÍNUA DA DPS ──────────────────────────────────────────
  //
  // Varridas as **653 regras** do `ANEXO_I`: nenhuma exige que a numeração da DPS seja contínua ou
  // sem lacunas. O único campo com regra de sequência é o **`nNFSe`** — e ele é gerado pela
  // Receita, não pelo contribuinte. Um "buraco" na DPS, portanto, não viola norma nenhuma: apontá-lo
  // era o sistema inventando obrigação fiscal, que é exatamente o princípio 1 do `CLAUDE.md` da raiz.
  //
  // ── 3. OS "BURACOS" ERAM NOSSOS, NÃO DO CONTRIBUINTE ──────────────────────────────────────────
  //
  // Medido: 0 repetidos e 54 saltos. Duas causas comprovadas, as duas do nosso lado:
  //   a) a consulta filtrava por `competencia: { gte, lt }` — e **nota sem competência sumia antes
  //      de a regra existir**, sem sequer aparecer em "notas fora desta conferência". O salto que
  //      ela deixava na série era fabricado por nós (isso está consertado; ver `foraDaConferencia`);
  //   b) a captura do ADN comprovadamente pulou documentos. O que a pergunta media era a nossa
  //      COBERTURA de captura — informação útil para nós, e acusação injusta contra a empresa.
  //
  // ── 4. E O RAMO "REPETIDO" SAIU JUNTO ─────────────────────────────────────────────────────────
  //
  // Ele dava 0 achados, e a frase descrevia algo que o sistema nacional impede na origem (E0014
  // rejeita a segunda DPS com a mesma chave de quatro componentes). Manter na tela uma pergunta que
  // só pode responder "não" é gastar a atenção do contador com uma certeza.
  //
  // Se algum dia isto voltar, tem de voltar como MEDIÇÃO DA NOSSA CAPTURA (painel de operação), com
  // as quatro componentes de E0014, e nunca como pergunta na tela do contador.

  // ⚠ NÃO É MAIS UMA PERGUNTA DA TELA (21/08/2026). Continua calculada e sobe em `manutencao`,
  // porque o sinal é real e é NOSSO: `camposFiscaisExtraidosEm` nulo quer dizer que o extrator
  // nunca passou pela linha. Só que isso é defeito de sistema, não pergunta de contador — e não
  // esconde nada da conferência, porque a nota ilegível continua saindo em `naoAvaliadas` das
  // perguntas que dependem do campo que faltou, nomeada e com motivo.
  NOTA_NAO_LIDA: Object.freeze({
    id: "NOTA_NAO_LIDA",
    titulo: "Nota que não pôde ser lida",
    pergunta: "De alguma nota deste mês não conseguimos extrair os campos fiscais do XML?",
    achado: "os campos fiscais desta nota não foram extraídos do XML",
    populacao: POPULACAO.EMITIDA,
    escopo: "COMPETENCIA",
    /** ⚠ Marca que esta definição NÃO vai para `perguntas` — quem lê o payload não precisa adivinhar. */
    manutencao: true,
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
  // ⚠ `SEM_NUMERO_DE_DPS`, `SEM_SERIE_DE_DPS` e `NUMERO_DE_DPS_NAO_NUMERICO` saíram com a pergunta
  // de numeração (21/08/2026). Não voltam sem a pergunta voltar — e a pergunta não volta sem norma.
});

/** As espécies de achado dentro de uma mesma pergunta. */
export const ESPECIE = Object.freeze({
  /** ISSQN: há alíquota maior que zero e o valor do imposto é nulo ou zero. */
  ALIQUOTA_SEM_VALOR: "ALIQUOTA_SEM_VALOR",
  /** ISSQN: há base de cálculo maior que zero e o valor do imposto é nulo ou zero. */
  BASE_SEM_VALOR: "BASE_SEM_VALOR",
  // ⚠ `NUMERO_REPETIDO` e `NUMERO_PULADO` saíram com a pergunta de numeração (21/08/2026) — ver o
  // bloco de justificativa em `PERGUNTAS`. Não há regra de numeração contínua da DPS no ANEXO_I.
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

/**
 * ⚠ A PARTIR DE QUANTOS MESES DE DESVIO A NOTA VIRA LINHA NA TELA.
 *
 * Desvio de **um** mês é a virada normal do calendário: serviço prestado em julho, DPS emitida em
 * 1º de agosto, `dCompet` = julho. Medido em produção (21/08/2026): **1.727 das 1.738** divergências
 * eram exatamente isso. Listá-las uma a uma afogava as **11** que mereciam olhar.
 *
 * ⚠ MAS ELAS NÃO SOMEM — viram `viradaDeMes`, uma CONTAGEM que a tela mostra numa linha. A regra da
 * casa é que a auditoria nunca esconde o que olhou; ela pode RESUMIR, e é o que este número faz.
 */
export const MESES_DE_DESVIO_QUE_VIRAM_ACHADO = 2;

function perguntaEmissao(notas) {
  const def = PERGUNTAS.EMISSAO_FORA_DA_COMPETENCIA;
  if (!notas.length) return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.SEM_NOTAS);

  const achados = [];
  const naoAvaliadas = [];
  let avaliadas = 0;
  let viradaDeMes = 0;

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
    // Negativo = a competência está ATRÁS da emissão (serviço de julho faturado em agosto).
    const mesesDeDesvio = mesesEntre(mesCompetencia, mesEmissao);

    // ⚠ DESVIO DE UM MÊS É CONTADO, NÃO LISTADO. E `null` (desvio que não deu para calcular) NÃO cai
    // aqui de propósito: o que não sabemos medir nunca vira "caso normal" — vira linha, para o
    // contador olhar. Silenciar o desconhecido junto com o conhecido é como uma aba de auditoria
    // vira decoração.
    if (mesesDeDesvio !== null && Math.abs(mesesDeDesvio) < MESES_DE_DESVIO_QUE_VIRAM_ACHADO) {
      viradaDeMes += 1;
      continue;
    }

    achados.push({
      pergunta: def.id,
      ...identificacao(nota),
      dados: { mesDaCompetencia: mesCompetencia, mesDaEmissao: mesEmissao, mesesDeDesvio },
    });
  }
  if (!avaliadas) {
    return respostaNaoConferivel(def, MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL, { naoAvaliadas });
  }
  // `viradaDeMes` sobe SEMPRE (mesmo zerado): a tela precisa poder dizer "nenhuma", e um campo que
  // só existe quando é diferente de zero obriga o consumidor a adivinhar o que a ausência quer dizer.
  return respostaConferida(def, {
    achados,
    avaliadas,
    naoAvaliadas,
    extra: { viradaDeMes, mesesDeDesvioMinimo: MESES_DE_DESVIO_QUE_VIRAM_ACHADO },
  });
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
// MANUTENÇÃO — NOTA QUE NÃO PÔDE SER LIDA (⚠ NÃO é pergunta da tela do contador)
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
  // ⚠ Toda nota da população é avaliável aqui — é a única leitura que não depende de campo
  // extraído, e é justamente por isso que ela é a rede das perguntas que dependem.
  return respostaConferida(def, { achados, avaliadas: notas.length, naoAvaliadas: [] });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AS NOTAS QUE A CONFERÊNCIA MENSAL NÃO ALCANÇA — e por que elas aparecem
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// A aba promete, na cara: **"nada some em silêncio"**. Até 21/08/2026 ela quebrava essa promessa no
// lugar mais caro possível: o serviço filtrava por `competencia: { gte, lt }`, e **nota com
// `competencia` NULA nunca chegava à regra** — não entrava em pergunta nenhuma, e não aparecia nem
// na lista de "notas fora desta conferência", porque a regra sequer sabia que ela existia.
//
// ── A DECISÃO (e por que não é "colocar na conferência") ────────────────────────────────────────
//
// A competência é o EIXO desta aba: cada pergunta responde sobre "as notas de AAAA-MM". Uma nota sem
// competência gravada não pertence a mês nenhum, e atribuí-la a um mês pela data de emissão seria o
// sistema INVENTANDO a competência dela — a mesma classe de erro que o princípio 1 do `CLAUDE.md`
// da raiz proíbe, e com consequência fiscal (a competência decide em qual apuração a receita entra).
//
// Então ela **aparece, separada e nomeada**: `foraDaConferencia`. A frase não é "está errada" — é
// *"esta nota não tem competência gravada, então não entra nesta nem em nenhuma outra conferência
// mensal"*. E o número é o de VERDADE (contado no banco), mesmo quando a lista vem truncada.
//
// ⚠ ISSO NÃO É DETALHE COSMÉTICO. Era essa mesma nota invisível que ajudava a fabricar os "buracos"
// da antiga pergunta de numeração: ela sumia da série sem deixar rastro, e a auditoria acusava a
// empresa por uma falha da nossa consulta.

/** O vocabulário de por que uma nota fica FORA de toda a conferência mensal. Lista fechada. */
export const MOTIVO_FORA_DA_CONFERENCIA = Object.freeze({
  /** `PortalInvoice.competencia` nula — a nota não pertence a competência nenhuma. */
  SEM_COMPETENCIA_GRAVADA: "SEM_COMPETENCIA_GRAVADA",
});

/**
 * Monta o bloco `foraDaConferencia` a partir das notas JÁ CARREGADAS pelo serviço.
 *
 * @param {Array}  notasSemCompetencia amostra (o serviço limita) de NFS-e EMIT com `competencia` nula
 * @param {number} total               o total REAL, contado no banco — nunca `notas.length`
 */
function montarForaDaConferencia(notasSemCompetencia, total) {
  const notas = filtrarPopulacao(notasSemCompetencia, POPULACAO.EMITIDA);
  // ⚠ `total == null` PRIMEIRO, e nunca `Number.isFinite(Number(total))`: `Number(null)` é **0**, e
  // um zero aqui afirmaria "conferi, não há nenhuma nota fora" quando o chamador não contou nada.
  // É o mesmo defeito de `numeroOuNulo` logo acima, e o mesmo de `folhaAusenteNaoEZero.test.js`.
  const contagem = total == null || !Number.isFinite(Number(total)) ? notas.length : Number(total);
  return {
    motivo: MOTIVO_FORA_DA_CONFERENCIA.SEM_COMPETENCIA_GRAVADA,
    total: contagem,
    // ⚠ A tela precisa saber que a lista é AMOSTRA para não dizer "são estas" quando são mais.
    listadas: notas.length,
    truncada: contagem > notas.length,
    notas: notas.map((n) => identificacao(n)),
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A ENTRADA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Responde as TRÊS perguntas da auditoria pré-apuração sobre notas JÁ CARREGADAS.
 *
 * PURA: sem prisma, sem rede, sem escrita.
 *
 * ⚠ O retorno tem TRÊS compartimentos, e eles não se misturam:
 *   • `perguntas`   — o que o CONTADOR responde. É o que a tela desenha em bloco.
 *   • `manutencao`  — o que NÓS temos de consertar (nota cujo XML não foi lido). Não é bloco.
 *   • `foraDaConferencia` — o que a conferência mensal não alcança, com o motivo. Não é achado.
 *
 * @param {Object} args
 * @param {string} args.competencia          `"AAAA-MM"` — o mês que está sendo auditado.
 * @param {Array}  args.notas                notas da COMPETÊNCIA (papel/type/status crus; o filtro
 *                                           de população é desta regra, não do chamador).
 * @param {Array}  [args.notasSemCompetencia] amostra de NFS-e EMIT da empresa com `competencia` nula.
 * @param {number} [args.totalSemCompetencia] o total REAL delas, contado no banco.
 * @param {string[]} [args.codigosServicoNacional] o cadastro da empresa — a AUTORIDADE da pergunta 1.
 * @returns {{competencia:string, totalNotas:number, totalAchados:number,
 *            perguntasConferidas:number, perguntasNaoConferiveis:number, perguntas:Array,
 *            manutencao:Object, foraDaConferencia:Object}}
 */
export function auditarNotasDaCompetencia({
  competencia,
  notas,
  notasSemCompetencia = [],
  totalSemCompetencia = null,
  codigosServicoNacional = [],
} = {}) {
  const apuradas = filtrarPopulacao(notas, POPULACAO.APURADA);
  const emitidas = filtrarPopulacao(notas, POPULACAO.EMITIDA);

  const perguntas = [
    perguntaAtividade(apuradas, codigosServicoNacional),
    perguntaEmissao(apuradas),
    perguntaIss(apuradas),
  ];

  // ⚠ FORA de `perguntas`, de propósito (21/08/2026). Continua sendo calculada e continua subindo
  // no payload — o sinal é real e é NOSSO —, mas não é pergunta de contador e não conta em
  // `totalAchados`: somá-la ali faria o cabeçalho anunciar "pontos a conferir" sobre um defeito de
  // extração, que o contador não tem como resolver.
  const leitura = perguntaLeitura(emitidas);

  return {
    competencia: competencia ?? null,
    // Os dois números que a tela precisa para não confundir "nada a apontar" com "nada a olhar".
    totalNotas: emitidas.length,
    totalNotasApuradas: apuradas.length,
    totalAchados: perguntas.reduce((s, p) => s + p.achados.length, 0),
    perguntasConferidas: perguntas.filter((p) => p.situacao === SITUACAO.CONFERIDA).length,
    perguntasNaoConferiveis: perguntas.filter((p) => p.situacao === SITUACAO.NAO_CONFERIVEL).length,
    perguntas,
    manutencao: {
      notasNaoLidas: leitura.achados.length,
      leitura,
    },
    foraDaConferencia: montarForaDaConferencia(notasSemCompetencia, totalSemCompetencia),
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
  // ⚠ `dpsSerie`/`dpsNumero` SAÍRAM em 21/08/2026, com a pergunta de numeração. Nenhuma regra daqui
  // os lê mais; devolvê-los "por via das dúvidas" faria a próxima sessão achar que há conferência
  // de numeração acontecendo em algum lugar.
  camposFiscaisExtraidosEm: true, camposFiscaisMotivo: true,
});

export const _internos = { mesCivil, mesesEntre, numeroOuNulo, filtrarPopulacao };
