/**
 * A LEITURA DO FLUXO DE CAIXA — e ela é a ÚNICA desde 29/08/2026.
 *
 * ⚠⚠ ESTE CABEÇALHO DIZIA "ESPELHO de `apps/web/src/features/fluxo/lib/leituraDoFluxo.js`" E FICOU
 * FALSO. Aquele arquivo **não existe mais**: o dono removeu o fluxo de caixa do portal do contador
 * (*"para o contador não vai existir fluxo de caixa, pode eliminar isso da aba"*), e a feature foi
 * apagada inteira — a cópia junto. **Não a recrie "por simetria":** espelho sem consumidor não é
 * código morto barato, é sincronização obrigatória para sempre numa cópia que ninguém abre.
 *
 * ⚠ O que era divergência deliberada da cópia e hoje é simplesmente COMO ESTE APP É:
 *   1. o verde proibido é `--success` (a paleta é clara; a do contador era escura);
 *   2. o dinheiro sai por `lib/format.brl` — este app já tem a sua regra de "ausência é traço",
 *      e uma segunda formatação faria o mesmo valor sair diferente em duas telas do MESMO portal;
 *   3. o TEXTO é do cliente: aqui não se escreve "procedência", "competência" nem "mediana". O que
 *      a frase precisa dizer é a mesma coisa; o vocabulário é o de quem lê.
 *
 * ⚠ O CUIDADO QUE O ESPELHO EXIGIA CONTINUA VALENDO AQUI DENTRO: valor novo de `PROCEDENCIA` no
 * servidor sem entrada em `LEITURA_DA_PROCEDENCIA` cai no fallback *"esta tela não conhece esta
 * origem"* — sem erro nenhum. Foi assim que `COMPROMISSO` quase passou batido.
 *
 * ⚠⚠ ESTA REGRA NÃO CALCULA NADA e NÃO SOMA FATO COM PREVISÃO. Não existe `total` no payload, e a
 * tela não inventa um — é a mesma proibição dos dois lados (`docs/dre-fluxo-caixa.md`).
 */

import { brl } from "../../../lib/format";

/** ⚠ Vocabulário FECHADO — espelha `PROCEDENCIA` do servidor. */
/**
 * ⚠⚠ `COMPROMISSO` ENTROU EM 28/08/2026, E O SIGNIFICADO DE `FATO` MUDOU JUNTO.
 *
 * A **Lei 1** da `CONSTITUICAO-do-produto.md` diz: *"Dinheiro só confirma com pagamento.
 * Contabilizado, emitido, gerado, vencido: nada disso é fato de caixa."* Até aqui `FATO` queria
 * dizer *"existe, com data própria"*, e a guia GERADA e em aberto entrava nele — hoje ela é
 * `COMPROMISSO`, e `FATO` é só o que foi pago.
 *
 * ⚠⚠ **ESTE ARQUIVO É ESPELHO, e não atualizá-lo era o defeito silencioso.** O valor novo cairia no
 * fallback *"Esta tela não conhece esta procedência"* — em TODA guia em aberto, nas duas telas, sem
 * erro nenhum. É a mesma classe do `select` explícito: a tela "só não mostra".
 */
export const PROCEDENCIA = Object.freeze({
  FATO: "FATO",
  COMPROMISSO: "COMPROMISSO",
  PREVISAO: "PREVISAO",
  DESCONHECIDO: "DESCONHECIDO",
});

export const DIRECAO = Object.freeze({ ENTRADA: "ENTRADA", SAIDA: "SAIDA" });

export const FONTE = Object.freeze({
  GUIA: "GUIA",
  NOTA_EMITIDA: "NOTA_EMITIDA",
  SERIE_RECEITA: "SERIE_RECEITA",
  SERIE_DESPESA: "SERIE_DESPESA",
  IMPOSTO_PROJETADO: "IMPOSTO_PROJETADO",
  FOLHA: "FOLHA",
  /**
   * ⚠⚠ O QUE O PRÓPRIO CLIENTE ACRESCENTOU (29/08/2026) — a saída AVULSA, a que tem data.
   *
   * ⚠ O que ele diz se REPETIR vira `SERIE_DESPESA` com `base.origem: "DECLARADA"`, e é `origem` que
   * a distingue do que o sistema detectou. Duas fontes para a mesma série fariam a evidência da
   * recorrência (n, faixa, confronto) parar de aparecer.
   *
   * ⚠⚠ Ela cai no balde **`saida`** de `tabelaDoFluxo.js`, e há teste afirmando isso — fonte nova
   * caindo no balde certo por acidente é o que a lista fechada existe para impedir.
   */
  SAIDA_DO_CLIENTE: "SAIDA_DO_CLIENTE",
});

/**
 * ⚠⚠ A LEI DE COR — e neste portal ela importa MAIS que no do contador.
 *
 * ⚠⚠ **A PREVISÃO NUNCA RECEBE VERDE.** Verde, nesta casa, quer dizer *pago/concluído* — o pior
 * desfecho possível para uma linha que ainda não aconteceu. E quem lê aqui é o dono da empresa, que
 * pode tomar decisão de caixa em cima do número.
 *
 * ⚠ O FATO também não é verde: ele é NEUTRO. Uma guia gerada e em aberto não está paga.
 *
 * ⚠⚠ E a palavra vai no TEXTO, não só na cor: impressão em preto e branco e daltonismo tiram a cor.
 */
const LEITURA_DA_PROCEDENCIA = Object.freeze({
  [PROCEDENCIA.FATO]: {
    rotulo: "Já existe",
    classe: "neutro",
    frase: "Este valor já existe, com data própria.",
  },
  [PROCEDENCIA.COMPROMISSO]: {
    // ⚠ "A pagar", não "Previsto": o valor e a data são CONHECIDOS — o que falta é o dinheiro sair.
    // Chamá-lo de previsão diria que alguém estimou o número, e ninguém estimou.
    rotulo: "A pagar",
    classe: "aviso",
    frase: "Este valor já foi gerado e ainda não foi pago.",
  },
  [PROCEDENCIA.PREVISAO]: {
    rotulo: "Previsto",
    classe: "aviso",
    frase: "Este valor é uma PREVISÃO — ele ainda não aconteceu.",
  },
  [PROCEDENCIA.DESCONHECIDO]: {
    rotulo: "Sem mês",
    classe: "aviso",
    frase: "Falta um dado para saber em que mês isto entra ou sai.",
  },
});

const PROCEDENCIA_DESCONHECIDA = Object.freeze({
  rotulo: "Não sabemos",
  classe: "neutro",
  // ⚠ Valor novo no servidor chega aqui como incógnita. Escolher um rótulo bonito faria a tela
  // afirmar algo que ela não sabe.
  frase: "Esta tela não conhece esta origem. Fale com o seu contador.",
});

export function leituraDaProcedencia(p) {
  return LEITURA_DA_PROCEDENCIA[p] || PROCEDENCIA_DESCONHECIDA;
}

/** ⚠⚠ Verde NUNCA aparece neste fluxo. Travado por teste sobre as três procedências. */
export const TOKEN_PROIBIDO = "--success";

/** ⚠ As classes que a folha de estilo pinta. `ok` é a que NÃO pode aparecer aqui. */
export const CLASSES_DA_PROCEDENCIA = Object.freeze(["neutro", "aviso"]);

/** ⚠ O nome de cada origem, no vocabulário de quem RECEBE — nunca no do razão. */
export const ROTULO_DA_FONTE = Object.freeze({
  [FONTE.GUIA]: "Guia de imposto",
  [FONTE.NOTA_EMITIDA]: "Recebimento de nota emitida",
  [FONTE.SERIE_RECEITA]: "Receita que se repete",
  [FONTE.SERIE_DESPESA]: "Despesa que se repete",
  [FONTE.FOLHA]: "Folha de pagamento",
  [FONTE.IMPOSTO_PROJETADO]: "Imposto previsto",
  // ⚠ O rótulo diz DE QUEM é a linha, e é o que a distingue do que o sistema previu — sem ele o
  // cliente não saberia qual das linhas ele mesmo escreveu.
  [FONTE.SAIDA_DO_CLIENTE]: "Você acrescentou",
});

export function rotuloDaFonte(f) {
  return ROTULO_DA_FONTE[f] || "Origem desconhecida";
}

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** `"2026-08"` → `"agosto de 2026"`. ⚠ Competência torta não vira mês nenhum. */
export function rotuloDoMes(competencia) {
  if (typeof competencia !== "string") return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return "—";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "—";
  return `${MESES[mes - 1]} de ${m[1]}`;
}

/**
 * Soma meses a uma competência. `("2026-12", 1)` → `"2027-01"`.
 *
 * ⚠ Aritmética de STRING, nunca `new Date`: a competência é um rótulo civil, e o construtor de data
 * a interpretaria em UTC — no fuso de São Paulo, `new Date("2026-08")` volta como julho.
 *
 * ⚠ Ela morava dentro de `BlocoDeDemonstracao.jsx` e subiu para cá em 29/08/2026, quando o Painel
 * passou a precisar dela para ler o MÊS SEGUINTE nos três cards. Duas cópias da mesma aritmética
 * divergiriam na primeira correção — e as duas decidem em que mês um número aparece.
 */
export function somarCompetencia(competencia, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  if (!m) return null;
  const t = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** `"2026-08"` → `"ago/26"`, para caber na coluna estreita do celular. */
export function mesCurto(competencia) {
  if (typeof competencia !== "string") return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return "—";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "—";
  return `${MESES[mes - 1].slice(0, 3)}/${m[1].slice(2)}`;
}

/**
 * ⚠⚠ QUANDO A LINHA ACONTECE — e o dia ausente NUNCA vira um dia inventado.
 *
 * A guia tem dia próprio; a projeção não tem, e a tela diz POR QUÊ em vez de escolher um. Inventar
 * "dia 10" seria fabricar precisão que ninguém informou — e aqui o número vira decisão de caixa.
 */
export function quandoDaLinha(linha) {
  const dia = numero(linha?.dia);
  if (dia != null) return { texto: `dia ${dia}`, exato: true, motivo: null };
  return {
    texto: "ao longo do mês",
    exato: false,
    // ⚠ O motivo vem do SERVIDOR, com a frase pronta — a tela não escreve a sua, senão as duas
    // divergem na primeira correção.
    motivo: linha?.diaDesconhecido?.frase || null,
  };
}

/**
 * ⚠⚠ OS TOTAIS DO MÊS — e a SOMA não existe.
 *
 * ⚠ Quem tentar somar `fato` com `previsao` aqui recria o número que o contrato inteiro existe
 * para não entregar.
 */
export function totaisParaTela(totais) {
  return {
    fato: {
      entrada: numero(totais?.fato?.entrada) || 0,
      saida: numero(totais?.fato?.saida) || 0,
    },
    previsao: {
      entrada: numero(totais?.previsao?.entrada) || 0,
      saida: numero(totais?.previsao?.saida) || 0,
    },
    // ⚠⚠ CONTAGEM, nunca valor.
    desconhecido: { quantas: numero(totais?.desconhecido?.quantas) || 0 },
  };
}

/** ⚠ O mês tem alguma coisa? Decide se ele aparece com linhas ou com a frase de vazio. */
export function mesTemAlgo(mes) {
  return (mes?.linhas?.length || 0) > 0;
}

/**
 * ⚠⚠ A TELA ABRE COM 3 MESES — o contrato entrega os 12, a leitura começa onde a evidência está.
 *
 * ⚠ Aqui isso pesa mais que no portal do contador: a tela do cliente é lida no celular, e doze
 * meses abertos empurrariam tudo o mais para fora da dobra.
 */
export const MESES_ABERTOS_POR_PADRAO = 3;

export function separarMeses(meses, abertos = MESES_ABERTOS_POR_PADRAO) {
  const lista = Array.isArray(meses) ? meses : [];
  return { proximos: lista.slice(0, abertos), distantes: lista.slice(abertos) };
}

/**
 * ⚠⚠ O TOTAL DO BLOCO RECOLHIDO — por PROCEDÊNCIA, e nunca somado.
 *
 * Sem ele os meses recolhidos sumiriam de vista; com uma soma única, eles virariam o número de doze
 * meses que o contrato recusa.
 */
export function totalDoBloco(meses) {
  const zero = { entrada: 0, saida: 0 };
  const acc = { fato: { ...zero }, previsao: { ...zero }, desconhecido: { quantas: 0 } };
  for (const m of meses || []) {
    const t = totaisParaTela(m?.totais);
    acc.fato.entrada += t.fato.entrada;
    acc.fato.saida += t.fato.saida;
    acc.previsao.entrada += t.previsao.entrada;
    acc.previsao.saida += t.previsao.saida;
    acc.desconhecido.quantas += t.desconhecido.quantas;
  }
  return acc;
}

/**
 * ⚠⚠ POR QUE ESTA LINHA ESTÁ AQUI — no TEXTO, nunca num `title`.
 *
 * `title` não aparece no teclado nem no toque, e este portal é lido no celular.
 *
 * ⚠ A FAIXA VIAJA JUNTO. A mediana sozinha erraria por um terço rotineiramente (o CV mediano das
 * despesas, medido em 27/08/2026, é 36,1%) — e aqui quem lê pode planejar o caixa em cima dela.
 */
export function evidenciaDaLinha(linha) {
  const partes = [];
  const frase = String(linha?.base?.frase ?? "").trim();
  if (frase) partes.push(frase);

  const n = numero(linha?.base?.n);
  if (n != null && n > 0) partes.push(`visto ${n} ${n === 1 ? "vez" : "vezes"}`);

  const min = numero(linha?.base?.min);
  const max = numero(linha?.base?.max);
  if (min != null && max != null && min !== max) partes.push(`entre ${brl(min)} e ${brl(max)}`);

  return partes.length ? partes.join(" · ") : null;
}

/**
 * ⚠⚠ O CONFRONTO da recorrência que o CLIENTE declarou — *"o observado vence"* (decisão do dono).
 *
 * ⚠ A frase é escrita para ele, não para o contador: quem declarou aquele valor foi ele, e a tela
 * precisa dizer que o extrato apontou outra coisa **sem** parecer acusação.
 *
 * ⚠ Devolve `null` quando não há o que confrontar: um aviso em toda linha vira paisagem.
 */
export function confrontoDaLinha(linha) {
  const declarado = numero(linha?.base?.valorDeclarado);
  const observado = numero(linha?.base?.valorObservado);
  if (declarado == null || observado == null) return null;
  const diferenca = Math.abs(observado - declarado);
  if (declarado > 0 && diferenca / declarado < 0.05) return null;
  return `Você informou ${brl(declarado)}; o que apareceu de fato foi ${brl(observado)}. `
    + "A previsão usa o valor que apareceu.";
}

/**
 * ⚠⚠ AS RESSALVAS — cada uma responde a uma pergunta que ficaria sem resposta olhando o número.
 *
 * ⚠ CADA UMA TEM TÍTULO PRÓPRIO. Sem isso viram caixas de aviso idênticas empilhadas, e o leitor
 * deixa de ler todas — foi exatamente o defeito achado no navegador do portal do contador.
 *
 * ⚠ Lista vazia quando não há ressalva: inventar avisos faria os de verdade virarem paisagem.
 */
export function ressalvasDoFluxo(fluxo) {
  const r = [];

  // ⚠⚠ A GUIA VENCIDA é a linha mais urgente, e ela não mora em mês nenhum.
  const vencidas = numero(fluxo?.vencidas?.quantas) || 0;
  if (vencidas > 0) {
    r.push({
      tom: "aviso",
      titulo: "Guias já vencidas",
      texto: `${vencidas} guia(s) já venceram e continuam em aberto, somando `
        + `${brl(fluxo?.vencidas?.valor)}. Elas não aparecem nos meses abaixo porque a data delas já `
        + "passou — mas o dinheiro ainda tem de sair. Fale com o seu contador.",
    });
  }

  // ⚠⚠ O que não pôde ser posto em mês nenhum. Cada motivo já vem com o conserto, do servidor.
  for (const s of fluxo?.semMes || []) {
    r.push({
      tom: "aviso",
      // ⚠ O rótulo da linha entra no título: duas guias sem vencimento viram duas caixas iguais.
      titulo: s?.rotulo ? `Sem mês — ${s.rotulo}` : "Sem mês definido",
      texto: s?.frase,
    });
  }

  /*
   * ⚠⚠ LÁPIDE — A RESSALVA DO PRAZO DE RECEBIMENTO SAIU EM 29/08/2026.
   *
   * Ela dizia: *"as entradas das notas emitidas estão sendo previstas para N mês(es) depois da
   * emissão — este é o PADRÃO do sistema, ninguém configurou o prazo da sua empresa"*, e nascia de
   * `fluxo.prazoRecebimento.configurado === false`. O argumento dela continua válido em geral
   * ("ninguém configurou" ≠ "o prazo é 1 mês", e quem configura é o CONTADOR) — o que sumiu foi o
   * OBJETO: o dono decidiu que **a entrada cai no dia 1 do mês seguinte à emissão**, sempre, e
   * `FluxoDeCaixaService` parou de ler `PortalClient.prazoRecebimentoMeses`. O campo
   * `prazoRecebimento` não viaja mais no payload.
   *
   * ⚠ Mantê-la seria pior que removê-la: ela descreveria uma configuração que não existe mais e
   * mandaria o cliente falar com o contador sobre um ajuste que ninguém pode fazer.
   * ⚠ A COLUNA do banco continua lá (dropar coluna é migration destrutiva e decisão do dono), sem
   * leitor. Se um dia o prazo voltar a ser configurável, esta ressalva volta com ele.
   */

  // ⚠⚠ A ausência do imposto previsto é DITA — nunca uma linha que simplesmente não aparece.
  if (fluxo?.semImposto?.frase) {
    r.push({ tom: "neutro", titulo: "Sem imposto previsto", texto: fluxo.semImposto.frase });
  }

  // ⚠ "a tabela não existe neste ambiente" ≠ "você não tem nada que se repete".
  if (fluxo?.recorrenciaIndisponivel) {
    r.push({
      tom: "aviso",
      titulo: "Repetições não lidas",
      texto: "As despesas e receitas que se repetem não puderam ser lidas agora, então elas não "
        + "entram neste fluxo. Isto é uma limitação do sistema, não uma afirmação sobre a sua empresa.",
    });
  }

  const fora = numero(fluxo?.foraDoHorizonte) || 0;
  if (fora > 0) {
    r.push({
      tom: "neutro",
      titulo: "Fora dos meses mostrados",
      texto: `${fora} linha(s) caem fora dos ${fluxo?.horizonte || 12} meses mostrados aqui.`,
    });
  }

  return r;
}

/**
 * ⚠⚠ O AVISO QUE ACOMPANHA A PREVISÃO — e ele é OBRIGATÓRIO.
 *
 * Sem esta frase, a coluna "previsto" se lê como compromisso — e quem lê esta tela é quem paga as
 * contas.
 */
export const FRASE_DA_PREVISAO =
  "O que está marcado como PREVISTO ainda não aconteceu: é uma estimativa a partir do que já se "
  + "repetiu. Ele não é somado ao que já existe — cada um tem o seu total, de propósito.";

/** ⚠ E a que explica por que não há um número único de 12 meses. */
export const FRASE_SEM_TOTAL =
  "Não há um total dos 12 meses: este painel mostra MOVIMENTOS, não saldo — ele não sabe quanto "
  + "você tem em conta hoje, então não teria como somar um saldo futuro.";

/** ⚠ As duas formas que o cliente pode acrescentar — o MESMO vocabulário que a rota despacha. */
export const TIPO_DA_SAIDA = Object.freeze({ AVULSA: "AVULSA", RECORRENTE: "RECORRENTE" });

/** ⚠ O estado que o SERVIDOR manda em `base.estadoDaSaida`. Vocabulário fechado, dele. */
export const ESTADO_DA_SAIDA_DO_CLIENTE = Object.freeze({
  PENDENTE: "PENDENTE",
  CONFIRMADA: "CONFIRMADA",
});

/** ⚠ O único estado que os DOIS vocabulários compartilham — ver o comentário longo abaixo. */
const ESTADO_PENDENTE = ESTADO_DA_SAIDA_DO_CLIENTE.PENDENTE;

/**
 * ⚠⚠ O QUE O CLIENTE ACRESCENTOU, lido do payload do fluxo — UMA linha por SAÍDA, nunca por
 * ocorrência.
 *
 * A recorrente mensal aparece em 8 meses da janela: listá-la 8 vezes daria 8 botões de remover para
 * UMA coisa só, e a pessoa não saberia qual clicar. Aqui ela é uma linha, com a contagem de vezes
 * que aparece — que é o que responde *"quanto isso me custa no horizonte?"*.
 *
 * ⚠⚠ **NÃO EXISTE UMA SEGUNDA CONSULTA PARA ISTO.** A lista sai do MESMO payload que a tabela
 * desenha, então ela não pode discordar dela. Uma rota de "minhas saídas" traria a pergunta *"por
 * que a lista mostra uma linha que a tabela não tem?"*, que é o defeito que a competência única já
 * consertou neste app.
 *
 * ⚠ **Como se sabe que a linha é do cliente:** a AVULSA vem marcada (`base.doCliente`); a
 * RECORRENTE é `SERIE_DESPESA` com `base.origem: "DECLARADA"` — e hoje **só o cliente declara**
 * (`marcarSerie`, a porta do contador, grava `DETECTADA`). ⚠ Se um dia o contador ganhar uma porta
 * de declarar, esta leitura passa a mostrar a série dele como se fosse do cliente: quem construir
 * aquela porta precisa marcar de quem é a declaração, e voltar aqui.
 */
export function saidasDoClienteNoFluxo(meses) {
  const porId = new Map();
  for (const mes of Array.isArray(meses) ? meses : []) {
    for (const l of Array.isArray(mes?.linhas) ? mes.linhas : []) {
      const ehAvulsa = l?.base?.doCliente === true;
      const ehDeclarada = l?.fonte === FONTE.SERIE_DESPESA && l?.base?.origem === "DECLARADA";
      if (!ehAvulsa && !ehDeclarada) continue;
      const id = l?.referencia?.id;
      if (!id) continue;

      const chave = String(id);
      const atual = porId.get(chave);
      if (atual) {
        atual.ocorrencias += 1;
        atual.total += Number(l.valor) || 0;
        continue;
      }
      porId.set(chave, {
        id: chave,
        tipo: ehAvulsa ? TIPO_DA_SAIDA.AVULSA : TIPO_DA_SAIDA.RECORRENTE,
        rotulo: l.rotulo || "Saída planejada",
        valor: Number(l.valor) || 0,
        total: Number(l.valor) || 0,
        ocorrencias: 1,
        competencia: l.competencia || null,
        dia: l.dia || null,
        // ⚠ Só a RECORRENTE tem periodicidade, e ela vem do servidor. Sem ela a tela diria "aparece
        // 8× nos próximos meses", que descreve a TABELA e não o compromisso — e são coisas
        // diferentes para quem se planeja. Ausente, o texto cai na contagem, que é o honesto.
        periodicidade: l?.base?.periodicidade || null,
        // ⚠⚠ DOIS VOCABULÁRIOS, UMA PERGUNTA. A avulsa manda `estadoDaSaida`
        // (PENDENTE|CONFIRMADA|RECUSADA) e a série manda `estadoDaSerie`
        // (PENDENTE|ATIVA|RECUSADA|SUSPENSA) — são tabelas diferentes, com vidas diferentes, e
        // colapsá-los num vocabulário só faria a tela do cliente inventar um estado que nenhum dos
        // dois serviços conhece. O que eles têm em comum é o **PENDENTE**: esperando a palavra do
        // contador. É só isso que esta tela precisa saber.
        //
        // ⚠⚠ AUSENTE LÊ COMO PENDENTE, e a escolha tem lado: errar para "pendente" mostra um botão
        // de remover que o servidor pode recusar (com o motivo na tela); errar para "confirmada"
        // ESCONDE o botão de quem ainda podia desfazer, e essa pessoa não tem outro caminho.
        estado: l?.base?.estadoDaSaida || l?.base?.estadoDaSerie || ESTADO_PENDENTE,
        pendente: (l?.base?.estadoDaSaida || l?.base?.estadoDaSerie || ESTADO_PENDENTE) === ESTADO_PENDENTE,
      });
    }
  }
  // ⚠ Ordem estável: a avulsa pela data, a recorrente pelo nome. Sem ela a lista se reordena a cada
  // recarga e o botão de remover troca de lugar embaixo do dedo.
  return [...porId.values()].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === TIPO_DA_SAIDA.AVULSA ? -1 : 1;
    if (a.tipo === TIPO_DA_SAIDA.AVULSA) {
      return `${a.competencia}-${String(a.dia).padStart(2, "0")}`
        .localeCompare(`${b.competencia}-${String(b.dia).padStart(2, "0")}`);
    }
    return String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR");
  });
}
