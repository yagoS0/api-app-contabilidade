/**
 * ⚠⚠ O LANÇAMENTO CONTÁBIL QUE NASCE SEM NINGUÉM CLICAR — o "nível 1" (29/08/2026).
 *
 * > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa, e todo mês
 * > que essa nota aparecer ela já é lançada em despesa."*
 *
 * ⚠⚠ **O QUE `motorDeSugestao.js` ESCREVEU SOBRE ISTO, ANTES DE EXISTIR:** *"um lançamento contábil
 * nascido sozinho, numa conta errada, erra EM SÉRIE e em silêncio — e o dono é contador. (…) O que
 * falta é a DECISÃO DO DONO de ligar, e o extrato mensal 'lançados por regra' para ele poder
 * desfazer em lote."* A decisão veio; o extrato está em `extratoDeLancadosPorRegra` abaixo, e ele
 * foi construído JUNTO porque o próprio módulo o nomeia como pré-requisito.
 *
 * ## ⚠⚠ AS TRÊS TRAVAS, E NENHUMA É DISPENSÁVEL
 *
 *   1. **a FLAG do ambiente** (`INTEGRACAO_LANCAMENTO_POR_REGRA`) — quem recusa é o SERVIDOR, não a
 *      tela: um `curl` passaria por cima de um botão escondido;
 *   2. **`regra.lancaSozinha`** daquele fornecedor — fornecedor a fornecedor, nunca a carteira
 *      inteira. O primeiro mês roda com um só, e o dono confere no extrato;
 *   3. **a FAIXA `valorMin`/`valorMax`** que o contador digitou — nota fora dela **cai na fila**,
 *      com a nota do motivo. Ela nunca lança e nunca some.
 *
 * ## ⚠⚠ A DATA É PRESUMIDA, E ISSO ESTÁ ESCRITO NO DADO
 *
 * `origemPagamento: PRESUMIDO_POR_REGRA` — declaração, nunca prova (`ehProvaDePagamento` devolve
 * `false`). **Eu recomendei contra a data fixa e o dono decidiu**; o que torna a decisão reversível:
 * a origem própria (que não se disfarça de afirmação do contador), o extrato com desfazer em lote,
 * e o débito do OFX que CORRIGE a data quando chegar — sem criar um segundo lançamento.
 *
 * ⚠ **NADA AQUI REESCREVE A MÁQUINA DE ESTADOS.** Quem contabiliza continua sendo
 * `DeclaradoService.aplicarTransicao`, com as guardas dela (mês fechado, forma do lançamento, conta
 * sintética). Este módulo decide QUEM passa e chama aquela — uma segunda contabilização aqui
 * divergiria da primeira na correção seguinte.
 */

import { prisma } from "../../infrastructure/db/prisma.js";
import { INTEGRACAO_LANCAMENTO_POR_REGRA } from "../../config.js";
import { aplicarTransicao } from "./DeclaradoService.js";
import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "./lib/estadosDeclarado.js";

/** ⚠ Por que uma nota NÃO foi lançada sozinha. Vocabulário FECHADO — vai para a fila e para o log. */
export const FORA_DO_AUTOMATICO = Object.freeze({
  DESLIGADO: "automatico_desligado",
  REGRA_NAO_LANCA: "regra_nao_lanca_sozinha",
  SEM_REGRA: "sem_regra_para_este_fornecedor",
  FORA_DA_FAIXA: "valor_fora_da_faixa_da_regra",
  SEM_DIA: "regra_sem_dia_de_lancamento",
  ESTADO_NAO_PERMITE: "estado_nao_permite",
});

export const FRASE_DO_FORA = Object.freeze({
  [FORA_DO_AUTOMATICO.DESLIGADO]:
    "O lançamento automático está desligado neste ambiente.",
  [FORA_DO_AUTOMATICO.REGRA_NAO_LANCA]:
    "Existe regra para este fornecedor, mas ela não está marcada para lançar sozinha.",
  [FORA_DO_AUTOMATICO.SEM_REGRA]:
    "Não há regra ativa para este fornecedor.",
  [FORA_DO_AUTOMATICO.FORA_DA_FAIXA]:
    "O valor desta nota ficou fora da faixa que a regra deste fornecedor aceita — ela continua na fila, esperando você.",
  [FORA_DO_AUTOMATICO.SEM_DIA]:
    "A regra está marcada para lançar sozinha, mas não diz em que dia do mês. A data não se arbitra.",
  [FORA_DO_AUTOMATICO.ESTADO_NAO_PERMITE]:
    "Esta linha não está num estado em que o lançamento possa acontecer.",
});

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * ⚠⚠ A DATA PRESUMIDA — o dia que o contador configurou, dentro da competência da nota.
 *
 * ⚠ **Dia maior que o mês tem** (31 em fevereiro) **vira o ÚLTIMO dia do mês**, nunca o primeiro do
 * mês seguinte: a competência do lançamento tem de continuar sendo a da nota, senão a despesa
 * migraria de mês sozinha.
 * ⚠⚠ ELA DEVOLVE UM `Date` **em UTC à meia-noite**, e não uma string — a máquina de estados exige
 * `v instanceof Date` (`ehData`), e a primeira versão devolvia `"2026-08-15"`: o lançamento seria
 * recusado com `data_de_pagamento_invalida`, ou seja, a automação nunca lançaria nada. **Foi o teste
 * da transição que pegou.**
 *
 * ⚠ O `Date` é construído por `Date.UTC`, nunca por `new Date("2026-08-15")` com fuso: a data é
 * CIVIL (um dia do calendário), e às 22h de Brasília o construtor devolveria outro dia.
 */
export function dataPresumida(competencia, dia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || "").trim());
  const d = Number(dia);
  if (!m || !Number.isInteger(d) || d < 1 || d > 31) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  // ⚠ `Date.UTC(ano, mes, 0)` devolve o último dia do mês `mes` — é aritmética de calendário, não
  // de fuso: nada aqui depende do relógio da máquina.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const escolhido = Math.min(d, ultimo);
  return new Date(Date.UTC(ano, mes - 1, escolhido));
}

/**
 * ⚠⚠ ESTA NOTA PODE SER LANÇADA SOZINHA? — e a resposta é sempre NOMEADA.
 *
 * ⚠ Regra PURA: sem banco, sem relógio. Ela devolve `{ pode, motivo, frase, regra }` — nunca um
 * booleano nu. O motivo é o que a fila mostra quando a nota FICA, e sem ele *"continua pendente"*
 * seria indistinguível de *"o sistema não olhou"*.
 */
export function podeLancarSozinho({ declarado, regras, ligado = INTEGRACAO_LANCAMENTO_POR_REGRA } = {}) {
  const nao = (motivo, regra = null) => ({ pode: false, motivo, frase: FRASE_DO_FORA[motivo], regra });

  if (!ligado) return nao(FORA_DO_AUTOMATICO.DESLIGADO);

  // ⚠ Só o que espera pagamento ou conferência. `CONTABILIZADO` já está no razão; `RECUSADO` foi uma
  // decisão do contador, e ressuscitá-lo por regra desfaria essa decisão.
  const estado = String(declarado?.estado || "");
  if (estado !== ESTADO.AGUARDANDO_PAGAMENTO && estado !== ESTADO.A_CONFERIR) {
    return nao(FORA_DO_AUTOMATICO.ESTADO_NAO_PERMITE);
  }

  const cnpj = soDigitos(declarado?.cnpjFornecedor);
  // ⚠⚠ A ÂNCORA AQUI É SÓ O CNPJ. A de descrição *se parece*; não identifica — e o que está em jogo
  // é um lançamento sem clique. O motor de SUGESTÃO usa as duas porque lá o contador confere.
  if (!cnpj) return nao(FORA_DO_AUTOMATICO.SEM_REGRA);

  const daEmpresa = (Array.isArray(regras) ? regras : []).filter((r) =>
    r && r.ativa !== false && !r.suspensaEm && soDigitos(r.cnpjFornecedor) === cnpj);
  if (!daEmpresa.length) return nao(FORA_DO_AUTOMATICO.SEM_REGRA);

  const lancadoras = daEmpresa.filter((r) => r.lancaSozinha === true);
  if (!lancadoras.length) return nao(FORA_DO_AUTOMATICO.REGRA_NAO_LANCA, daEmpresa[0]);

  const valor = numero(declarado?.valorAjustado) ?? numero(declarado?.valor);
  // ⚠ Sem valor não há faixa a conferir — e "não sei quanto é" nunca pode virar "pode lançar".
  if (valor == null) return nao(FORA_DO_AUTOMATICO.FORA_DA_FAIXA, lancadoras[0]);

  const naFaixa = lancadoras.find((r) => {
    const min = numero(r.valorMin);
    const max = numero(r.valorMax);
    return min != null && max != null && valor >= min && valor <= max;
  });
  // ⚠⚠ FORA DA FAIXA: a nota CAI NA FILA, com o motivo. Ela nunca lança e nunca some — e o motivo
  // diz que existe regra, para o contador saber que o sistema olhou.
  if (!naFaixa) return nao(FORA_DO_AUTOMATICO.FORA_DA_FAIXA, lancadoras[0]);

  // ⚠⚠ SEM DIA a regra não lança: a data não se arbitra. Um dia escolhido pelo sistema afirmaria
  // uma saída de caixa numa data que ninguém decidiu.
  const dia = Number(naFaixa.diaDoLancamento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return nao(FORA_DO_AUTOMATICO.SEM_DIA, naFaixa);
  }

  return { pode: true, motivo: null, frase: null, regra: naFaixa };
}

/**
 * ⚠⚠ LANÇA — e só isto escreve.
 *
 * ⚠ Ele NÃO reescreve a contabilização: chama `aplicarTransicao(CONFIRMAR)`, que já tem as guardas
 * de mês fechado, forma do lançamento e conta sintética. Uma segunda contabilização aqui divergiria
 * da primeira na correção seguinte — e a divergência sairia como lançamento errado no razão.
 *
 * ⚠⚠ **A DATA VAI PRESUMIDA, e a ORIGEM diz isso.** `PRESUMIDO_POR_REGRA` não é prova; o extrato do
 * banco a corrige quando chegar.
 */
export async function lancarPorRegra({
  portalClientId, declarado, regras, agora, client = prisma, ligado = INTEGRACAO_LANCAMENTO_POR_REGRA,
}) {
  const veredito = podeLancarSozinho({ declarado, regras, ligado });
  if (!veredito.pode) return { lancou: false, ...veredito };

  const dataPagamento = dataPresumida(declarado.competencia, veredito.regra.diaDoLancamento);
  if (!dataPagamento) {
    return { lancou: false, pode: false, motivo: FORA_DO_AUTOMATICO.SEM_DIA, frase: FRASE_DO_FORA[FORA_DO_AUTOMATICO.SEM_DIA], regra: veredito.regra };
  }

  const atualizado = await aplicarTransicao({
    portalClientId,
    declaradoId: declarado.id,
    transicao: TRANSICAO.CONFIRMAR,
    dados: {
      contaAplicada: veredito.regra.contaDestino,
      // ⚠ O crédito da regra, quando ela escolheu um. `null` mantém o caixa de hoje — a coluna
      // guarda "não escolheu", e o caminho antigo continua para ela.
      contaCredito: veredito.regra.contaCredito || undefined,
      dataPagamento,
      origemPagamento: ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
      regraId: veredito.regra.id,
    },
    // ⚠⚠ `usuarioId` NOMEIA A AUTOMAÇÃO, e não pode ser o id de uma pessoa: quem lançou foi a regra,
    // e atribuí-lo ao contador diria que ele praticou um ato que não praticou naquele mês.
    usuarioId: "regra_automatica",
    agora,
    client,
  });

  return { lancou: true, declarado: atualizado, regra: veredito.regra, dataPagamento };
}

/**
 * ⚠⚠ O LAÇO — quem chama `lancarPorRegra` na carteira de uma empresa (29/08/2026).
 *
 * ⚠ **O CHAMADOR É A VARREDURA DE NOTAS**, e o lugar foi escolhido pelo mesmo argumento da
 * auto-ativação das séries: `listarFila` é leitura, e o eixo daquele caminho é *"observar não
 * grava"*. A varredura é o passo em que o contador mandou **processar o que chegou** — escrita
 * explícita, com piso de papel. Uma nota que chega hoje é lançada na varredura de hoje.
 *
 * ⚠⚠ **AS TRÊS TRAVAS CONTINUAM SENDO DE `podeLancarSozinho`**, e nada aqui as repete: este laço
 * só escolhe QUEM perguntar. Reimplementar a decisão aqui daria duas regras que divergem na
 * primeira correção, e a divergência sai como lançamento contábil errado.
 *
 * ⚠ **A FLAG DESLIGADA NÃO CONSULTA O BANCO.** Com ela OFF a resposta é a mesma para toda linha, e
 * varrer a fila inteira para ouvir "desligado" 200 vezes seria custo puro.
 *
 * ⚠⚠ **UMA LINHA QUE FALHA NÃO PARA O LOTE, e volta NOMEADA** — mesma disciplina da varredura e do
 * desfazer. Uma nota em mês fechado não pode impedir que as outras vinte sejam lançadas; e um lote
 * que só dissesse "lancei 19" faria a vigésima sumir sem ninguém saber por quê.
 */
export async function lancarPorRegraNaEmpresa({
  portalClientId, agora, client = prisma, ligado = INTEGRACAO_LANCAMENTO_POR_REGRA,
}) {
  if (!ligado) {
    return { lancados: 0, ids: [], recusados: [], desligado: true };
  }

  const escopo = { portalClientId: String(portalClientId) };

  const [regras, candidatos] = await Promise.all([
    client.regraContabilizacao.findMany({ where: { ...escopo, ativa: true, lancaSozinha: true } }),
    // ⚠ Os MESMOS dois estados que `podeLancarSozinho` aceita. `CONTABILIZADO` já está no razão e
    // `RECUSADO` foi uma decisão do contador — ressuscitá-lo por regra desfaria essa decisão.
    client.lancamentoDeclarado.findMany({
      where: { ...escopo, estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR] } },
      orderBy: { dataDocumento: "asc" },
    }),
  ]);

  // ⚠ Sem regra marcada, nada a fazer — e a resposta continua sendo um relatório, nunca um silêncio.
  if (!regras.length) return { lancados: 0, ids: [], recusados: [], semRegraLancadora: true };

  const ids = [];
  const recusados = [];

  // ⚠ SEQUENCIAL, e sem parâmetro de concorrência: parâmetro é como alguém põe 20 nele depois, e
  // cada volta deste laço cria um lançamento contábil.
  for (const declarado of candidatos) {
    try {
      const r = await lancarPorRegra({ portalClientId, declarado, regras, agora, client, ligado });
      if (r.lancou) ids.push(declarado.id);
      // ⚠⚠ O QUE NÃO LANÇOU **NÃO É RECUSA**, e não entra na lista: a nota fora da faixa, a do
      // fornecedor sem regra e a que a regra não marcou **ficam na fila**, que é o desfecho certo.
      // Chamá-las de erro encheria o relatório de linhas normais e esconderia as de verdade.
    } catch (e) {
      recusados.push({
        declaradoId: declarado.id,
        codigo: e?.codigo || e?.code || "falhou",
        motivo: e?.frase || String(e?.message || e),
      });
    }
  }

  return { lancados: ids.length, ids, recusados };
}

/**
 * ⚠⚠ O EXTRATO DE "LANÇADOS POR REGRA" — o pré-requisito que o próprio `motorDeSugestao.js` nomeou.
 *
 * Sem ele, ligar a automação é ligar algo que ninguém consegue auditar: o contador veria os
 * lançamentos misturados no razão, sem saber quais nasceram sozinhos.
 *
 * ⚠ A pergunta que ele responde é *"o que entrou sem eu clicar neste mês?"* — por isso o recorte é
 * a COMPETÊNCIA, e o critério é a ORIGEM do pagamento (`PRESUMIDO_POR_REGRA`), nunca o `regraId`:
 * um lançamento que o contador confirmou À MÃO sobre uma nota com regra também tem `regraId`, e ele
 * não nasceu sozinho.
 */
export async function extratoDeLancadosPorRegra({ portalClientId, competencia, client = prisma }) {
  const linhas = await client.lancamentoDeclarado.findMany({
    where: {
      portalClientId: String(portalClientId),
      competencia: String(competencia),
      estado: ESTADO.CONTABILIZADO,
      origemPagamento: ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
    },
    select: {
      id: true, descricaoOriginal: true, cnpjFornecedor: true,
      valor: true, valorAjustado: true, competencia: true,
      dataPagamento: true, contaAplicada: true, regraId: true,
      accountingEntryId: true, decididoEm: true,
      /**
       * ⚠⚠ A PROVA DOCUMENTAL DA OCORRÊNCIA — decisão do dono, 01/09/2026:
       *
       * > *"no caso de não ter uma nota comprovando a ocorrência desse lançamento ela deve ser
       * > retirada da regra"*.
       *
       * A regra lança sozinha sobre o que chegou — e o que chegou pode ser uma NOTA (documento) ou
       * um débito de EXTRATO. A pergunta que o contador faz nesta tela é *"tem papel atrás disto?"*,
       * e sem estes dois campos ela não tem resposta: a tela mostraria valor e data sem dizer se
       * alguém emitiu alguma coisa.
       * ⚠ `notaRecebida` pode ser NULA mesmo com `origem: NOTA_RECEBIDA` — a FK é `SetNull`, e nota
       * apagada não apaga a despesa. As duas ausências são diferentes e a tela as distingue.
       */
      origem: true,
      notaRecebidaId: true,
      notaRecebida: { select: { numero: true, serie: true, type: true } },
    },
    orderBy: { dataPagamento: "asc" },
  });

  /**
   * ⚠⚠ A DESCRIÇÃO DO LANÇAMENTO vem do RAZÃO, não do declarado — dono, 01/09/2026 (*"descrição
   * vinda da nota ou OFX, descrição do lançamento"*): são DUAS colunas, de propósito.
   *
   * Hoje o histórico é o nome do fornecedor cru, igual à `descricaoOriginal`; mostrar as duas é o
   * que permite ver quando elas DIVERGIREM — e é a divergência que denuncia lançamento editado por
   * fora, ou regra escrevendo outra coisa.
   *
   * ⚠⚠ E ela responde uma segunda pergunta, mais cara: **o lançamento ainda existe?**
   * `accountingEntryId` NÃO tem FK (de propósito — ver o schema), então ele pode apontar para uma
   * linha apagada por fora. Sem esta leitura, a tela ofereceria "tirar" um lançamento que já não
   * está no razão, e a recusa só apareceria no clique.
   *
   * ⚠ Uma query para o lote inteiro (`id: { in: … }`), nunca uma por linha.
   */
  const ids = linhas.map((l) => l.accountingEntryId).filter(Boolean);
  const entries = ids.length
    ? await client.accountingEntry.findMany({
      where: { id: { in: ids }, portalClientId: String(portalClientId) },
      select: { id: true, historico: true, data: true },
    })
    : [];
  const doRazao = new Map(entries.map((e) => [e.id, e]));

  const comRazao = linhas.map((l) => {
    const e = l.accountingEntryId ? doRazao.get(l.accountingEntryId) : null;
    return {
      ...l,
      // ⚠ `null` quando não há lançamento no razão — nunca a `descricaoOriginal` no lugar dele. Uma
      // coluna preenchida por substituição diria que o razão contém algo que ele não contém.
      historicoDoLancamento: e?.historico ?? null,
      dataDoLancamento: e?.data ?? null,
      /**
       * ⚠⚠ TRÊS ESTADOS, e colapsá-los esconde o pior. `true` = está no razão · `false` = tinha id
       * e a linha SUMIU (apagada por fora) · `null` = nunca teve id. O segundo é o que a tela
       * precisa gritar: o extrato afirma um lançamento que não existe mais.
       */
      lancamentoNoRazao: l.accountingEntryId ? Boolean(e) : null,
    };
  });

  return {
    competencia: String(competencia),
    total: comRazao.length,
    // ⚠ A soma viaja porque é o número que o contador confere contra o razão. Ela é do que ESTE
    // extrato mostra — nunca "o total do mês", que seria outra coisa.
    valor: comRazao.reduce((s, l) => s + (numero(l.valorAjustado) ?? numero(l.valor) ?? 0), 0),
    /**
     * ⚠ QUANTOS NÃO TÊM DOCUMENTO ATRÁS. É a resposta direta ao pedido do dono, e ela viaja como
     * NÚMERO para a tela não precisar recontar — duas contagens da mesma coisa divergem.
     */
    semNota: comRazao.filter((l) => !l.notaRecebidaId).length,
    linhas: comRazao,
  };
}

/**
 * ⚠⚠ DESFAZER EM LOTE — e ele desfaz UM A UM, por dentro da máquina de estados.
 *
 * ⚠ Nada de `deleteMany` nem de SQL cru: cada linha volta por `aplicarTransicao(DESFAZER)`, que já
 * apaga o `AccountingEntry` na MESMA transação e recusa mês fechado. Um caminho próprio aqui
 * deixaria lançamento órfão no razão — o estrago que o desfazer transacional existe para impedir.
 *
 * ⚠⚠ **O QUE FALHA VOLTA NOMEADO, e o lote NÃO PARA.** Uma linha em mês fechado não pode impedir o
 * contador de desfazer as outras vinte; e um lote que só dissesse "desfiz 19" faria a vigésima
 * sumir sem ninguém saber por quê.
 */
export async function desfazerLancadosPorRegra({
  portalClientId, ids, usuarioId, agora, client = prisma,
}) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map((i) => String(i || "").trim()).filter(Boolean))];
  const desfeitos = [];
  const recusados = [];

  for (const id of lista) {
    try {
      await aplicarTransicao({
        portalClientId,
        declaradoId: id,
        transicao: TRANSICAO.DESFAZER,
        usuarioId,
        agora,
        client,
      });
      desfeitos.push(id);
    } catch (e) {
      recusados.push({ id, motivo: e?.codigo || e?.code || "falhou", frase: e?.frase || null });
    }
  }

  return { pedidos: lista.length, desfeitos: desfeitos.length, ids: desfeitos, recusados };
}
