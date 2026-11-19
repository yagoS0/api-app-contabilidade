// Existência, autoria da transmissão e afirmação manual são fatos distintos.
// Índice/PDF não atribuem autoria. Nenhum estado desta apresentação autoriza despacho.

/**
 * Verde = provado (por quem quer que seja). Neutro = afirmado pelo contador. Âmbar = falta
 * consultar o extrato. Vermelho = a Receita foi consultada e não há declaração.
 */
export const TOM_ENTREGA = {
  ok: "ok",
  declarado: "declarado",
  desconhecido: "desconhecido",
  nao_entregue: "nao_entregue",
};

/** A Receita chegou a ser consultada para esta competência? */
function extratoFoiConsultado(extratoStatus, extratoConsultadoEm) {
  return Boolean(extratoConsultadoEm) || ["SUCCESS", "NOT_FOUND"].includes(String(extratoStatus || ""));
}

/**
 * @param {object} f fatos crus (nenhum veredito) — vêm do `getDadosFechamento`
 * @param {string|null} f.estadoApuracao   `ApuracaoSnapshot.estado` desta competência
 * @param {string|null} f.numeroDeclaracaoPortal  `ApuracaoSnapshot.numeroDeclaracao` (histórico; não prova autoria isoladamente)
 * @param {string|null} f.numeroDeclaracaoRfb     `CompanyMonthlyCircular.pgdasNumeroDeclaracao` (o que a RFB devolveu no extrato)
 * @param {string|null} f.extratoStatus           `CompanyMonthlyCircular.serproSyncStatus`
 * @param {string|Date|null} f.extratoConsultadoEm `serproLastSyncAt`
 * @param {string|Date|null} f.declaradaForaEm    marca manual do contador
 * @param {boolean} f.temPdfDaDeclaracao          `pgdasDeclaracaoFileId` presente
 * @returns {{chave:string, rotulo:string, detalhe:string, tom:string, provada:boolean, origem:string}}
 */
export function estadoEntregaPgdas({
  tentativaLocalIncerta = false,
  origemTransmissao = null,
  estadoApuracao = null,
  numeroDeclaracaoPortal = null,
  numeroDeclaracaoRfb = null,
  extratoStatus = null,
  extratoConsultadoEm = null,
  declaradaForaEm = null,
  temPdfDaDeclaracao = false,
} = {}) {
  const incerto = tentativaLocalIncerta || ['erro_transmissao', 'transmitindo'].includes(estadoApuracao);
  const ressalva = incerto ? ' Há uma tentativa local com resultado incerto. A declaração localizada não comprova o resultado dessa tentativa nem autoriza retransmissão.' : '';
  // 1. Transmitida por AQUI, com o número que a RFB devolveu na transmissão.
  if (estadoApuracao === "transmitida" && numeroDeclaracaoPortal && origemTransmissao === 'ALTAN') {
    return {
      chave: "transmitida_pelo_portal",
      rotulo: "Transmitida pela Altan",
      detalhe: `Declaração ${numeroDeclaracaoPortal}, transmitida daqui.` + ressalva,
      tom: TOM_ENTREGA.ok,
      provada: true,
      origem: "portal",
    };
  }
  // O estado legado isolado não comprova a entrega nem identifica quem transmitiu.
  if (numeroDeclaracaoRfb || (origemTransmissao === 'EXTERNA' && numeroDeclaracaoPortal)) {
    return {
      chave: "declaracao_localizada",
      rotulo: "Declaração localizada na Receita — origem da transmissão não comprovada",
      detalhe: `A Receita tem a declaração ${numeroDeclaracaoRfb || numeroDeclaracaoPortal} para esta competência`
        + `${temPdfDaDeclaracao ? ", e o PDF está guardado aqui" : ""}. A consulta não comprova quem transmitiu.`
        + (declaradaForaEm ? " O contador informou entrega externa." : "") + ressalva,
      tom: TOM_ENTREGA.ok,
      provada: true,
      origem: "rfb",
    };
  }
  if (incerto) return { chave: 'resultado_incerto', rotulo: 'Resultado fiscal não confirmado',
    detalhe: 'Confira o envio antes de qualquer nova tentativa. Não há retransmissão automática.',
    tom: TOM_ENTREGA.desconhecido, provada: false, origem: 'nenhuma' };
  // 3. O contador AFIRMA que entregou fora.
  if (declaradaForaEm) {
    // ⚠ EVIDÊNCIA CONTRA A AFIRMAÇÃO. Se o extrato foi consultado DEPOIS do registro e a Receita
    // não achou declaração nenhuma, as duas coisas não podem conviver caladas — é a mesma regra
    // que faz `marcarSemFaturamento` recusar afirmação contra nota emitida. Só vale quando a
    // consulta é POSTERIOR: extrato antigo simplesmente não viu a entrega que veio depois.
    const consultaPosterior = String(extratoStatus || "") === "NOT_FOUND"
      && extratoConsultadoEm && declaradaForaEm
      && new Date(extratoConsultadoEm).getTime() > new Date(declaradaForaEm).getTime();
    if (consultaPosterior) {
      return {
        chave: "declarada_fora_desmentida",
        rotulo: "Entrega declarada, mas a Receita não achou a declaração",
        detalhe: "O registro diz que esta competência foi entregue fora do portal, e o extrato "
          + "consultado depois disso não encontrou declaração para o período. Confira no gov.br "
          + "antes de considerar o mês resolvido.",
        tom: TOM_ENTREGA.nao_entregue,
        provada: false,
        origem: "contador",
      };
    }
    return {
      chave: "declarada_fora",
      rotulo: "Apuração realizada fora da Altan — verificação pendente",
      detalhe: "Registro feito aqui a partir da sua afirmação; a Receita não confirmou nada. "
        + "Buscar o extrato do Simples traz o número da declaração e transforma isto em comprovação.",
      tom: TOM_ENTREGA.declarado,
      provada: false,
      origem: "contador",
    };
  }
  // 4. Ninguém perguntou à Receita. Ausência de consulta NÃO é ausência de entrega.
  if (extratoFoiConsultado(extratoStatus, extratoConsultadoEm) && extratoStatus !== "NOT_FOUND") {
    return {
      chave: "consulta_inconclusiva",
      rotulo: "Entrega a confirmar — consulta inconclusiva",
      detalhe: "A última consulta não confirmou a entrega nem a ausência de declaração. Confira a autorização e recupere os documentos faltantes.",
      tom: TOM_ENTREGA.desconhecido,
      provada: false,
      origem: "nenhuma",
    };
  }
  if (!extratoFoiConsultado(extratoStatus, extratoConsultadoEm)) {
    return {
      chave: "sem_informacao",
      rotulo: "Entrega desconhecida — o extrato nunca foi consultado",
      detalhe: "O portal não sabe se a declaração desta competência foi entregue: ninguém buscou o "
        + "extrato do Simples aqui. Isto não é o mesmo que estar em aberto — buscar o extrato "
        + "responde, e o registro de entrega feita fora também.",
      tom: TOM_ENTREGA.desconhecido,
      provada: false,
      origem: "nenhuma",
    };
  }
  // 5. A Receita foi perguntada e não há declaração. É o único caso realmente em aberto.
  return {
    chave: "nao_entregue",
    rotulo: "PGDAS-D NÃO entregue",
    detalhe: "O extrato do Simples foi consultado e a Receita não tem declaração desta "
      + "competência. A obrigação está em aberto — fechar como empresa zerada resolve o mês aqui "
      + "dentro, não perante a Receita.",
    tom: TOM_ENTREGA.nao_entregue,
    provada: false,
    origem: "rfb",
  };
}

/** Cores por tom — tokens de ESTADO, cada um no significado dele (`apps/web/CLAUDE.md`). */
export const CORES_TOM = {
  [TOM_ENTREGA.ok]: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  [TOM_ENTREGA.declarado]: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  [TOM_ENTREGA.desconhecido]: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  [TOM_ENTREGA.nao_entregue]: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
};

/** Lê os fatos do payload do `getFechamento` sem espalhar o formato por três telas. */
export function entregaPgdasDoFechamento(dados) {
  const e = dados?.entregaPgdas || {};
  const t = dados?.fluxoPgdas?.transmissao;
  const incerto = t?.tentativaLocalIncerta === true || ['RESULTADO_INCERTO', 'INCERTA', 'EM_PROCESSAMENTO'].includes(t?.estado)
    || ['erro_transmissao', 'transmitindo'].includes(dados?.estado || dados?.snapshot?.estado);
  if (t?.confirmada === true && t.numeroDeclaracao) {
    const altan = t.origem === 'ALTAN';
    return {
      chave: altan ? 'transmitida_pelo_portal' : 'declaracao_localizada',
      rotulo: altan ? 'Transmitida pela Altan' : 'Declaração localizada na Receita — origem da transmissão não comprovada',
      detalhe: `Declaração ${t.numeroDeclaracao}.` + (!altan && t.declaradaExternaManualmente
        ? ' O contador informou entrega externa; a consulta confirma a existência, não a autoria da transmissão.' : '')
        + (incerto ? ' Há uma tentativa local com resultado incerto. A declaração localizada não comprova o resultado dessa tentativa nem autoriza retransmissão.' : ''),
      // provada refere-se à existência, não à autoria nem à tentativa incerta.
      tom: TOM_ENTREGA.ok, provada: true, origem: altan ? 'portal' : 'rfb',
    };
  }
  if (t && incerto) {
    return { chave: 'resultado_incerto', rotulo: 'Resultado fiscal não confirmado',
      detalhe: 'Confira o envio antes de qualquer nova tentativa. Não há retransmissão automática.',
      tom: TOM_ENTREGA.desconhecido, provada: false, origem: 'nenhuma' };
  }
  return estadoEntregaPgdas({
    // Autoria local vem da projeção validada no servidor, nunca do snapshot legado.
    origemTransmissao: null,
    estadoApuracao: dados?.estado || dados?.snapshot?.estado || null,
    numeroDeclaracaoPortal: t ? null : dados?.snapshot?.numeroDeclaracao || null,
    numeroDeclaracaoRfb: t ? null : e.numeroDeclaracaoRfb || null,
    extratoStatus: e.extratoStatus || null,
    extratoConsultadoEm: e.extratoConsultadoEm || null,
    declaradaForaEm: e.declaradaForaEm || null,
    temPdfDaDeclaracao: Boolean(e.temPdfDaDeclaracao),
  });
}
