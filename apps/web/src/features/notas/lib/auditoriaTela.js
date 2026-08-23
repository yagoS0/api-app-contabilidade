import { ONDE_CONFIGURA_EMISSAO } from "../../../lib/nfse/cadastroEmissaoNfse";

// A LEITURA DE TELA DA AUDITORIA — como cada resposta do backend vira frase, cor e ordem.
//
// ⚠ A REGRA NÃO MORA AQUI. Quem decide o que é achado é `application/notas/auditoria/auditoriaNotas.js`
// (puro, no backend), e o texto de cada PERGUNTA (`titulo`, `pergunta`, `achado`) desce pronto de
// lá — de propósito: se a frase fosse escrita no componente, a próxima tela a consumir a mesma rota
// escreveria a sua, e uma das duas diria "nota errada". Este módulo traduz só o que é de tela: o
// motivo em português, o token de cor e a ordem de exibição.
//
// ── ⚠ ZERO ACHADOS E "NÃO DÁ PARA CONFERIR" TÊM DESENHOS DIFERENTES ─────────────────────────────
//
// É a razão de este arquivo existir. As duas respostas voltam com `achados: []`, e desenhá-las
// igual faria a tela dizer "nada a apontar" sobre uma empresa cujo cadastro está vazio — uma
// afirmação fiscal sobre um critério que não existe. Medido em produção (17/08/2026): **33 de 33
// empresas** sem nenhum código de serviço cadastrado, ou seja, hoje TODA empresa cai nesse caso.
//
//   `CONFERIDA` + 0 achados  → `--state-ok`      · "nada a apontar" · ✓
//   `NAO_CONFERIVEL`         → `--state-neutral` · a frase do motivo · ○
//   `CONFERIDA` + N achados  → `--state-warn`    · N pergunta(s) a responder · ⚠
//
// ⚠ **NUNCA `--state-danger`.** Vermelho, no vocabulário deste projeto, é o que **bloqueia o
// fechamento** (`apps/web/CLAUDE.md`). Achado de auditoria não bloqueia nada — é pergunta para o
// contador. Pintá-lo de vermelho faria a cor que trava o mês competir com a cor que só pergunta,
// e quando quase tudo é vermelho nada se destaca.

/** O motivo de "não deu para conferir", em português — e sempre dizendo O QUE FAZER. */
export const FRASE_NAO_CONFERIVEL = Object.freeze({
  // ⚠ Não é "todas as notas estão erradas". É "falta o critério".
  EMPRESA_SEM_CODIGOS_CADASTRADOS:
    `Não dá para conferir: a empresa não tem código de serviço cadastrado. Cadastre os códigos em ${ONDE_CONFIGURA_EMISSAO}.`,
  SEM_NOTAS: "Não há nota emitida nesta competência para conferir.",
  NENHUMA_NOTA_AVALIAVEL: "Nenhuma nota desta competência tem o campo que esta pergunta lê.",
});

/** Por que UMA nota ficou de fora de uma pergunta que foi respondida. */
export const FRASE_NOTA_NAO_AVALIADA = Object.freeze({
  SEM_CODIGO_DE_SERVICO: "o código de serviço não foi extraído do XML",
  SEM_DATA_DE_EMISSAO: "a nota não tem data de emissão",
  SEM_COMPETENCIA: "a nota não tem competência",
  SEM_ISSQN_NO_XML: "o XML não traz ISSQN (imune, isenta ou retida na fonte)",
  // ⚠ Os três motivos da DPS (`SEM_NUMERO_DE_DPS`, `SEM_SERIE_DE_DPS`,
  // `NUMERO_DE_DPS_NAO_NUMERICO`) saíram em 21/08/2026 com a pergunta de numeração — ver
  // `FRASE_ESPECIE` logo abaixo. O backend também não os emite mais.
});

/**
 * Por que uma nota fica de fora de TODA a conferência mensal — não de uma pergunta, de todas.
 *
 * ⚠ A frase diz o que É, não o que está errado: uma nota sem competência gravada não pertence a mês
 * nenhum, então não entra em conferência nenhuma **nem em apuração nenhuma**. A segunda metade é a
 * que faz o contador agir; sem ela isto pareceria detalhe técnico da nossa importação.
 */
export const FRASE_FORA_DA_CONFERENCIA = Object.freeze({
  SEM_COMPETENCIA_GRAVADA:
    "não têm competência gravada — não entram nesta nem em nenhuma outra conferência mensal, e por isso também não entram em apuração",
});

/** O motivo de uma pendência pós-fechamento (`PendenciaPosFechamento.motivo`), em português. */
export const FRASE_MOTIVO_PENDENCIA = Object.freeze({
  nota_retroativa: "chegou uma nota para uma competência que já estava fechada",
  evento_retroativo: "chegou um evento (cancelamento/substituição) de competência já fechada",
});

/** A espécie de cada achado, em uma linha. */
export const FRASE_ESPECIE = Object.freeze({
  ALIQUOTA_SEM_VALOR: "há alíquota de ISSQN e o valor do imposto saiu zerado",
  BASE_SEM_VALOR: "há base de cálculo de ISSQN e o valor do imposto saiu zerado",
  // ⚠⚠ `NUMERO_REPETIDO` e `NUMERO_PULADO` SAÍRAM EM 21/08/2026, com a pergunta inteira de numeração
  // da DPS, por decisão do dono e com a fonte conferida: a regra **E0014** (ANEXO_I, aba
  // `RN DPS_NFS-e`, linha 148) define a unicidade da DPS por QUATRO componentes (Série + Número +
  // Município Emissor + CNPJ/CPF), e **não existe, nas 653 regras do ANEXO_I, nenhuma que exija
  // numeração CONTÍNUA da DPS** — o único campo com regra de sequência é o `nNFSe`, gerado pela
  // Receita. Os 54 "buracos" que a tela mostrava mediam a NOSSA captura, não a empresa.
  //
  // ⚠ `LEITURA_FALHOU` e `NUNCA_EXTRAIDA` também saíram DESTA TELA, por outro motivo: a pergunta
  // "nota que não pôde ser lida" é manutenção do sistema (o extrator é nosso), não pergunta de
  // contador. Ela continua sendo calculada e sobe em `auditoria.manutencao` — o que não existe mais
  // é bloco para ela na tela. Nada se esconde da conferência: a nota ilegível continua aparecendo
  // em `naoAvaliadas` das perguntas que dependem do campo que faltou, com o motivo.
});

export const TOKEN = Object.freeze({
  OK: "--state-ok",
  ATENCAO: "--state-warn",
  NEUTRO: "--state-neutral",
});

/**
 * Como UMA pergunta se desenha.
 *
 * @param {Object} p a pergunta como o backend a devolveu
 * @returns {{estado, token, icone, resumo, detalhe, quantidade}}
 */
export function leituraDaPergunta(p) {
  const achados = Array.isArray(p?.achados) ? p.achados : [];
  const naoAvaliadas = Array.isArray(p?.naoAvaliadas) ? p.naoAvaliadas : [];

  if (p?.situacao === "NAO_CONFERIVEL") {
    return {
      estado: "NAO_CONFERIVEL",
      token: TOKEN.NEUTRO,
      icone: "○",
      // ⚠ Motivo desconhecido NÃO vira "nada a apontar" — vira o código cru, que é feio e honesto.
      resumo: FRASE_NAO_CONFERIVEL[p?.motivo] || `Não deu para conferir (${p?.motivo || "motivo não informado"}).`,
      detalhe: null,
      quantidade: 0,
    };
  }

  if (!achados.length) {
    return {
      estado: "SEM_ACHADO",
      token: TOKEN.OK,
      icone: "✓",
      resumo: `Nada a apontar em ${p?.avaliadas ?? 0} nota(s) conferida(s).`,
      detalhe: naoAvaliadas.length ? `${naoAvaliadas.length} nota(s) fora desta conferência — veja o motivo de cada uma.` : null,
      quantidade: 0,
    };
  }

  return {
    estado: "COM_ACHADO",
    token: TOKEN.ATENCAO,
    icone: "⚠",
    // ⚠ "a responder", nunca "erro(s)". Quem julga é o contador.
    resumo: `${achados.length} ${achados.length === 1 ? "ponto a conferir" : "pontos a conferir"} em ${p?.avaliadas ?? 0} nota(s).`,
    detalhe: naoAvaliadas.length ? `${naoAvaliadas.length} nota(s) fora desta conferência — veja o motivo de cada uma.` : null,
    quantidade: achados.length,
  };
}

/** A frase de UMA linha de achado. Nunca conclusiva. */
export function frasesDoAchado(achado, pergunta) {
  const dados = achado?.dados || {};
  const especie = dados.especie ? FRASE_ESPECIE[dados.especie] : null;
  const base = especie || pergunta?.achado || "há um ponto a conferir nesta nota";

  if (pergunta?.id === "ATIVIDADE_FORA_DO_CADASTRO") {
    return {
      titulo: `Código ${dados.cTribNac}${dados.descricaoNaNota ? ` — ${dados.descricaoNaNota}` : ""}`,
      texto: `${base}. Cadastrados: ${(dados.cadastrados || []).join(", ") || "nenhum"}.`,
    };
  }
  if (pergunta?.id === "EMISSAO_FORA_DA_COMPETENCIA") {
    const meses = dados.mesesDeDesvio;
    // ⚠ O desvio ANDA JUNTO porque é ele que diz o TAMANHO do problema — dois meses e cinco meses
    // pedem conversas diferentes com o cliente. A virada de mês (um mês) não chega mais até aqui:
    // desde 21/08/2026 ela é uma contagem no bloco, não uma linha (ver `frasesDaViradaDeMes`).
    const quanto = meses == null ? "" : ` (${Math.abs(meses)} ${Math.abs(meses) === 1 ? "mês" : "meses"} de diferença)`;
    return {
      titulo: `Competência ${dados.mesDaCompetencia} · emitida em ${dados.mesDaEmissao}`,
      texto: `${base}${quanto}.`,
    };
  }
  return { titulo: achado?.numero ? `Nota ${achado.numero}` : "Nota", texto: `${base}.` };
}

/**
 * A LINHA DA VIRADA DE MÊS — as notas que a pergunta 2 olhou, achou diferentes, e resumiu.
 *
 * ⚠ ELA É OBRIGATÓRIA QUANDO O NÚMERO É MAIOR QUE ZERO. Medido em produção: **1.727 das 1.738**
 * divergências de competência eram de exatamente um mês — o serviço prestado em julho, faturado em
 * 1º de agosto, com `dCompet` de julho. Listá-las uma a uma afogava as 11 que mereciam olhar, e foi
 * por isso que elas viraram contagem. Mas a aba promete "nada some em silêncio": sem esta linha, a
 * pergunta passaria a esconder 1.727 notas que ela de fato conferiu.
 *
 * @returns {string|null} `null` quando não há nenhuma — não se escreve "0 notas".
 */
export function fraseDaViradaDeMes(pergunta) {
  const n = Number(pergunta?.viradaDeMes || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n} nota(s) com um mês de diferença não estão listadas: é a virada normal de mês `
    + "(serviço prestado num mês, nota emitida no começo do seguinte). "
    + "Esta pergunta lista a partir de dois meses de diferença.";
}

/**
 * A LINHA DAS NOTAS QUE A CONFERÊNCIA MENSAL NÃO ALCANÇA.
 *
 * ⚠ Ela existe porque, até 21/08/2026, essa nota **não aparecia em lugar nenhum**: a consulta
 * filtrava por competência e `NULL` não satisfaz um intervalo, então a regra nunca soube que ela
 * existia — nem para colocá-la em "notas fora desta conferência". A aba dizia "nada some em
 * silêncio" enquanto sumia com ela.
 *
 * @returns {{resumo:string, token:string, icone:string}|null} `null` quando não há nenhuma.
 */
export function leituraDoForaDaConferencia(fora) {
  const total = Number(fora?.total || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const porque = FRASE_FORA_DA_CONFERENCIA[fora?.motivo]
    || `ficaram fora desta conferência (${fora?.motivo || "motivo não informado"})`;
  return {
    // ⚠ ÂMBAR, nunca vermelho: é pendência, e vermelho neste projeto trava fechamento.
    token: TOKEN.ATENCAO,
    icone: "⚠",
    resumo: `${total} nota(s) desta empresa ${porque}.`,
  };
}

/**
 * A leitura do CABEÇALHO — e ela distingue os três casos que a contagem sozinha confunde.
 *
 * ⚠ "0 achados" com perguntas não conferíveis NÃO é "mês conferido". O cabeçalho é o primeiro (e às
 * vezes o único) lugar que o contador lê; dizer "tudo certo" ali apagaria o cadastro vazio de toda
 * a carteira, que é o estado real de hoje.
 */
export function leituraDoCabecalho(auditoria) {
  const perguntas = Array.isArray(auditoria?.perguntas) ? auditoria.perguntas : [];
  const achados = Number(auditoria?.totalAchados || 0);
  const naoConferiveis = perguntas.filter((p) => p.situacao === "NAO_CONFERIVEL").length;
  const conferidas = perguntas.length - naoConferiveis;

  if (!perguntas.length) {
    return { token: TOKEN.NEUTRO, icone: "○", titulo: "Auditoria não carregada", texto: "" };
  }
  if (achados > 0) {
    return {
      token: TOKEN.ATENCAO,
      icone: "⚠",
      titulo: `${achados} ${achados === 1 ? "ponto a conferir" : "pontos a conferir"}`,
      texto: naoConferiveis
        ? `${conferidas} de ${perguntas.length} perguntas conferidas · ${naoConferiveis} sem como conferir.`
        : `As ${perguntas.length} perguntas foram conferidas.`,
    };
  }
  if (naoConferiveis === perguntas.length) {
    return {
      token: TOKEN.NEUTRO,
      icone: "○",
      titulo: "Não foi possível conferir",
      texto: "Nenhuma das perguntas pôde ser respondida — veja o motivo de cada uma.",
    };
  }
  if (naoConferiveis > 0) {
    return {
      token: TOKEN.NEUTRO,
      icone: "○",
      titulo: "Conferido em parte",
      texto: `${conferidas} de ${perguntas.length} perguntas conferidas, sem nada a apontar · ${naoConferiveis} sem como conferir.`,
    };
  }
  return {
    token: TOKEN.OK,
    icone: "✓",
    titulo: "Nada a apontar",
    texto: `As ${perguntas.length} perguntas foram conferidas em ${auditoria?.totalNotas ?? 0} nota(s).`,
  };
}

/** A ordem de leitura: primeiro o que tem achado, depois o conferido, por último o que não deu. */
export function ordenarPerguntas(perguntas) {
  const peso = (p) => {
    const l = leituraDaPergunta(p);
    if (l.estado === "COM_ACHADO") return 0;
    if (l.estado === "SEM_ACHADO") return 1;
    return 2;
  };
  return [...(perguntas || [])].sort((a, b) => peso(a) - peso(b));
}
