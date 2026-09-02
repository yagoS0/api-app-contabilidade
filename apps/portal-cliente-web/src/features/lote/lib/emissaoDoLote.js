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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A RETENTATIVA — E A ÚNICA FRASE QUE PODE FICAR NA TELA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Caso real, 21/08/2026: lote de 3 notas RECUSADO pela Receita por erro de esquema (`E1235`). O
// > erro do XML foi consertado e está em produção. O dono subiu a mesma planilha e a tela disse:
// > *"Esta planilha já havia sido emitida."* — com **Emitidas 0 · Recusadas 3**. A frase era FALSA,
// > e foi ela que o fez achar que o erro tinha voltado.
//
// ⚠⚠ A AUTORIDADE É O SERVIDOR — `apps/api/src/application/nfse/lote/emissaoLote.js`
// (`bloqueioDaRetentativa`/`planoDeRetentativa`). Isto aqui é ESPELHO, e o espelho é amarrado por
// teste que importa a função do backend e exige o mesmo veredito nos mesmos casos. Sem o amarre,
// "espelho" é intenção, não fato — e a divergência apareceria como *"a tela ofereceu e o servidor
// recusou"*, na tela que emite nota fiscal em série.
//
// ⚠⚠ **A TELA NÃO DECIDE O QUE SE REEMITE.** Ela pede a retentativa; quem escolhe as linhas é o
// `where` da reserva atômica, no servidor. Este módulo existe para a tela poder DIZER, antes do
// clique, quantas linhas serão tentadas e quantas não serão — e por quê.

/** ⚠⚠ ESPELHO da lista FECHADA do backend. Só o desfecho que PROVA que não existe nota. */
export const DESFECHOS_RETENTAVEIS = Object.freeze([
  DESFECHO.NAO_TENTADA,
  DESFECHO.RECUSADA_RECEITA,
  DESFECHO.RECUSADA_NOSSA,
]);

/** ⚠ ESPELHO dos motivos do backend — eles saem na tela, palavra por palavra. */
export const MOTIVO_NAO_RETENTAVEL = Object.freeze({
  [DESFECHO.EMITIDA]:
    "esta linha já virou nota fiscal — emitir de novo criaria uma nota duplicada",
  [DESFECHO.INDETERMINADA]:
    "não se sabe se a nota desta linha foi emitida, e tentar outra vez pode gerar uma nota duplicada",
  [DESFECHO.ENVIANDO]:
    "o envio desta linha não terminou, então o desfecho dela ainda é desconhecido",
});

const MOTIVO_DESFECHO_DESCONHECIDO =
  "esta linha está num estado que este sistema não reconhece, e o que não se reconhece não se retenta";

/** Por que esta linha NÃO pode ser retentada — `null` quando ela pode. */
export function bloqueioDaRetentativa(linha, lote = null) {
  const desfecho = linha?.desfecho;
  /**
   * ⚠⚠ ESPELHO do ramo de 31/08/2026: a linha cuja nota NÓS cancelamos volta a ser retentável —
   * reemitir depois de cancelar é o ciclo fiscal legítimo. `notaCancelada` chega do servidor
   * (`paraTela`), que a deriva de `ServiceInvoice.status === "cancelled"`; a tela nunca a inventa.
   */
  if (desfecho === DESFECHO.EMITIDA && linha?.notaCancelada === true) {
    if (Number.isInteger(lote?.linhaIndeterminada) && linha?.numeroLinha === lote.linhaIndeterminada) {
      return MOTIVO_NAO_RETENTAVEL[DESFECHO.INDETERMINADA];
    }
    return null;
  }
  if (!DESFECHOS_RETENTAVEIS.includes(desfecho)) {
    return MOTIVO_NAO_RETENTAVEL[desfecho] || MOTIVO_DESFECHO_DESCONHECIDO;
  }
  if (Number.isInteger(lote?.linhaIndeterminada) && linha?.numeroLinha === lote.linhaIndeterminada) {
    return MOTIVO_NAO_RETENTAVEL[DESFECHO.INDETERMINADA];
  }
  return null;
}

export function podeRetentar(linha, lote = null) {
  return bloqueioDaRetentativa(linha, lote) === null;
}

/** O que uma retentativa faria com este lote. Mesma forma do plano que o servidor devolve. */
export function planoDeRetentativa(lote) {
  const retentaveis = [];
  const bloqueadas = [];
  for (const linha of lote?.linhas || []) {
    const motivo = bloqueioDaRetentativa(linha, lote);
    if (motivo === null) {
      retentaveis.push({ numeroLinha: linha.numeroLinha, desfecho: linha.desfecho });
      continue;
    }
    bloqueadas.push({ numeroLinha: linha.numeroLinha, desfecho: linha.desfecho, motivo });
  }
  const conta = (d) => bloqueadas.filter((b) => b.desfecho === d).length;
  return {
    quantas: retentaveis.length,
    retentaveis,
    bloqueadas,
    emitidas: conta(DESFECHO.EMITIDA),
    indeterminadas: conta(DESFECHO.INDETERMINADA),
  };
}

/**
 * ⚠⚠ O CONVITE PARA RETENTAR — e a `ressalva` é a razão de ele existir.
 *
 * Molde da `ressalva` de `conviteParaRetomar`, e pelo MESMO motivo: quem lê "tentar de novo"
 * entende "refazer o lote". Aqui a pergunta que fica é *"e as que já saíram?"*.
 *
 * ⚠ O dono corta legenda com agressividade, e o critério dele é *"sai a frase que descreve uma
 * ausência visível; fica a que impede uma ausência de ser lida como afirmação"*. A frase que FICA
 * é a que impede alguém de achar que retentar reemite tudo — sem ela, o clique é dado com uma
 * expectativa errada num ato fiscal irreversível. **Sem nada bloqueado, não há ressalva nenhuma:
 * não existe mal-entendido a desfazer, e a frase sairia.**
 */
export function conviteParaRetentar(lote) {
  const plano = planoDeRetentativa(lote);
  if (!plano.quantas) return null;

  return {
    quantas: plano.quantas,
    naoSeraoTentadas: plano.bloqueadas.length,
    emitidas: plano.emitidas,
    indeterminadas: plano.indeterminadas,
    bloqueadas: plano.bloqueadas,
    rotuloDoBotao: `Tentar emitir ${plano.quantas} ${plano.quantas === 1 ? "nota" : "notas"} de novo`,
    /** ⚠ A frase que impede o mal-entendido caro. `null` quando não há nada a desfazer. */
    ressalva: plano.bloqueadas.length ? ressalvaDaRetentativa(plano) : null,
  };
}

function ressalvaDaRetentativa(plano) {
  const partes = [];
  if (plano.emitidas) {
    partes.push(
      `${plano.emitidas} ${plano.emitidas === 1 ? "já virou nota fiscal e NÃO será emitida" : "já viraram nota fiscal e NÃO serão emitidas"} de novo`
    );
  }
  if (plano.indeterminadas) {
    partes.push(
      `${plano.indeterminadas} ${plano.indeterminadas === 1 ? "está" : "estão"} com desfecho desconhecido e não ${plano.indeterminadas === 1 ? "será tentada" : "serão tentadas"}`
    );
  }
  // ⚠ O resto (estado que esta tela não conhece) entra pela contagem, nunca some da frase.
  const nomeadas = plano.emitidas + plano.indeterminadas;
  if (plano.bloqueadas.length > nomeadas) {
    const outras = plano.bloqueadas.length - nomeadas;
    partes.push(`${outras} ${outras === 1 ? "não pôde" : "não puderam"} ser ${outras === 1 ? "tentada" : "tentadas"}`);
  }

  return (
    `Só as ${plano.quantas === 1 ? "1 linha" : `${plano.quantas} linhas`} que não geraram nota `
    + `${plano.quantas === 1 ? "será tentada" : "serão tentadas"} de novo: `
    + `${partes.join("; ")}. Emitir uma nota que já existe não se desfaz — cancela-se, e cancelar é outro ato.`
  );
}

/**
 * ⚠⚠ O QUE DE FATO ACONTECEU DA PRIMEIRA VEZ — a frase que substituiu a mentira.
 *
 * A anterior era *"Esta planilha já havia sido emitida"*, cravada, sem olhar desfecho nenhum. Num
 * lote com **0 emitidas e 3 recusadas** ela afirmava o oposto do fato, e mandava a pessoa procurar
 * um erro que não existia.
 *
 * ⚠ Ela é DERIVADA das linhas — se um dia o relatório e a frase discordarem, é porque alguém
 * escreveu um texto fixo aqui de novo.
 */
export function textoDoReconhecimento(lote) {
  const r = resumoDaEmissao(lote);
  if (!r.total) return "Esta planilha já foi enviada antes. Abaixo está o que aconteceu naquela vez.";

  if (r.emitidas === 0) {
    return (
      "Esta planilha já foi enviada antes, e naquela vez NENHUMA nota foi emitida. "
      + "Abaixo está o que aconteceu com cada linha — nada foi emitido agora."
    );
  }
  if (r.emitidas === r.total) {
    return (
      `Esta planilha já foi enviada antes, e as ${r.total} notas foram emitidas. `
      + "Abaixo está o que aconteceu naquela vez — nenhuma nota nova foi emitida agora."
    );
  }
  return (
    `Esta planilha já foi enviada antes: ${r.emitidas} de ${r.total} `
    + `${r.emitidas === 1 ? "linha virou nota" : "linhas viraram nota"}. `
    + "Abaixo está o que aconteceu com cada uma — nenhuma nota nova foi emitida agora."
  );
}
