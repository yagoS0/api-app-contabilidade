// ONBOARDING — a especificação do formulário como DADO.
//
// ⚠ POR QUE ISTO É UM ARQUIVO DE DADOS, E NÃO JSX
// Quando a ordem, o rótulo e a condição de "aparece / é obrigatório" vivem espalhados em JSX, cada
// tela que percorre o formulário reimplementa a regra — e a ficha do escritório passa a mostrar
// coisa diferente do que o wizard perguntou. Aqui a spec é percorrida pelo wizard E pela ficha de
// leitura, então elas não têm como divergir.
// (O molde original foi o `defisSpec.js`, removido em 12/08/2026 com a extinção da DEFIS. O
// argumento acima nunca dependeu dele.)
//
// ⚠ POR QUE UM ARRAY PLANO, E NÃO TRÊS ÁRVORES POR ORIGEM
// Nome, e-mail e telefone do responsável são as MESMAS três perguntas nas três origens. Em três
// árvores elas apareceriam três vezes — e é exatamente aí que divergem (uma vira obrigatória, outra
// muda de rótulo, a terceira some). O array plano com `origens` faz a pergunta existir uma vez só.
//
// ⚠ POR QUE ISTO MORA EM `apps/web` E NÃO EM `packages/shared`
// O `Dockerfile` da raiz NÃO copia `packages/`, e o `railway.toml` não observa `packages/**`. Um
// import de `@contabilidade/shared` no backend passa em dev, passa nos testes e MORRE NO BOOT em
// produção. Este arquivo é escrito sem nenhuma dependência além de `zod` (mesma versão nos dois
// workspaces), então a migração para `shared` na Fase 2 custa um `git mv` mais o commit do
// Dockerfile — e não uma reescrita.
//
// ⚠ O CATÁLOGO DE ETAPAS NÃO ESTÁ AQUI. Ele mora só no servidor
// (`application/onboarding/etapasTemplate.js`): se a trilha viesse do cliente, quem preenche o
// formulário escolheria o que o escritório tem de conferir.

export const ONBOARDING_ORIGENS = Object.freeze([
  Object.freeze({
    chave: "ABERTURA",
    titulo: "Vai abrir a empresa",
    subtitulo: "Ainda não existe CNPJ. O que se coleta aqui é a intenção: sócios, atividade e regime pretendido.",
    // Acento de CATEGORIA (não de estado), reusado no crachá do quadro para os dois se ensinarem.
    acento: "--accent-cyan",
  }),
  Object.freeze({
    chave: "TRANSFERENCIA",
    titulo: "Está trocando de contador",
    subtitulo: "A empresa já opera. A papelada chega em partes e o passado fiscal vem junto.",
    acento: "--accent-orange",
  }),
  Object.freeze({
    chave: "INATIVA",
    titulo: "Empresa parada",
    subtitulo: "Sem movimento há algum tempo. O trabalho é dimensionar o passivo e decidir: reativar ou dar baixa.",
    acento: "--accent-purple",
  }),
]);

export const ONBOARDING_PASSOS = Object.freeze([
  Object.freeze({ chave: "origem", titulo: "Origem" }),
  Object.freeze({ chave: "identificacao", titulo: "Identificação" }),
  Object.freeze({ chave: "responsavel", titulo: "Responsável" }),
  Object.freeze({ chave: "situacao", titulo: "Situação" }),
  Object.freeze({ chave: "revisao", titulo: "Revisão" }),
]);

const TODAS = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];

// Tipo SOCIETÁRIO — ⚠ NÃO é regime tributário. "MEI" aqui responde "que tipo de empresa é",
// e `regimeTributario` responde "como ela é tributada". Confundir os dois é o bug que aparece no
// primeiro MEI real: o cadastro de empresa só aceita SIMPLES | LUCRO_PRESUMIDO | LUCRO_REAL, e um
// "MEI" mandado como regime é recusado com `company_regime_tributario_invalid`.
const TIPOS_EMPRESA = Object.freeze([
  { valor: "MEI", rotulo: "MEI — Microempreendedor Individual" },
  { valor: "EI", rotulo: "EI — Empresário Individual" },
  { valor: "SLU", rotulo: "SLU — Sociedade Limitada Unipessoal" },
  { valor: "LTDA", rotulo: "LTDA — Sociedade Limitada" },
  { valor: "SA", rotulo: "S/A — Sociedade Anônima" },
  { valor: "OUTRO", rotulo: "Outro" },
]);

const REGIMES_DECLARADOS = Object.freeze([
  { valor: "SIMPLES", rotulo: "Simples Nacional" },
  { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
  { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
  { valor: "MEI", rotulo: "MEI" },
  // ⚠ "Não sei" é resposta legítima e precisa existir. Sem ela o contador chuta um regime para
  // conseguir avançar — e um chute registrado como declaração é pior que a ausência do dado.
  { valor: "NAO_SEI", rotulo: "Não sei / preciso confirmar" },
]);

const semSocios = (dados) => !["MEI", "EI"].includes(String(dados?.tipoEmpresa || ""));

/**
 * OS CAMPOS. Cada descritor:
 *   { passo, campo, rotulo, tipo, origens?, visivel?(dados), obrigatorio?(dados),
 *     opcoes?, colunas?, sensivel?, ajuda?, consultaReceita? }
 *
 * - `origens` ausente = vale para as três.
 * - `visivel` ausente = sempre visível.  `obrigatorio` ausente = nunca obrigatório.
 * - ⚠ `visivel` e `obrigatorio` recebem `dados` INTEIRO, não o valor do campo. "MEI esconde
 *   sócios" é regra do rascunho, não do campo — e escrevê-la como função do próprio valor
 *   obrigaria a duplicar a condição em todo campo dependente.
 * - `sensivel: true` = dado DECLARADO, ainda não conferido. Ganha o selo na ficha do escritório.
 */
export const ONBOARDING_CAMPOS = Object.freeze([
  // ── Identificação ───────────────────────────────────────────────────────────
  {
    passo: "identificacao", campo: "razaoSocial", tipo: "texto",
    origens: ["ABERTURA"],
    rotulo: "Nome pretendido",
    ajuda: "Ainda não é razão social de ninguém — é o nome que se vai tentar registrar.",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "razaoSocial", tipo: "texto",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Razão social",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "cnpj", tipo: "cnpj",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "CNPJ",
    obrigatorio: () => true,
    consultaReceita: true,
    // Sensível enquanto vier digitado à mão: a consulta à Receita é o que o torna conferido, e ela
    // pode ter falhado (rede corporativa, bloqueador, offline).
    sensivel: true,
  },
  {
    passo: "identificacao", campo: "nomeFantasia", tipo: "texto",
    origens: ["TRANSFERENCIA", "INATIVA"], rotulo: "Nome fantasia",
  },
  {
    passo: "identificacao", campo: "tipoEmpresa", tipo: "escolha",
    rotulo: "Tipo de empresa",
    ajuda: "Tipo SOCIETÁRIO. Não é o regime tributário — esse é perguntado no passo Situação.",
    opcoes: TIPOS_EMPRESA,
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "atividadePretendida", tipo: "texto",
    origens: ["ABERTURA"],
    rotulo: "Atividade pretendida",
    ajuda: "Em texto livre — o CNAE definitivo só existe depois do registro.",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "municipioPretendido", tipo: "texto",
    origens: ["ABERTURA"], rotulo: "Município da sede (pretendido)",
  },
  {
    passo: "identificacao", campo: "capitalSocialPretendido", tipo: "moeda",
    origens: ["ABERTURA"], rotulo: "Capital social pretendido",
  },
  {
    passo: "identificacao", campo: "socios", tipo: "lista",
    rotulo: "Sócios",
    // ⚠ Some no MEI e no EI: não existe quadro societário nos dois. E o que some precisa ser
    // PODADO antes de salvar — ver `podarInvisiveis`.
    visivel: semSocios,
    colunas: [
      { campo: "nome", rotulo: "Nome", tipo: "texto" },
      { campo: "cpf", rotulo: "CPF", tipo: "cpf" },
      { campo: "participacao", rotulo: "Participação (%)", tipo: "texto" },
    ],
  },

  // ── Responsável ─────────────────────────────────────────────────────────────
  {
    passo: "responsavel", campo: "responsavelNome", tipo: "texto",
    rotulo: "Nome do responsável", obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelEmail", tipo: "email",
    rotulo: "E-mail do responsável",
    ajuda: "Vira o login do cliente no portal quando a empresa for criada.",
    obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelTelefone", tipo: "telefone",
    rotulo: "Telefone / WhatsApp", obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelCargo", tipo: "texto",
    rotulo: "Cargo / relação com a empresa",
  },

  // ── Situação — TRANSFERÊNCIA ────────────────────────────────────────────────
  {
    passo: "situacao", campo: "regimeAtual", tipo: "escolha",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Regime tributário atual", opcoes: REGIMES_DECLARADOS,
    obrigatorio: () => true, sensivel: true,
  },
  {
    passo: "situacao", campo: "contadorAnterior", tipo: "texto",
    origens: ["TRANSFERENCIA"], rotulo: "Contador/escritório anterior",
  },
  {
    passo: "situacao", campo: "motivoTroca", tipo: "texto",
    origens: ["TRANSFERENCIA"], rotulo: "Motivo da troca",
  },
  {
    passo: "situacao", campo: "ultimaCompetenciaEntregue", tipo: "mesAno",
    origens: ["TRANSFERENCIA"],
    rotulo: "Última competência entregue pelo contador anterior", sensivel: true,
  },
  {
    passo: "situacao", campo: "paradaDesde", tipo: "mesAno",
    origens: ["INATIVA"], rotulo: "Parada desde", obrigatorio: () => true, sensivel: true,
  },
  {
    passo: "situacao", campo: "pretendeReativar", tipo: "escolha",
    origens: ["INATIVA"], rotulo: "O que o cliente pretende",
    opcoes: [
      { valor: "REATIVAR", rotulo: "Reativar a empresa" },
      { valor: "BAIXAR", rotulo: "Dar baixa" },
      { valor: "INDECISO", rotulo: "Ainda não decidiu" },
    ],
    obrigatorio: () => true,
  },
  {
    passo: "situacao", campo: "regimePretendido", tipo: "escolha",
    origens: ["ABERTURA"], rotulo: "Regime tributário pretendido",
    ajuda: "Intenção declarada. O enquadramento definitivo é decidido no cadastro da empresa.",
    opcoes: [
      { valor: "SIMPLES", rotulo: "Simples Nacional" },
      { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
      { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
      { valor: "A_DEFINIR", rotulo: "A definir com o contador" },
    ],
    sensivel: true,
  },
  {
    passo: "situacao", campo: "previsaoFaturamento", tipo: "moeda",
    origens: ["ABERTURA"], rotulo: "Previsão de faturamento mensal", sensivel: true,
  },

  // ── Situação — comum a quem já opera (e à abertura, na forma de intenção) ────
  {
    passo: "situacao", campo: "temDebitos", tipo: "booleano",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "O cliente informa ter débitos em aberto", sensivel: true,
  },
  {
    passo: "situacao", campo: "debitosDeclarados", tipo: "moeda",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Valor aproximado dos débitos declarados",
    ajuda: "Valor DECLARADO pelo cliente. O número que vale é o do relatório de situação fiscal.",
    visivel: (dados) => dados?.temDebitos === true,
    sensivel: true,
  },
  {
    passo: "situacao", campo: "temParcelamento", tipo: "booleano",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Tem parcelamento em andamento", sensivel: true,
  },
  {
    passo: "situacao", campo: "pendenciasDeclaradas", tipo: "texto",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Pendências que o cliente conhece", sensivel: true,
  },
  {
    passo: "situacao", campo: "qtdFuncionarios", tipo: "inteiro",
    rotulo: "Quantidade de funcionários", sensivel: true,
  },
  {
    passo: "situacao", campo: "temProLabore", tipo: "booleano",
    rotulo: "Há pró-labore",
    ajuda: "Define se o INSS entra nas obrigações da empresa quando ela for criada.",
    sensivel: true,
  },

  // ── Revisão ─────────────────────────────────────────────────────────────────
  {
    passo: "revisao", campo: "observacoes", tipo: "texto",
    rotulo: "Observações do atendimento",
  },
]);

// ─── SELETORES ────────────────────────────────────────────────────────────────
// Ficam NESTE arquivo de propósito: são eles que impedem a tela de reimplementar a regra. Um
// seletor no componente é uma segunda definição de "este campo aparece?".

function valeParaOrigem(descritor, origem) {
  if (!Array.isArray(descritor.origens)) return true;
  return descritor.origens.includes(origem);
}

function estaVisivel(descritor, dados) {
  if (typeof descritor.visivel !== "function") return true;
  return descritor.visivel(dados || {}) === true;
}

export function ehObrigatorio(descritor, dados) {
  if (typeof descritor.obrigatorio !== "function") return false;
  return descritor.obrigatorio(dados || {}) === true;
}

/** Descritores VISÍVEIS de um passo, na ordem da spec. */
export function camposDoPasso(origem, passo, dados) {
  return ONBOARDING_CAMPOS.filter(
    (d) => d.passo === passo && valeParaOrigem(d, origem) && estaVisivel(d, dados)
  );
}

/** Todos os descritores da origem, visíveis ou não — usado pela poda e pelo `rascunhoVazio`. */
export function camposDaOrigem(origem) {
  return ONBOARDING_CAMPOS.filter((d) => valeParaOrigem(d, origem));
}

/**
 * Os passos do wizard. Hoje todas as origens percorrem os cinco — a função existe para que a tela
 * NUNCA itere `ONBOARDING_PASSOS` direto: no dia em que uma origem pular um passo, muda aqui e
 * todas as telas acompanham.
 */
export function passosVisiveis(origem) {
  if (!ONBOARDING_ORIGENS.some((o) => o.chave === origem)) {
    // Sem origem escolhida existe UM passo: escolher a origem.
    return ONBOARDING_PASSOS.filter((p) => p.chave === "origem");
  }
  return ONBOARDING_PASSOS;
}

const VAZIO_POR_TIPO = {
  booleano: null, // ⚠ `null`, não `false`: "ninguém respondeu" ≠ "respondeu que não"
  lista: [],
};

/** O rascunho em branco daquela origem — a forma canônica de `Onboarding.dados`. */
export function rascunhoVazio(origem) {
  const out = {};
  for (const descritor of camposDaOrigem(origem)) {
    out[descritor.campo] = Object.prototype.hasOwnProperty.call(VAZIO_POR_TIPO, descritor.tipo)
      ? (descritor.tipo === "lista" ? [] : VAZIO_POR_TIPO[descritor.tipo])
      : "";
  }
  return out;
}

/**
 * ⚠ ISTO NÃO É ENFEITE. Escolher LTDA, preencher dois sócios, voltar e trocar para MEI deixa os
 * sócios em `dados`: eles sobrevivem ao PATCH, e a ficha do escritório passa a mostrar quadro
 * societário de um MEI. Chamar ANTES de todo salvamento e de toda validação.
 *
 * Poda também o que não pertence à origem — o rascunho pode carregar resíduo de um estado anterior
 * da tela.
 */
export function podarInvisiveis(origem, dados) {
  const entrada = dados && typeof dados === "object" ? dados : {};
  const permitidos = new Set(
    camposDaOrigem(origem).filter((d) => estaVisivel(d, entrada)).map((d) => d.campo)
  );
  const out = {};
  for (const [chave, valor] of Object.entries(entrada)) {
    if (permitidos.has(chave)) out[chave] = valor;
  }
  return out;
}

function estaPreenchido(valor, tipo) {
  if (tipo === "lista") return Array.isArray(valor) && valor.length > 0;
  if (tipo === "booleano") return valor === true || valor === false;
  return String(valor ?? "").trim() !== "";
}

/**
 * Os problemas de UM passo: `[{ campo, rotulo, motivo }]`. Lista vazia = passo sem pendência.
 *
 * ⚠ Pendência aqui NÃO bloqueia o salvamento — o funil aceita preenchimento parcial por definição,
 * e é a razão de ele existir. Ela só acende o ponto de aviso na trilha e a lista na revisão.
 */
export function problemasDoPasso(origem, passo, dados) {
  const entrada = dados && typeof dados === "object" ? dados : {};
  return camposDoPasso(origem, passo, entrada)
    .filter((d) => ehObrigatorio(d, entrada) && !estaPreenchido(entrada[d.campo], d.tipo))
    .map((d) => ({ campo: d.campo, rotulo: d.rotulo, motivo: "obrigatorio" }));
}

/** Todos os problemas da ficha, passo a passo — o que a tela de revisão lista. */
export function problemasDoRascunho(origem, dados) {
  return passosVisiveis(origem)
    .filter((p) => p.chave !== "origem")
    .flatMap((p) => problemasDoPasso(origem, p.chave, dados).map((x) => ({ ...x, passo: p.chave })));
}

/** Descritor pelo par (origem, campo) — a ficha de leitura usa para achar rótulo e `sensivel`. */
export function descritorDe(origem, campo) {
  return camposDaOrigem(origem).find((d) => d.campo === campo) || null;
}

export const ONBOARDING_SPEC = Object.freeze({
  ONBOARDING_ORIGENS,
  ONBOARDING_PASSOS,
  ONBOARDING_CAMPOS,
});
