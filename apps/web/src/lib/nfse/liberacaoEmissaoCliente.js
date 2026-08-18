// A REGRA DE TELA DO PORTÃO DA EMISSÃO PELO CLIENTE.
//
// Decisão do dono (18/08/2026): *"o acesso a emissão deve ser liberado para o cliente pelo portal
// do contador"*. O backend guarda a chave em `PortalClient.emissaoClienteLiberada` e a exige, junto
// do papel mínimo `CLIENT_ADMIN`, nos DOIS atos fiscais (emitir e cancelar).
//
// Aqui mora só o que a TELA precisa decidir: o que mostrar, e com que palavras confirmar. A regra
// que autoriza continua no servidor — esta camada não pode prometer um desfecho diferente.

/**
 * Os papéis que passam a emitir quando o portão é ligado. ⚠ É o espelho de `PAPEL_MINIMO_EMISSAO`
 * (`apps/api/src/application/nfse/emissaoClienteAutorizacao.js`) traduzido em nomes; mudou lá, muda
 * aqui — senão a confirmação promete uma coisa e o servidor faz outra.
 */
export const PAPEIS_QUE_PASSAM = ["CLIENT_ADMIN", "OWNER"];

/** O papel que NÃO passa nem com a empresa liberada. Nomeá-lo é o que evita a surpresa. */
export const PAPEIS_QUE_NAO_PASSAM = ["FINANCEIRO"];

export const TITULO = "Emissão pelo cliente";

/**
 * ⚠ LIGAR É ATO DE CONSEQUÊNCIA: a confirmação REPETE o que vai acontecer, em vez de perguntar
 * "tem certeza?". A frase diz os três fatos que importam: quem passa a emitir, em que ambiente, e
 * em nome de quem.
 */
export function fraseDeConfirmacao(razaoSocial) {
  const nome = String(razaoSocial || "").trim();
  return [
    `Os usuários ${PAPEIS_QUE_PASSAM.join(" e ")} ${nome ? `de ${nome}` : "desta empresa"} passarão a emitir`,
    "NFS-e em produção, em nome dela — e também a cancelar as notas já emitidas.",
  ].join(" ");
}

function formatarData(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Lê o bloco `emissaoCliente` do payload da empresa.
 *
 * ⚠ TRÊS ESTADOS, NÃO DOIS. `emissaoCliente` ausente quer dizer **"esta tela não recebeu o
 * estado"** (empresa nova, payload antigo, chamada que falhou) — e isso NÃO é "não liberada".
 * Desenhar as duas iguais faria o contador achar que alguém revogou a liberação dele.
 *
 * @returns {{conhecida: boolean, liberada: boolean, quem: string|null, quando: string|null, resumo: string}}
 */
export function lerLiberacaoEmissao(emissaoCliente) {
  if (!emissaoCliente || typeof emissaoCliente !== "object") {
    return {
      conhecida: false,
      liberada: false,
      quem: null,
      quando: null,
      resumo: "Esta tela não recebeu o estado da liberação.",
    };
  }
  const liberada = emissaoCliente.liberada === true;
  // ⚠ O NOME quando existe, o id quando não: usuário apagado não vira "ninguém". Sumir com o autor
  // faria a liberação parecer ter acontecido sozinha.
  const quem = liberada
    ? String(emissaoCliente.liberadaPorNome || emissaoCliente.liberadaPor || "").trim() || null
    : null;
  const quando = liberada ? formatarData(emissaoCliente.liberadaEm) : null;
  return {
    conhecida: true,
    liberada,
    quem,
    quando,
    resumo: liberada
      ? `${PAPEIS_QUE_PASSAM.join(" e ")} desta empresa podem emitir e cancelar NFS-e.`
      : "Só o escritório emite e cancela NFS-e por esta empresa.",
  };
}

/**
 * A linha "liberado por Fulano em 17/08/2026 13:40" — com as ausências ditas, nunca escondidas.
 * Quem liberou pode ser desconhecido (usuário apagado) sem que a liberação deixe de existir.
 */
export function linhaDeAutoria({ quem, quando }) {
  if (!quem && !quando) return "Liberada — não há registro de quem liberou nem de quando.";
  if (!quem) return `Liberada em ${quando} — sem registro de quem liberou.`;
  if (!quando) return `Liberada por ${quem} — sem registro da data.`;
  return `Liberada por ${quem} em ${quando}.`;
}
