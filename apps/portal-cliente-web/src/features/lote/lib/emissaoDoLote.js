// AS REGRAS DE TELA DA EMISSÃO EM LOTE — o que dizer sobre cada desfecho, e o que NUNCA oferecer.
//
// ⚠⚠ A TELA NÃO DECIDE NADA SOBRE A EMISSÃO. Quem escolhe o que emitir é o servidor, que
// reclassifica a planilha inteira; quem para o lote é o servidor; quem sabe qual linha ficou
// indeterminada é o servidor. Este módulo traduz o relatório em texto e em botões — e a parte mais
// importante dele é o que ele **se recusa a oferecer**.
//
// ⚠ ESPELHO do vocabulário de `apps/api/src/application/nfse/lote/emissaoLote.js` (`DESFECHO_LINHA`)
// e de `desfechoEmissao.js` (as três camadas). Mudou lá, muda aqui.

/** Os desfechos de linha que o servidor sabe produzir. Lista FECHADA. */
export const DESFECHO = Object.freeze({
  NAO_TENTADA: "nao_tentada",
  ENVIANDO: "enviando",
  EMITIDA: "emitida",
  RECUSADA_RECEITA: "recusada_receita",
  RECUSADA_NOSSA: "recusada_nossa",
  INDETERMINADA: "indeterminada",
});

export const STATUS_LOTE = Object.freeze({
  EMITINDO: "emitindo",
  CONCLUIDO: "concluido",
  PARADO_INDETERMINADO: "parado_indeterminado",
  ERRO: "erro",
});

/**
 * Como cada desfecho aparece na linha.
 *
 * ⚠ `chip` usa o vocabulário JÁ EXISTENTE de `data-status` (`styles/app.css:113`), e não um nome
 * novo: `Chip` recebe `status`, e um valor fora dessa lista renderiza **sem cor nenhuma**,
 * silenciosamente. Foi o que aconteceu na primeira escrita deste módulo, com um `tom` inventado.
 *
 * ⚠⚠ `indeterminada` NÃO é "falhou", e a distinção é a razão deste mapa existir. "Falhou" faz a
 * pessoa querer tentar de novo — e tentar de novo é exatamente o que duplica nota fiscal quando o
 * desfecho é desconhecido. O texto diz o que se sabe: **não se sabe**.
 *
 * ⚠ `nao_tentada` também não é falha: ninguém encostou naquela linha. Pintá-la de erro faria o
 * relatório acusar 40 problemas onde há um.
 */
const TEXTOS = {
  [DESFECHO.EMITIDA]: { rotulo: "Emitida", chip: "emitida" },
  [DESFECHO.RECUSADA_RECEITA]: { rotulo: "Recusada pela Receita", chip: "rejeitada" },
  [DESFECHO.RECUSADA_NOSSA]: { rotulo: "Não enviada", chip: "rejeitada" },
  // ⚠⚠ ÂMBAR, NUNCA VERMELHO. Vermelho se lê como "falhou", e "falhou" convida a tentar de novo —
  // que é exatamente o que duplica nota fiscal quando o desfecho é desconhecido.
  [DESFECHO.INDETERMINADA]: { rotulo: "Desfecho desconhecido", chip: "rascunho" },
  [DESFECHO.ENVIANDO]: { rotulo: "Enviando…", chip: "processando" },
  // ⚠ Cinza: ninguém encostou nesta linha. Pintá-la de erro faria o relatório acusar 40 problemas
  // onde há um.
  [DESFECHO.NAO_TENTADA]: { rotulo: "Não tentada", chip: "cancelada" },
};

export function textoDoDesfecho(desfecho) {
  return (
    TEXTOS[desfecho] || {
      // ⚠ Desfecho que esta tela não conhece sai NOMEADO, nunca silencioso e nunca como "ok": um
      // estado novo no backend não pode ser lido como sucesso por omissão.
      rotulo: `Estado desconhecido (${String(desfecho ?? "—")})`,
      chip: "rejeitada",
    }
  );
}

/**
 * ⚠⚠ O QUE A LINHA INDETERMINADA EXIGE QUE A TELA DIGA.
 *
 * Ela é o pior estado possível deste sistema: pode existir uma nota fiscal no mundo e ninguém sabe.
 * A tela não pode resolver isso — só pode dizer com precisão o que aconteceu e quem decide.
 */
export function avisoDaLinhaIndeterminada(lote) {
  if (!lote || !Number.isInteger(lote.linhaIndeterminada)) return null;
  const linha = lote.linhas?.find((l) => l.numeroLinha === lote.linhaIndeterminada) || null;
  return {
    numeroLinha: lote.linhaIndeterminada,
    tomadorNome: linha?.tomadorNome || null,
    /** ⚠ O número reservado. Não existe inutilização na NFS-e: se ele não virou nota, é buraco permanente. */
    rpsSerie: linha?.rpsSerie || null,
    rpsNumero: linha?.rpsNumero || null,
    motivo: lote.paradoMotivo || null,
    correcao: linha?.correcao || null,
  };
}

/**
 * ⚠⚠ RETOMAR NUNCA REPROCESSA A LINHA INDETERMINADA — e a tela precisa DIZER isso antes do clique.
 *
 * Quem lê "retomar" entende "continuar de onde parou", e a pergunta que fica é justamente "e aquela
 * linha?". Deixar isso implícito faria a pessoa clicar achando que a nota duvidosa vai ser
 * resolvida — e ela não vai, nem deve: quem decide sobre ela é o contador, olhando o portal
 * nacional.
 */
export function conviteParaRetomar(lote) {
  if (!lote || lote.status !== STATUS_LOTE.PARADO_INDETERMINADO) return null;
  const restantes = (lote.linhas || []).filter(
    (l) => l.desfecho === DESFECHO.NAO_TENTADA && l.numeroLinha > (lote.linhaIndeterminada ?? -Infinity)
  );
  if (!restantes.length) return null;
  return {
    quantas: restantes.length,
    primeiraLinha: restantes[0].numeroLinha,
    /** ⚠ A frase que impede o mal-entendido caro. */
    ressalva:
      `A linha ${lote.linhaIndeterminada} NÃO será tentada de novo — não se sabe se a nota dela foi `
      + "emitida, e tentar outra vez pode gerar uma nota duplicada. Ela continua aguardando a sua "
      + "conferência no portal nacional.",
  };
}

/**
 * O resumo do relatório, recontado a partir das LINHAS.
 *
 * ⚠ Recontar na tela, e não confiar nos totais do lote, é a mesma disciplina já aplicada à
 * conferência: se um desfecho novo aparecer, ele entra em `outras` por construção em vez de sumir
 * da conta. Um total que não fecha com as linhas é pior que nenhum total.
 */
export function resumoDaEmissao(lote) {
  const linhas = lote?.linhas || [];
  const conta = (d) => linhas.filter((l) => l.desfecho === d).length;
  const emitidas = conta(DESFECHO.EMITIDA);
  const recusadas = conta(DESFECHO.RECUSADA_RECEITA) + conta(DESFECHO.RECUSADA_NOSSA);
  const indeterminadas = conta(DESFECHO.INDETERMINADA);
  const naoTentadas = conta(DESFECHO.NAO_TENTADA);
  const enviando = conta(DESFECHO.ENVIANDO);
  return {
    total: linhas.length,
    emitidas,
    recusadas,
    indeterminadas,
    naoTentadas,
    enviando,
    outras: linhas.length - emitidas - recusadas - indeterminadas - naoTentadas - enviando,
  };
}

/** O lote ainda está correndo? É o que mantém o polling vivo. */
export function aindaCorrendo(lote) {
  return lote?.status === STATUS_LOTE.EMITINDO;
}

/**
 * ⚠⚠ O TEXTO DA CONFIRMAÇÃO — um bloco só, com os três números que importam.
 *
 * Decisão registrada: a confirmação é a TELA DE CONFERÊNCIA, que já mostra linha a linha. O botão
 * final confirma o que ela já mostra — quantas, o total e que é irreversível. Repetir 50 blocos de
 * confirmação não protege ninguém: aprende-se a clicar sem ler, e confirmação que ninguém lê é pior
 * que nenhuma.
 */
export function confirmacaoDaEmissao({ prontas, valorTotal }) {
  return {
    quantas: prontas,
    valorTotal,
    titulo: `Emitir ${prontas} ${prontas === 1 ? "nota" : "notas"}?`,
    aviso:
      "A emissão é definitiva: nota fiscal emitida não se apaga, só se cancela — e cancelar é outro "
      + "ato. Só as linhas prontas são emitidas; as demais ficam como estão.",
  };
}

/** A soma das linhas prontas, para a confirmação. Ignora o que não for número. */
export function somarValorDasProntas(linhas) {
  return (linhas || [])
    .filter((l) => l.estado === "pronta")
    .reduce((total, l) => {
      const v = Number(l?.dados?.servico?.valorServicos);
      return Number.isFinite(v) ? total + v : total;
    }, 0);
}
