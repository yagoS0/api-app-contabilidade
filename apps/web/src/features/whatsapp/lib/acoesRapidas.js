// AS AÇÕES RÁPIDAS DO CHAT — o que dá para fazer AGORA, e o motivo de quando não dá (F3, 06/09/2026).
//
// > Dono: as ações da v1 são *"enviar guia · enviar documento · virar anotação"*. Recalcular ficou
// > de fora, por decisão dele.
//
// ⚠⚠ O MOTIVO DO BLOQUEIO É DITO ANTES DO CLIQUE, nunca depois — a mesma disciplina da janela de
// 24 h no compositor. Botão que sempre recusa ensina o contador a não confiar na tela.
//
// ⚠⚠ AS TRÊS NÃO TÊM A MESMA GUARDA, e é isso que esta regra existe para não deixar confundir:
//
//   · **guia** é TEMPLATE aprovado ⇒ funciona **fora** da janela de 24 h (é o único caminho que
//     funciona fora dela);
//   · **documento** é MENSAGEM DE SERVIÇO ⇒ **só dentro** da janela (a Meta recusa com 131047, e a
//     nossa rota recusa antes, com 409 `FORA_DA_JANELA`);
//   · **virar anotação** não fala com a Meta ⇒ a janela não a alcança. O que ela exige é um
//     **destino** — o campo de anotação ao lado. Sem ele a ação não existe (no `/whatsapp` não há
//     campo nenhum), e é por isso que ela não é "bloqueada": ela simplesmente não é oferecida.

export const ACAO = Object.freeze({
  ENVIAR_GUIA: "ENVIAR_GUIA",
  ENVIAR_DOCUMENTO: "ENVIAR_DOCUMENTO",
  VIRAR_ANOTACAO: "VIRAR_ANOTACAO",
});

export const ROTULO_ACAO = Object.freeze({
  [ACAO.ENVIAR_GUIA]: "Enviar guia",
  [ACAO.ENVIAR_DOCUMENTO]: "Enviar documento",
  [ACAO.VIRAR_ANOTACAO]: "Virar anotação",
});

export const MOTIVO = Object.freeze({
  SEM_EMPRESA: "SEM_EMPRESA",
  FORA_DA_JANELA: "FORA_DA_JANELA",
  JANELA_DESCONHECIDA: "JANELA_DESCONHECIDA",
  CANAL_DESLIGADO: "CANAL_DESLIGADO",
  SEM_MENSAGEM: "SEM_MENSAGEM",
});

export const FRASE_MOTIVO = Object.freeze({
  [MOTIVO.SEM_EMPRESA]: "Este número ainda não está vinculado a uma empresa — vincule o fio primeiro.",
  [MOTIVO.FORA_DA_JANELA]: "Fora da janela de 24h: a Meta só aceita modelo aprovado agora, e documento não é modelo.",
  [MOTIVO.JANELA_DESCONHECIDA]: "Não dá para afirmar que a janela de 24h está aberta — esta tela não recebeu o estado dela.",
  [MOTIVO.CANAL_DESLIGADO]: "O canal de WhatsApp está desligado no servidor.",
  [MOTIVO.SEM_MENSAGEM]: "Escolha a mensagem que vira anotação.",
});

/**
 * @param {object} p
 * @param {object|null} p.conversa       o fio aberto
 * @param {object|null} p.janela         `{ situacao }` — vem do servidor, junto do fio
 * @param {boolean|null} p.canalLigado   `null` = a tela não perguntou; não vira `false`
 * @param {boolean} p.temDestinoDeAnotacao  há um campo de anotação ao lado (a aba da empresa)
 * @returns {Array<{acao:string, rotulo:string, pode:boolean, motivo:string|null, frase:string|null}>}
 */
export function acoesDisponiveis({ conversa, janela = null, canalLigado = null, temDestinoDeAnotacao = false } = {}) {
  const semEmpresa = !conversa?.portalClientId;
  const situacao = janela?.situacao ? String(janela.situacao) : null;
  // ⚠ TRÊS respostas: aberta, fechada, e "não sei". Janela ausente NÃO vira aberta — seria oferecer
  // um botão que o servidor recusa —, e também não vira "expirada", que afirmaria o que ninguém viu.
  const janelaAberta = situacao === "ABERTA" ? true : (situacao ? false : null);
  const canalDesligado = canalLigado === false;

  const acoes = [];

  // GUIA — template: a janela não a alcança.
  acoes.push(montar(ACAO.ENVIAR_GUIA, [
    semEmpresa ? MOTIVO.SEM_EMPRESA : null,
    canalDesligado ? MOTIVO.CANAL_DESLIGADO : null,
  ]));

  // DOCUMENTO — mensagem de serviço: exige a janela ABERTA, e "não sei" também bloqueia.
  acoes.push(montar(ACAO.ENVIAR_DOCUMENTO, [
    semEmpresa ? MOTIVO.SEM_EMPRESA : null,
    canalDesligado ? MOTIVO.CANAL_DESLIGADO : null,
    janelaAberta === false ? MOTIVO.FORA_DA_JANELA : null,
    janelaAberta === null ? MOTIVO.JANELA_DESCONHECIDA : null,
  ]));

  // ANOTAÇÃO — não fala com a Meta. Sem destino ela NÃO É OFERECIDA (não é "bloqueada").
  if (temDestinoDeAnotacao) acoes.push(montar(ACAO.VIRAR_ANOTACAO, []));

  return acoes;
}

function montar(acao, motivos) {
  const motivo = motivos.find(Boolean) || null;
  return {
    acao,
    rotulo: ROTULO_ACAO[acao],
    pode: !motivo,
    motivo,
    frase: motivo ? FRASE_MOTIVO[motivo] : null,
  };
}

/**
 * O RASCUNHO DA ANOTAÇÃO — texto para o contador EDITAR, nunca uma anotação gravada.
 *
 * ⚠⚠ "Virar anotação" não escreve nada sozinho: anotação é JUÍZO, não cópia. A mensagem já está
 * guardada para sempre no fio; o que vira anotação é o que o contador decide que importa. Por isso
 * isto devolve texto, e quem grava é o `POST /anotacoes` inalterado, depois de ele editar.
 */
export function rascunhoDeAnotacao(mensagem, { pessoa = null, fmtDataHora = null } = {}) {
  const corpo = String(mensagem?.corpo || "").trim();
  if (!corpo) return null;
  const quando = typeof fmtDataHora === "function"
    ? fmtDataHora(mensagem?.ocorridaEmProvedor || mensagem?.registradaEm)
    : null;
  const quem = String(pessoa || "").trim();
  // ⚠ Cada pedaço só entra se existir: sem data não se escreve uma data vazia, sem nome não se
  // atribui a fala a ninguém.
  const cabeca = [quando, quem ? `${quem} no WhatsApp` : "no WhatsApp"].filter(Boolean).join(" · ");
  return `${cabeca}: "${corpo}"`;
}
