// AS REGRAS DE TELA DO RELATÓRIO DE FATURAMENTO — uma leitura só, testada aqui.
//
// O componente desenha; quem decide o que a tela pode AFIRMAR é este arquivo. Segue o molde de
// `accounting/circular/lib/estadoGuia.js` e `apuracao/lib/entregaPgdas.js`: o teste de componente
// cobre a LIGAÇÃO (o texto certo saindo da mesma leitura), não a regra de novo.
//
// ⚠ O ASSUNTO DESTE ARQUIVO É PROCEDÊNCIA. O relatório traz números de três origens diferentes —
// o nosso motor, a simulação/transmissão oficial da RFB, e uma coluna do banco que às vezes é uma
// e às vezes é outra — e o erro que ele existe para impedir é o número do motor local se
// apresentar como "o que a Receita disse". É a mesma distinção que `entregaPgdas.js` faz para a
// entrega da declaração, aplicada ao VALOR.
//
// ⚠ E o segundo assunto é AUSÊNCIA. Zero não prova ausência de receita, lista vazia de pendências
// não prova competência classificada, e `INDETERMINADA`/`NAO_APURADO` não são "não tem" — são
// "não medimos". Nenhuma dessas três pode virar um ✓ verde.

/** Tons de estado, no significado fixo de `styles/tokens.css`. */
export const TOM = Object.freeze({
  ok: "ok",              // concluído / conferido
  warn: "warn",          // pendência: há ação a fazer
  danger: "danger",      // o relatório acusando a si mesmo
  neutral: "neutral",    // não sabemos — nunca verde, nunca vermelho
});

export const CORES_TOM_RELATORIO = Object.freeze({
  [TOM.ok]: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  [TOM.warn]: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  [TOM.danger]: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
  [TOM.neutral]: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
});

/**
 * ⚠ `null` NÃO É ZERO, e aqui isso é a regra inteira. `Number(null)` é `0` e passa em
 * `Number.isFinite` — sem a guarda, um DAS oficial ausente viraria "R$ 0,00 devolvido pela
 * Receita", que é exatamente a afirmação que este arquivo existe para impedir.
 */
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(fracao) {
  const f = num(fracao);
  if (f == null) return null;
  return `${(f * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. O DAS: o nosso número, o da Receita, e o que não se sabe de quem é
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ NUNCA "DAS apurado" e ponto. O rótulo carrega a procedência porque o número muda de dono.
 *
 * `preApurado.origem === "MOTOR_LOCAL"` é conta NOSSA, feita com a tabela versionada de alíquotas,
 * para conferência — apresentá-la sem dono é deixá-la ser lida como o valor oficial da RFB. O
 * padrão da casa é o do `FechamentoModal` ("DAS calculado (oficial SERPRO)").
 *
 * @param {object|null} preApurado — o bloco `preApurado` do relatório
 * @returns {{
 *   nosso: {valor:number|null, rotulo:string, disponivel:boolean},
 *   oficial: {valor:number|null, rotulo:string, disponivel:boolean, ambiguo:boolean, aviso:string|null},
 *   diferenca: number|null,
 *   comparavel: boolean,
 * }}
 */
export function procedenciaDoDas(preApurado) {
  const p = preApurado || {};
  const oficialSnap = p.oficial || {};
  const nossoValor = p.ok === true ? num(p.das) : null;

  const nosso = {
    valor: nossoValor,
    // ⚠ "cálculo do portal", nunca "DAS do mês": o motor calcula para conferir, não declara.
    rotulo: "DAS pré-apurado pelo portal (cálculo nosso, não é o da Receita)",
    disponivel: nossoValor != null,
  };

  // ⚠ TRANSMITIDO PRIMEIRO, SIMULADO DEPOIS — e com rótulos diferentes. Os dois vêm da RFB, mas
  // só o primeiro é uma declaração entregue; o segundo é um cálculo oficial de um PA que ainda não
  // foi declarado. Um rótulo só ("DAS da Receita") para os dois faria a tela dizer que a obrigação
  // está cumprida quando o contador apenas clicou em Calcular.
  const serpro = num(oficialSnap.dasRetornadoSerpro);
  if (serpro != null) {
    return {
      nosso,
      oficial: {
        valor: serpro,
        rotulo: "DAS oficial devolvido pela Receita (SERPRO) — declaração transmitida",
        disponivel: true,
        ambiguo: false,
        aviso: null,
      },
      // Só há diferença quando existem OS DOIS números — comparar com um ausente produz uma
      // "divergência" que é só a falta do segundo valor.
      diferenca: nossoValor != null ? +(nossoValor - serpro).toFixed(2) : null,
      comparavel: nossoValor != null,
    };
  }

  const simulado = num(oficialSnap.dasSimuladoSerpro);
  if (simulado != null) {
    return {
      nosso,
      oficial: {
        valor: simulado,
        rotulo: "DAS oficial calculado pela Receita (SERPRO) — simulação, nada transmitido",
        disponivel: true,
        ambiguo: false,
        aviso: null,
      },
      // ⚠ ESTA SUBTRAÇÃO É O DOUBLE-CHECK, e agora ela vale: os dois lados têm dono conhecido (o
      // nosso motor × a RFB). Era justamente por não saber de quem era o segundo número que a
      // diferença não podia ser calculada no ramo ambíguo, logo abaixo.
      diferenca: nossoValor != null ? +(nossoValor - simulado).toFixed(2) : null,
      comparavel: nossoValor != null,
    };
  }

  // ⚠ O RESÍDUO AMBÍGUO — E ELE CONTINUA VALENDO. `ApuracaoSnapshot.dasCalculadoLocal` foi, até a
  // separação das colunas, gravada tanto pelo motor local quanto pela simulação oficial do PGDAS-D
  // (`FechamentoService.calcularFechamento`). O backend hoje só manda este campo quando a
  // procedência NÃO pôde ser provada pela própria linha — snapshot velho. Chamá-lo de "nosso" ou
  // de "da Receita" seria escolher no escuro; a tela diz que não se sabe.
  const ambigua = oficialSnap.dasCalculadoLocalNoSnapshot || null;
  if (ambigua && num(ambigua.valor) != null) {
    return {
      nosso,
      oficial: {
        valor: num(ambigua.valor),
        rotulo: "DAS gravado na apuração — procedência ambígua",
        disponivel: true,
        ambiguo: ambigua.procedenciaAmbigua === true,
        aviso: ambigua.aviso
          || "Coluna gravada tanto pelo motor local quanto pela simulação oficial do PGDAS-D. "
            + "Não é possível afirmar de quem é este número.",
      },
      // ⚠ Não se calcula diferença contra um valor de dono desconhecido: a subtração afirmaria
      // que os dois lados são coisas diferentes, e eles podem ser o mesmo número duas vezes.
      diferenca: null,
      comparavel: false,
    };
  }

  return {
    nosso,
    oficial: {
      valor: null,
      rotulo: "Nenhum valor oficial gravado para esta competência",
      disponivel: false,
      ambiguo: false,
      aviso: null,
    },
    diferenca: null,
    comparavel: false,
  };
}

/**
 * A RECUSA DO MOTOR NÃO É ERRO — é o estado de 100% das empresas hoje (`tipoReceita` nulo em
 * 16.153/16.153 itens). O que a tela precisa mostrar é o motivo NOMEADO e o TAMANHO do buraco.
 *
 * @returns {{bloqueado:boolean, tom:string, titulo:string, detalhe:string|null,
 *            buraco:{valor:number|null, itens:number|null, fracaoRotulo:string|null}|null,
 *            comoResolver:string|null}}
 */
export function recusaDoPreApurado(preApurado) {
  const p = preApurado || {};
  if (p.ok === true) {
    return { bloqueado: false, tom: TOM.ok, titulo: "Pré-apuração calculada", detalhe: null, buraco: null, comoResolver: null, codigo: null };
  }

  const sc = p.semClassificacao || {};
  const valor = num(sc.valorContabil);
  const itens = num(sc.itens);
  // ⚠ "R$ 0,00 em 0 itens" não é tamanho de buraco nenhum — é ruído que faz uma competência sem
  // receita parecer uma competência por classificar. Sem buraco, o motivo fala sozinho.
  const buraco = (valor || 0) > 0 || (itens || 0) > 0
    ? { valor, itens, fracaoRotulo: pct(sc.fracaoDoTotal) }
    : null;

  const erroDeCalculo = p.estado === "erro_calculo";
  const detalhe = p.motivo?.mensagem || p.motivo?.detalhe || null;
  // Sem motivo nomeado e sem buraco não há o que fazer — pintar de âmbar uma competência em que
  // nada foi pedido do contador é o mesmo defeito do âmbar permanente que treina o olho a ignorar.
  const semAcao = !erroDeCalculo && !detalhe && !buraco;
  return {
    bloqueado: true,
    // ⚠ Âmbar, não vermelho: há ação a fazer e ela é conhecida. Vermelho aqui pintaria de
    // bloqueio o estado normal de toda a carteira.
    tom: erroDeCalculo ? TOM.danger : (semAcao ? TOM.neutral : TOM.warn),
    titulo: erroDeCalculo
      ? "O cálculo do portal não chegou a rodar"
      : "O portal não calculou o DAS desta competência",
    detalhe,
    buraco,
    comoResolver: p.comoResolver || null,
    // ⚠ A CAUSA VIAJA. Sem ela, quem lê esta recusa só sabe "está bloqueado", e o `tom` é `warn`
    // para QUALQUER bloqueio que não seja erro de cálculo — `CADASTRO_FALTANDO`, `REGIME_INVALIDO`
    // e `FOLHA_12M_FALTANDO` inclusive. Ver `recusaEcoaOTopo`, que precisa distinguir.
    codigo: p.motivo?.code || null,
  };
}

/**
 * ⚠⚠ A MESMA FRASE NÃO É DITA DUAS VEZES NA MESMA TELA.
 *
 * O relatório tinha QUATRO elementos âmbar para UM fato ("há receita sem classificação"): a caixa
 * do topo, a caixa dentro de "Simples Nacional — pré-apurado" (com o mesmo número e o mesmo "como
 * resolver"), o título do bloco NÃO CLASSIFICADO e o rodapé de conferência. Quando quase tudo é
 * âmbar, âmbar deixa de querer dizer alguma coisa — é a mesma regra que já tirou o paredão da
 * carteira e o menu permanentemente âmbar do SERPRO.
 *
 * ⚠ ISTO NÃO SILENCIA A RECUSA. O pré-apurado continua dizendo, com todas as letras, que o DAS
 * não foi calculado — o que ele para de fazer é REPETIR o número e o procedimento que estão dois
 * parágrafos acima, na caixa que já os traz.
 *
 * ⚠ E só ecoa quando a CAUSA é a mesma. `erro_calculo` (tom `danger`) tem causa própria — o motor
 * quebrou, e isso não está escrito em lugar nenhum acima —, então ele mantém a caixa inteira.
 *
 * @param {Array} avisos  o que `avisosDoRelatorio` devolveu para ESTE relatório
 * @param {object} recusa o que `recusaDoPreApurado` devolveu para ESTE pré-apurado
 * @returns {boolean} true quando o topo já disse o mesmo, com o mesmo número
 */
export function recusaEcoaOTopo(avisos, recusa) {
  if (!recusa || recusa.bloqueado !== true) return false;
  if (recusa.tom === TOM.danger) return false;
  // ⚠⚠ A CAUSA TEM DE SER A MESMA — não basta existir um aviso âmbar no topo.
  //
  // A primeira versão olhava só a presença de `NAO_CLASSIFICADO` nos avisos. Cenário real: empresa
  // SEM Cadastro Fiscal preenchido E com receita não classificada. O topo dizia "há receita sem
  // classificação"; o pré-apurado dizia "a empresa não tem Cadastro Fiscal preenchido (regime +
  // CNAE)" — outra causa, outra ação, outro lugar para clicar — e era rebaixado a cinza como se
  // já tivesse sido dito acima. Nada sumia, mas o cinza sinaliza "isto já está contado" para um
  // fato que não está.
  if (recusa.codigo !== "RECEITA_NAO_CLASSIFICADA") return false;
  const lista = Array.isArray(avisos) ? avisos : [];
  return lista.some((a) => a && a.codigo === "NAO_CLASSIFICADO");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Os estados que não podem virar silêncio — na ordem em que a tela avisa
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Os avisos do relatório, do mais grave ao menos. Cada um traz `codigo` (para o teste e para a
 * chave do React), `tom`, `titulo` e `detalhe`.
 *
 * ⚠ A ORDEM É DELIBERADA: a conferência que não fecha vem primeiro porque é o relatório acusando a
 * si mesmo — enquanto ela estiver aberta, todos os outros números estão sob suspeita.
 *
 * ⚠ E o não-classificado sobe para o topo mesmo o GRUPO dele ficando por último na tabela: é o
 * alarme, e avisar depois do total é avisar tarde. Ver `RelatorioFaturamentoService`.
 */
export function avisosDoRelatorio(dados) {
  const d = dados || {};
  const out = [];

  const conf = d.conferencia || null;
  if (conf && conf.confere === false) {
    out.push({
      codigo: "CONFERENCIA_NAO_FECHA",
      tom: TOM.danger,
      titulo: "O total deste relatório não bate com o faturamento da competência",
      detalhe: "O relatório soma as linhas de um jeito e o resto do portal soma a competência de "
        + "outro. Enquanto isso não fechar, nenhum total daqui pode ser usado como base.",
      numeros: {
        relatorio: num(conf.totalRelatorio),
        faturamento: num(conf.faturamentoEmit),
        diferenca: num(conf.diferenca),
      },
    });
  }

  const nc = d.naoClassificado || null;
  if (nc && (num(nc.valorContabil) || 0) > 0) {
    out.push({
      codigo: "NAO_CLASSIFICADO",
      tom: TOM.warn,
      titulo: "Há receita sem classificação nesta competência",
      detalhe: nc.comoResolver || null,
      numeros: {
        valor: num(nc.valorContabil),
        itens: num(nc.itens),
        fracaoRotulo: pct(nc.fracaoDoTotal),
      },
    });
  }

  // ⚠ OUTRO BLOCO, OUTRA AÇÃO, OUTRO RESPONSÁVEL. "Nunca recebemos o detalhe" não é "ninguém
  // classificou": um se resolve manifestando/baixando a NF-e completa, o outro com um clique em
  // Classificar competência. Somá-los daria um número que não aponta para lugar nenhum.
  const sd = d.semDetalheCapturado || null;
  if (sd && (num(sd.valorContabil) || 0) > 0) {
    out.push({
      codigo: "SEM_DETALHE_CAPTURADO",
      tom: TOM.neutral,
      titulo: "Há notas das quais nunca recebemos o detalhe",
      detalhe: sd.comoResolver || sd.motivo || null,
      numeros: {
        valor: num(sd.valorContabil),
        notas: num(sd.notas),
        fracaoRotulo: pct(sd.fracaoDoTotal),
      },
    });
  }

  const aus = d.ausenciaDeNotas || null;
  if (aus && aus.aplicavel === true) {
    out.push({
      codigo: "AUSENCIA_DE_NOTAS",
      // Verde só quando há confirmação de verdade (afirmação do contador ou conferência ADN `ok`).
      tom: aus.podeAfirmarAusencia === true ? TOM.ok : TOM.neutral,
      titulo: aus.podeAfirmarAusencia === true
        ? "Competência sem notas — com confirmação"
        : "Nenhuma nota encontrada — isto não prova ausência de receita",
      // ⚠ O TEXTO VEM PRONTO DO BACKEND e não é reescrito aqui: ele nomeia as três causas de um
      // zero (não emitiu · município fora do ADN · cursor/A1) e o caminho para afirmar ausência.
      detalhe: aus.mensagem || null,
      numeros: null,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. As dimensões não apuradas — "não medimos" nunca se escreve como "não tem"
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O rótulo da segregação do item 6.5.
 *
 * ⚠ `INDETERMINADA` NÃO PODE VIRAR "Sem substituição tributária". `flagST`/`flagMonofasico` não
 * têm escritor: `false` no banco é o default da coluna, não uma conferência. Responder "Sem" por
 * ausência de dado é responder ao PGDAS-D por default, em nome do contribuinte.
 */
export function rotuloSegregacao(segregacao) {
  if (!segregacao) {
    return { texto: "—", apurado: null, titulo: "O manual não faz a pergunta com/sem ST para este tipo de receita." };
  }
  if (segregacao.codigo === "INDETERMINADA") {
    return {
      texto: segregacao.rotuloCurto || "Segregação não apurada",
      apurado: false,
      titulo: segregacao.motivo || "O portal não extrai ST nem tributação monofásica do XML.",
    };
  }
  return {
    texto: segregacao.rotuloCurto || segregacao.codigo,
    apurado: true,
    titulo: segregacao.rotuloOficial || null,
  };
}

/** O rótulo das 8 qualificações (item 6.6.1). `NAO_APURADO` é falta de leitura, não ausência. */
export function rotuloQualificacoes(qualificacoes) {
  const q = qualificacoes || {};
  if (q.estado === "APURADO" && Array.isArray(q.rotulos) && q.rotulos.length) {
    return { texto: q.rotulos.join(" · "), apurado: true, titulo: null };
  }
  if (q.estado === "NENHUMA") {
    return { texto: "Nenhuma", apurado: true, titulo: "Conferido: a receita não tem qualificação." };
  }
  return {
    texto: "Não apurado",
    apurado: false,
    titulo: q.motivo || "O portal não extrai qualificação de receita do XML. Ausência aqui é falta "
      + "de leitura, não ausência de qualificação.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. ZERO PENDÊNCIA NÃO É "TUDO CERTO" — o defeito do ✓ verde
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ PENDÊNCIA SÓ EXISTE SE O CLASSIFICADOR TIVER RODADO.
 *
 * A tela mostrava "✓ Nenhuma pendência aberta" em VERDE quando a lista vinha vazia. Mas
 * `FilaPendencia` só ganha linha quando `ClassificadorService` roda e não acha regra — e
 * `tipoReceita` é nulo em 16.153/16.153 itens em produção. Ou seja: hoje zero pendências significa
 * **ninguém classificou**, e o ✓ verde (que no vocabulário deste app quer dizer CONCLUÍDO)
 * concluía justamente o que não foi feito.
 *
 * A segunda fonte que desempata é o relatório de faturamento da competência: `naoClassificado`
 * mede exatamente quanta receita está sem `tipoReceita`. Sem o relatório gerado, a resposta honesta
 * é a terceira — **não sabemos** —, e ela não é verde nem vermelha.
 *
 * ⚠ As pendências são da EMPRESA (`listPendencias` não filtra competência) e o relatório é da
 * COMPETÊNCIA. O texto diz isso; misturar os dois escopos calados seria trocar um erro por outro.
 *
 * @param {{pendencias?: Array, relatorio?: object|null}} args
 */
export function estadoDaClassificacao({ pendencias = [], relatorio = null } = {}) {
  const abertas = Array.isArray(pendencias) ? pendencias.length : 0;
  if (abertas > 0) {
    return {
      chave: "com_pendencia",
      tom: TOM.warn,
      rotulo: `${abertas} ${abertas === 1 ? "pendência aberta" : "pendências abertas"}`,
      detalhe: "Itens que o classificador processou e para os quais não achou regra.",
      verificavel: true,
    };
  }

  const dados = relatorio?.dados || null;
  if (!dados) {
    return {
      chave: "indeterminado",
      tom: TOM.neutral,
      rotulo: "Nenhuma pendência aberta — e isso ainda não quer dizer classificada",
      detalhe: "Pendência só nasce quando o classificador roda. Sem o relatório de faturamento "
        + "desta competência, o portal não tem como dizer se ela chegou a ser classificada. "
        + "Gere o relatório na sub-aba Apuração para saber.",
      verificavel: false,
    };
  }

  const naoClassificado = num(dados.naoClassificado?.valorContabil) || 0;
  const total = num(dados.totalMes?.valorContabil) || 0;

  if (naoClassificado > 0) {
    return {
      chave: "nunca_classificada",
      tom: TOM.warn,
      rotulo: "Nenhuma pendência aberta porque a competência não foi classificada",
      detalhe: `O relatório desta competência tem ${fmtBrl(naoClassificado)} de receita sem tipo `
        + `(${pct(dados.naoClassificado?.fracaoDoTotal) || "—"} do total). Rode "Classificar `
        + `competência": o que não tiver regra vira pendência aqui.`,
      verificavel: true,
    };
  }

  if (total === 0) {
    return {
      chave: "sem_receita",
      tom: TOM.neutral,
      rotulo: "Nenhuma pendência aberta — não há receita nesta competência para classificar",
      detalhe: "Zero pendências aqui não é conclusão de trabalho: não houve nota a classificar. "
        + "Se o mês deveria ter faturamento, o zero é o problema, não a ausência de pendência.",
      verificavel: true,
    };
  }

  return {
    chave: "sem_pendencia",
    tom: TOM.ok,
    rotulo: "Nenhuma pendência aberta — a competência está classificada",
    detalhe: `O relatório desta competência não tem receita sem tipo (${fmtBrl(total)} classificados).`,
    verificavel: true,
  };
}

function fmtBrl(v) {
  const n = num(v);
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. O KPI "DAS apurado" da aba — o mesmo problema, um degrau acima
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ O KPI mostrava `dasRetornadoSerpro ?? dasCalculadoLocal` sob o rótulo único "DAS apurado": o
 * número do nosso motor e o da Receita saíam com o MESMO nome, dois cliques acima de um relatório
 * que separa os dois. Não dá para mostrar "nosso × da Receita" embaixo enquanto o KPI de cima
 * confunde os dois.
 *
 * ⚠ A ORDEM É A DA FORÇA DA EVIDÊNCIA, e cada degrau tem rótulo próprio:
 * transmitido → simulado → nosso motor (provado) → gravado sem procedência (snapshot velho).
 * O estado ambíguo NÃO foi removido: ele deixou de ser o destino de toda competência calculada e
 * passou a ser o que de fato é — o resíduo das linhas anteriores à separação das colunas.
 *
 * @param {object|null} snap — `ApuracaoSnapshot`
 */
export function kpiDasApurado(snap) {
  const serpro = num(snap?.dasRetornadoSerpro);
  if (serpro != null) {
    return {
      valor: serpro,
      label: "DAS oficial (SERPRO)",
      titulo: "Valor devolvido pela Receita na TRANSMISSÃO do PGDAS-D — a declaração existe.",
      procedencia: "rfb",
    };
  }
  const simulado = num(snap?.dasSimuladoSerpro);
  if (simulado != null) {
    return {
      valor: simulado,
      // ⚠ "simulado" no rótulo, não só no tooltip: é a diferença entre "a Receita calculou" e "a
      // declaração foi entregue", e ela decide se ainda há obrigação a cumprir no mês.
      label: "DAS oficial simulado (SERPRO)",
      titulo: "Valor devolvido pela Receita na SIMULAÇÃO do PGDAS-D (indicadorTransmissao:false). "
        + "É o cálculo oficial do mês — mas nada foi transmitido ainda.",
      procedencia: "rfb_simulado",
    };
  }
  const local = num(snap?.dasCalculadoLocal);
  if (local != null) {
    // Procedência PROVADA: quem escreveu foi o nosso motor, e a marca viajou junto do número.
    if (snap?.dasCalculadoLocalProcedencia === "MOTOR_LOCAL") {
      return {
        valor: local,
        label: "DAS calculado pelo portal",
        titulo: "Cálculo do NOSSO motor, com a tabela versionada de alíquotas — serve de "
          + "conferência, não é o valor da Receita e não declara nada.",
        procedencia: "motor_local",
      };
    }
    return {
      valor: local,
      // ⚠ Snapshot anterior à separação: a coluna era gravada pelo motor local E pela simulação
      // oficial, e a linha não guarda qual dos dois é. Continua sem dono, e é assim que se diz.
      label: "DAS gravado (procedência ambígua)",
      titulo: "Snapshot anterior à separação das colunas: `dasCalculadoLocal` era gravada tanto "
        + "pelo motor local quanto pela simulação oficial do PGDAS-D — não é possível afirmar de "
        + "quem é este número. Recalcule a competência para obter os valores já separados.",
      procedencia: "ambigua",
    };
  }
  return {
    valor: null,
    label: "DAS apurado",
    titulo: "Nenhuma apuração gravada para esta competência.",
    procedencia: "nenhuma",
  };
}
