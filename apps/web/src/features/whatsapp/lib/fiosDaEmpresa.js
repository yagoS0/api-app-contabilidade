// QUAL FIO ABRIR DENTRO DA EMPRESA — a regra, pura (F2, 06/09/2026).
//
// Uma empresa pode ter mais de um número falando com o escritório (o sócio e o financeiro, cada um
// no seu fio — é o desenho que substitui o grupo, e é melhor que ele: cada pessoa tem o próprio
// consentimento, a própria janela de 24 h e o próprio histórico).
//
// ⚠ TRÊS respostas com nome próprio, e a primeira NÃO é erro: empresa sem fio nenhum é o estado
// normal de quem nunca escreveu — quem abre a janela de 24 h é o cliente, então "vazio" aqui quer
// dizer "ninguém escreveu ainda", nunca "falhou".
//
// ⚠ O SELETOR SÓ EXISTE COM DOIS OU MAIS (decisão do dono). Com um fio só, um seletor de um item
// pergunta o que não tem alternativa.

export const ESCOLHA_DO_FIO = Object.freeze({
  VAZIO: "VAZIO",
  UNICO: "UNICO",
  ESCOLHER: "ESCOLHER",
});

export const FRASE_SEM_FIO = "Ninguém desta empresa escreveu por aqui ainda. Quem abre a conversa é o cliente — o escritório só pode responder dentro das 24h seguintes a uma mensagem dele.";

/**
 * @param {Array} conversas as conversas JÁ filtradas por empresa (o servidor faz isso com `?empresa`)
 * @returns {{situacao:string, fios:Array, unico:object|null}}
 */
export function escolhaDoFio(conversas) {
  const fios = Array.isArray(conversas) ? conversas.filter(Boolean) : [];
  if (fios.length === 0) return { situacao: ESCOLHA_DO_FIO.VAZIO, fios, unico: null };
  if (fios.length === 1) return { situacao: ESCOLHA_DO_FIO.UNICO, fios, unico: fios[0] };
  return { situacao: ESCOLHA_DO_FIO.ESCOLHER, fios, unico: null };
}

/**
 * Qual fio fica aberto: o escolhido, se ele ainda existe na lista; senão o primeiro.
 *
 * ⚠ Escolha que sumiu (o fio saiu do filtro, a lista recarregou) NÃO deixa a tela vazia nem
 * mantém um id morto — ela cai no primeiro, que é o mais recente. Vazio sem motivo é ausência
 * virando afirmação.
 */
export function fioAberto(conversas, escolhidoId) {
  const fios = Array.isArray(conversas) ? conversas.filter(Boolean) : [];
  if (!fios.length) return null;
  return fios.find((c) => c.id === escolhidoId) || fios[0];
}
