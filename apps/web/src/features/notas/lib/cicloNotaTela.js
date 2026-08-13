// A LEITURA DE TELA DO CICLO DA NOTA — uma só, para a lista e para o detalhe.
//
// ⚠ POR QUE ISTO É UM MÓDULO
//
// A regra de NEGÓCIO (cancelada × substituída × substituta × "não temos o evento") vive no
// backend, em `application/notas/cicloNota.js`, e é ele que compõe o objeto `ciclo` que chega
// pronto na resposta. Este arquivo NÃO a reimplementa: ele traduz esse objeto para o que a tela
// precisa (rótulo, token de cor, o que dizer quando falta dado).
//
// Ela virou módulo porque estava embutida no `NotasList.jsx` e o `NotaDetailModal.jsx` não a lia:
// a lista dizia "substituída" em âmbar e o detalhe da MESMA nota dizia "cancelada" em vermelho.
// Duas leituras do mesmo ciclo divergem — foi assim que as duas telas chegaram a discordar.
//
// ⚠ ISTO NÃO DECIDE DINHEIRO. `statusEfetivo` continua sendo o único campo que a apuração lê, e
// continua tendo dois valores (`autorizada`/`cancelada`). O que está aqui é LEITURA: nomear o que
// aconteceu com a nota, sem mexer em quanto ela vale.

// ⚠ ESTE MAPA JÁ EXISTIU MORTO, EM DUAS CÓPIAS, E É POR ISSO QUE ELE MORA AQUI AGORA.
//
// O `NotaDetailModal` tinha uma entrada `substituida` alimentada por `nota.statusEfetivo` — e
// `statusEfetivo` NUNCA vale "substituida": são só `autorizada` e `cancelada` (zero linhas em
// produção com outro valor, e o próprio schema documenta que gravá-lo quebraria os filtros de
// dinheiro, que exigem `=== "autorizada"`). Ou seja, a cor âmbar do detalhe nunca acendeu uma vez
// sequer. Quem alimenta este mapa é `ciclo.situacao`, que é derivado do EVENTO e do VÍNCULO — não
// o repontar para `statusEfetivo` de novo.
export const SITUACAO_TOKEN = {
  autorizada: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  cancelada: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
  // Substituída pede leitura, não é erro nem conclusão: a nota foi TROCADA por outra e o valor
  // dela migrou. Âmbar é pendência, e conferir a troca é justamente uma pendência.
  substituida: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  rejeitada: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
};

const NEUTRO = { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" };

export const TEXTO_SEM_EVENTO =
  "Não guardamos o evento desta nota (data e motivo). Isso não quer dizer que não houve evento.";

// A referência a uma nota do outro lado do vínculo, na MESMA forma que `cicloNota.js` devolve
// (`{ notaId, numero, chaveAcesso, naBase }`). `naBase: false` é resposta — quer dizer "o vínculo é
// real, a outra nota é que não foi capturada" —, nunca motivo para sumir com o vínculo da tela.
function referencia(ref, chaveCrua) {
  if (ref && (ref.notaId || ref.chaveAcesso || ref.numero)) {
    return {
      notaId: ref.notaId ?? null,
      numero: ref.numero ?? null,
      chaveAcesso: ref.chaveAcesso ?? null,
      naBase: Boolean(ref.naBase ?? ref.notaId),
    };
  }
  if (chaveCrua) return { notaId: null, numero: null, chaveAcesso: chaveCrua, naBase: false };
  return null;
}

/**
 * Traduz uma nota (de lista OU da íntegra) na leitura de ciclo que a tela mostra.
 *
 * @param {Object|null} nota  linha da lista ou nota da rota de detalhe; `ciclo` vem pronto do
 *                            backend quando a API é recente.
 * @returns {{
 *   situacao: string|null, rotulo: string, conhecida: boolean,
 *   cor: string, fundo: string, semEvento: boolean, ehSubstituta: boolean,
 *   substitui: Object|null, substituidaPor: Object|null,
 *   motivoSubstituicao: string|null, evento: Object|null,
 *   avisos: Array<{codigo: string, texto: string}>,
 *   temCicloDoServidor: boolean, tituloAjuda: string|undefined,
 * }}
 */
export function lerCicloDaNota(nota) {
  const ciclo = nota?.ciclo || null;

  // `ciclo.situacao` NOMEIA o que aconteceu; `statusEfetivo` só diz se conta ou não conta.
  // Preferir o primeiro é o que faz "substituída" aparecer como substituída em vez de "cancelada".
  const bruto = ciclo?.situacao || nota?.statusEfetivo || nota?.status || null;
  const situacao = bruto == null ? null : String(bruto).toLowerCase();
  const token = (situacao && SITUACAO_TOKEN[situacao]) || NEUTRO;
  const conhecida = Boolean(situacao && SITUACAO_TOKEN[situacao]);

  // ⚠ "Não temos o evento" ≠ "não houve evento". É o estado de 556 canceladas em produção, e é o
  // quarto estado do ciclo — o mais fácil de perder, porque ausência não desenha nada sozinha.
  const semEvento = Boolean(ciclo) && ciclo.eventoRegistrado === false && situacao !== "autorizada";

  // Sem `ciclo` (API antiga), o único vínculo que a linha carrega é a coluna `chaveSubstituida`:
  // "esta nota substitui aquela". Dá para dizer isso, e não dá para dizer mais nada — em especial,
  // NÃO se deriva situação aqui. Quem deriva é o backend; duas derivações divergiriam.
  const substitui = referencia(ciclo?.substitui, nota?.chaveSubstituida || null);
  const substituidaPor = referencia(ciclo?.substituidaPor, null);
  const ehSubstituta = Boolean(ciclo ? ciclo.ehSubstituta : nota?.chaveSubstituida);

  // ⚠ O MOTIVO ESTÁ EM LUGARES DIFERENTES NOS DOIS LADOS DO VÍNCULO, e é o mesmo motivo:
  //   • na SUBSTITUTA ele vem do XML dela (`motivoSubstituicao`, coluna de `PortalInvoice`);
  //   • na SUBSTITUÍDA ele só existe no EVENTO (`PortalInvoiceEvent.reason`, que é o `xMotivo`
  //     declarado no evento de cancelamento por substituição — ver `applyNfseEvento`).
  // Sem esta segunda fonte, a nota substituída dizia "Motivo: não temos este dado" com o motivo
  // impresso na linha do evento logo abaixo — a tela se contradizendo dentro do mesmo bloco.
  const evento = ciclo?.evento || null;
  const motivoSubstituicao = ciclo?.motivoSubstituicao
    || nota?.motivoSubstituicao
    || (evento?.tipo === "canc_por_substituicao" ? evento.motivo : null)
    || null;

  const tituloAjuda = !conhecida
    ? `Situação não reconhecida (${situacao ?? "sem valor"}) — não presuma que está autorizada.`
    : semEvento ? TEXTO_SEM_EVENTO : undefined;

  return {
    situacao,
    rotulo: situacao ?? "situação não registrada",
    conhecida,
    cor: token.cor,
    fundo: token.fundo,
    semEvento,
    ehSubstituta,
    substitui,
    substituidaPor,
    motivoSubstituicao,
    evento,
    avisos: Array.isArray(ciclo?.avisos) ? ciclo.avisos : [],
    temCicloDoServidor: Boolean(ciclo),
    tituloAjuda,
  };
}

/**
 * "Esta nota teve alguma história além de existir?" — decide se o bloco de ciclo tem o que contar
 * ou se a resposta é o silêncio NOMEADO ("não foi cancelada nem substituída").
 */
export function temHistoria(leitura, eventos = []) {
  return Boolean(
    (leitura.situacao && leitura.situacao !== "autorizada")
    || leitura.ehSubstituta
    || leitura.substitui
    || leitura.substituidaPor
    || leitura.avisos.length
    || (Array.isArray(eventos) && eventos.length),
  );
}
