// A TELA DE CONVERSAS DE WHATSAPP — a regra, pura. A página só liga.
//
// Três perguntas que a tela responde ANTES do clique:
//   1. o que esta linha É (fila do escritório? assumida? com a IA? com pendência aberta?) — `situacaoDoFio`;
//   2. dá para responder à mão AGORA? — `estadoDaResposta` (a janela de 24h, dita antes de digitar);
//   3. quem escreveu cada balão — `rotuloDoAutor`.
//
// ⚠ NADA aqui decide envio: quem recusa fora da janela é o SERVIDOR (409 `FORA_DA_JANELA`). A tela
// só evita oferecer um campo que vai ser recusado — e, quando oferece a explicação, ela é a mesma
// que o servidor daria.

export const FILTROS = Object.freeze([
  { valor: "todas", rotulo: "Todas" },
  { valor: "nao-vinculadas", rotulo: "Não vinculadas (fila)" },
  { valor: "atendidas-por-mim", rotulo: "Assumidas por mim" },
]);

/**
 * ⚠⚠ QUEM ESTÁ FALANDO, E DE QUAL EMPRESA — as duas, nunca uma OU outra (06/09/2026).
 *
 * A linha da lista fazia isto:
 *
 *     {c.empresa?.razao || c.nomePerfilProvedor || c.telefoneMascarado}
 *
 * Um `||` escolhendo entre coisas que **não se substituem**. Numa conversa de cliente aparecia a
 * EMPRESA e o contador **nunca sabia quem estava falando**; numa da fila aparecia a pessoa e não
 * havia empresa. São duas perguntas — *quem* e *de quem* — e a linha respondia só uma.
 *
 * ⚠ A ORDEM DO NOME TEM AUTORIDADE: o do CADASTRO primeiro. `nomePerfilProvedor` é o nome que a
 * **própria pessoa** escreveu no aparelho dela — pode ser "Financeiro", pode ser qualquer coisa — e
 * é por isso que ele nunca casa contato no vínculo. Aqui ele serve para exibir, e sai **marcado**
 * em `origemDoNome`, para a tela poder dizer que aquele não é o nome que o escritório cadastrou.
 *
 * ⚠ Sem empresa não se inventa nada: `semEmpresa: true` é o estado da fila, e ele é dito.
 */
export const ORIGEM_DO_NOME = Object.freeze({
  CADASTRO: "CADASTRO",
  PERFIL: "PERFIL",
  TELEFONE: "TELEFONE",
});

export const FRASE_ORIGEM_DO_NOME = Object.freeze({
  [ORIGEM_DO_NOME.CADASTRO]: null,
  [ORIGEM_DO_NOME.PERFIL]: "nome do perfil do WhatsApp, não do cadastro",
  [ORIGEM_DO_NOME.TELEFONE]: "sem nome — nem cadastrado, nem no perfil",
});

export function identidadeDaConversa(c) {
  const doCadastro = String(c?.contato?.nome || "").trim();
  const doPerfil = String(c?.nomePerfilProvedor || "").trim();
  const telefone = c?.telefoneMascarado || "número desconhecido";

  const pessoa = doCadastro || doPerfil || telefone;
  const origemDoNome = doCadastro
    ? ORIGEM_DO_NOME.CADASTRO
    : (doPerfil ? ORIGEM_DO_NOME.PERFIL : ORIGEM_DO_NOME.TELEFONE);

  const razao = String(c?.empresa?.razao || "").trim();
  return {
    pessoa,
    origemDoNome,
    avisoDoNome: FRASE_ORIGEM_DO_NOME[origemDoNome],
    papel: String(c?.contato?.papel || "").trim() || null,
    empresa: razao || null,
    cnpj: c?.empresa?.cnpj || null,
    semEmpresa: !razao,
    // A frase da segunda linha: a empresa, ou o estado da fila dito com todas as letras.
    linhaDaEmpresa: razao || "sem empresa — número novo",
  };
}

export const SITUACAO_FIO = Object.freeze({
  FILA_SEM_EMPRESA: "FILA_SEM_EMPRESA",
  FILA_DO_ESCRITORIO: "FILA_DO_ESCRITORIO",
  ASSUMIDA: "ASSUMIDA",
  COM_A_IA: "COM_A_IA",
});

export function situacaoDoFio(c) {
  if (!c?.portalClientId) return SITUACAO_FIO.FILA_SEM_EMPRESA;
  if (c.atendidaPor) return SITUACAO_FIO.ASSUMIDA;
  if (c.atendidaDesde || c.naFilaDoEscritorio) return SITUACAO_FIO.FILA_DO_ESCRITORIO;
  return SITUACAO_FIO.COM_A_IA;
}

/** O rótulo curto da linha — e o tom (âmbar = pendência do escritório; neutro = o resto). */
export function rotuloDaSituacao(c) {
  const s = situacaoDoFio(c);
  if (s === SITUACAO_FIO.FILA_SEM_EMPRESA) {
    const motivo = c?.vinculo?.motivo;
    return { situacao: s, texto: motivo === "AMBIGUO" ? "número em mais de uma empresa — escolha" : "número sem cadastro — vincule", tom: "aviso" };
  }
  if (s === SITUACAO_FIO.ASSUMIDA) return { situacao: s, texto: `assumida por ${c.atendente?.nome || c.atendente?.email || "alguém do escritório"}`, tom: "neutro" };
  if (s === SITUACAO_FIO.FILA_DO_ESCRITORIO) return { situacao: s, texto: "o assistente chamou o escritório", tom: "aviso" };
  return { situacao: s, texto: "com o assistente", tom: "neutro" };
}

export const AUTOR = Object.freeze({ IA: "IA", HUMANO: "HUMANO", SISTEMA: "SISTEMA" });

/** Quem escreveu o balão. Entrada = o cliente; saída sem autor = o envio de guia (template). */
export function rotuloDoAutor(m, { nomeDoCliente = null } = {}) {
  if (m?.direcao === "in") return nomeDoCliente || "cliente";
  if (m?.autor === AUTOR.IA) return "assistente (IA)";
  if (m?.autor === AUTOR.HUMANO) return "escritório";
  if (m?.autor === AUTOR.SISTEMA) return "mensagem fixa";
  if (m?.tipo === "template") return "escritório (modelo)";
  return "escritório";
}

/**
 * Responder à mão: pode? A janela de 24h dita ANTES de digitar.
 * @returns {{pode:boolean, motivo:string|null, situacao:string|null}}
 */
export function estadoDaResposta(conversa) {
  const j = conversa?.janela;
  if (!j) return { pode: false, motivo: "Ainda não sei se a janela de 24h está aberta.", situacao: null };
  if (j.situacao === "ABERTA") return { pode: true, motivo: null, situacao: j.situacao };
  if (j.situacao === "NUNCA_ABERTA") return { pode: false, motivo: "Este cliente nunca escreveu por aqui: a Meta só aceita texto livre nas 24h seguintes a uma mensagem dele. Iniciar exige um modelo aprovado.", situacao: j.situacao };
  if (j.situacao === "EXPIRADA") return { pode: false, motivo: "A janela de 24h desde a última mensagem do cliente fechou: só modelo aprovado agora (o modelo reabrir_conversa ainda não foi aprovado na Meta).", situacao: j.situacao };
  return { pode: false, motivo: "A janela de 24h não pôde ser calculada — confira antes de responder.", situacao: j.situacao };
}

export function fmtDataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** O consumo do assistente, como frase — ESTIMATIVA, e a frase diz. */
export function fraseDoConsumo(consumo) {
  if (!consumo?.escritorio) return "Consumo do assistente: não foi possível ler.";
  const e = consumo.escritorio;
  const usd = (c) => `US$ ${(Number(c || 0) / 100).toFixed(2)}`;
  const estado = e.estourado ? " · TETO ATINGIDO — o assistente está recusando" : e.alerta ? " · perto do teto" : "";
  return `Assistente (IA) neste mês: ${usd(e.centavos)} de ${usd(e.teto)} (estimativa, ${e.chamadas} chamada${e.chamadas === 1 ? "" : "s"})${estado}.`;
}

/** Ordena: fila do escritório/sem empresa primeiro (é pendência), depois por atualização. */
export function ordenarConversas(lista) {
  const peso = (c) => (situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA || situacaoDoFio(c) === SITUACAO_FIO.FILA_DO_ESCRITORIO ? 0 : 1);
  return [...(lista || [])].sort((a, b) => peso(a) - peso(b) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}


/**
 * ⚠ O QUE VEIO, quando não é texto.
 *
 * O webhook grava **todo** tipo de mensagem com o `tipo` cru da Meta e o ponteiro da mídia — mas
 * este sistema **ainda não baixa arquivo**, então o balão mostrava `[image]`, que não é frase nem
 * explicação. Aqui ele vira uma frase que diz o que chegou **e** que não dá para abrir ainda.
 *
 * ⚠ Lista FECHADA: tipo que a Meta inventar amanhã aparece **como veio**, nunca vira o nome do
 * vizinho mais parecido.
 */
const MIDIA = Object.freeze({
  image: "imagem",
  audio: "áudio",
  video: "vídeo",
  document: "documento",
  sticker: "figurinha",
  location: "localização",
  contacts: "contato",
});

export function descricaoDaMidia(m) {
  const tipo = String(m?.tipo || "").toLowerCase();
  if (tipo === "text" || tipo === "template") return null;
  const nome = MIDIA[tipo];
  if (!nome) return `mensagem de tipo "${tipo || "desconhecido"}" — não sei exibir`;
  // ⚠⚠ A RESSALVA É SOBRE O QUE CHEGA, NUNCA SOBRE O QUE SAI (defeito visto no navegador em
  // 06/09/2026). Num documento que o ESCRITÓRIO acabou de mandar, "este sistema ainda não baixa
  // arquivos" é falso e confunde: o arquivo saiu daqui, não há nada a baixar — e o balão já traz o
  // nome dele no corpo. A limitação é a de LER a mídia do cliente.
  if (m?.direcao === "out") return `📎 ${nome} enviado pelo escritório`;
  return `📎 ${nome} — este sistema ainda não baixa arquivos do WhatsApp`;
}

/**
 * ⚠⚠ A CONVERSA PODE SER MAIOR DO QUE A TELA MOSTRA, e isso precisa ser DITO.
 *
 * `temMais` ausente é servidor antigo — e aí a resposta honesta não é "não há mais", é "não sei".
 */
export function frasePaginacao(temMais) {
  if (temMais === true) return "Há mensagens mais antigas que não foram carregadas.";
  if (temMais === false) return null;
  return "Não dá para afirmar que esta é a conversa inteira.";
}
