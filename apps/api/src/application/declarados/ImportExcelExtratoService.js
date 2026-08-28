// O IMPORT DE EXTRATO EM EXCEL DO CLIENTE.
//
// > Decisão do dono (27/08/2026): *"extrato pode e deve ser enviado em OFX ou EXCEL, no caso do
// > excel o contador precisa normalizar para ser consumido"* — e, sobre COMO: *"o contador mapeia
// > as colunas, e o mapeamento fica salvo por empresa"*.
//
// ## ⚠⚠ ESTE SERVIÇO NÃO IMPORTA NADA SEM UM MAPEAMENTO CONFIRMADO
//
// É a trava inteira da fase, e o que está em jogo é despesa lançada com a data no lugar do valor,
// ou com o sinal invertido, no razão do cliente. O sistema PROPÕE (a partir dos mesmos apelidos de
// cabeçalho que o import do escritório já usa) e uma PESSOA confirma, uma vez por formato de
// arquivo. Sem a linha confirmada, o envio devolve a proposta e **cria zero declarados**.
//
// ⚠ Por isso o retorno tem DOIS desfechos de sucesso, e eles não se parecem: `precisaDeMapeamento`
// (nada entrou, e o que falta é um clique do contador) × o relatório de importação. Um "0 novas"
// para os dois casos seria indistinguível de "este período já estava todo importado".
//
// ## ⚠ O QUE É REUSADO, e por quê
//
//   - a **leitura da planilha** segue `lerPlanilhaExtrato.js`, que por sua vez segue o molde de
//     `nfse/lote/lerPlanilhaLote.js`;
//   - a **gramática do dinheiro** é `lerValorDaPlanilha`, via `lerValorDoExtrato` — não existe um
//     segundo parser de moeda nesta casa;
//   - a **identidade da transação** é `lib/dedupeOfx.js`, a MESMA do OFX. Ver o bloco sobre o
//     dedupe entre formatos, abaixo;
//   - a **gravação** é `criarDeclarado`, o único caminho de escrita do módulo.
//
// ## ⚠⚠ O DEDUPE ATRAVESSA OS DOIS FORMATOS — quando a conta é conhecida
//
// A impressão digital do OFX (`OFXFP:conta:dia:valor:sinal:memo#ordinal`) é usada aqui **sem
// prefixo próprio**, e isso é deliberado: o cliente que mandar o mesmo período em OFX e em Excel
// não pode ver a mesma despesa duas vezes.
//
// ⚠ Ela só casa quando os DOIS lados sabem a conta bancária — o OFX a traz em `<BANKACCTFROM>`, e a
// planilha **não tem onde trazê-la**. Por isso a conta é campo do ENVIO (não do mapeamento: uma
// empresa pode ter duas contas no mesmo banco, com o mesmo formato de arquivo). Sem ela, a
// anomalia `SEM_CONTA_BANCARIA` já existente diz o que fica frouxo — e o relatório acrescenta o
// risco específico deste caminho, em `dedupeAtravessaFormatos`.

import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { DeclaradoRecusado, RECUSA_DO_SERVICO, criarDeclarado } from "./DeclaradoService.js";
import { ORIGEM, ORIGEM_PAGAMENTO } from "./lib/estadosDeclarado.js";
import { anomaliasDoExtrato, identidadesDoExtrato } from "./lib/dedupeOfx.js";
import { lerPlanilhaExtrato, MAX_LINHAS } from "./lib/lerPlanilhaExtrato.js";
import {
  LEITURA_DO_SINAL,
  PAPEL,
  assinaturaDoCabecalho,
  fraseDoErroDeMapeamento,
  lerSinalDaLinha,
  lerValorDoExtrato,
  proporMapeamento,
  validarMapeamento,
} from "./lib/mapeamentoDoExtrato.js";
import { lerCompetenciaDaPlanilha } from "../nfse/lote/celulasLote.js";

/** ⚠ Quantos exemplos de linha recusada voltam. A CONTAGEM é sempre a real. */
export const LIMITE_DE_EXEMPLOS = 50;

export const RECUSA_DO_EXCEL = Object.freeze({
  /** O cabeçalho não produziu assinatura — sem colunas não há formato a reconhecer. */
  SEM_ASSINATURA: "extrato_sem_assinatura",
  /**
   * ⚠ A tabela do mapeamento não existe no banco (migration não aplicada). Recusa NOMEADA, nunca
   * 500: sem a migration este caminho simplesmente não está disponível, e dizer isso é a resposta.
   */
  MAPEAMENTO_INDISPONIVEL: "mapeamento_indisponivel",
});

export const FRASE_DO_EXCEL = Object.freeze({
  [RECUSA_DO_EXCEL.SEM_ASSINATURA]:
    "Não conseguimos reconhecer as colunas desta planilha — a linha de cabeçalho veio vazia.",
  [RECUSA_DO_EXCEL.MAPEAMENTO_INDISPONIVEL]:
    "O envio de extrato em Excel ainda não está disponível neste ambiente. Envie o extrato em OFX ou fale com o seu contador.",
});

/** Por que uma linha não virou despesa. ⚠ Lista FECHADA, e nenhuma delas é silêncio. */
export const MOTIVO_DA_LINHA = Object.freeze({
  ENTRADA: "entrada",
  SINAL_DESCONHECIDO: "sinal_desconhecido",
  VALOR_ILEGIVEL: "valor_ilegivel",
  DATA_ILEGIVEL: "data_ilegivel",
  HISTORICO_VAZIO: "historico_vazio",
});

export const FRASE_DA_LINHA = Object.freeze({
  [MOTIVO_DA_LINHA.ENTRADA]: "É uma entrada (crédito), não uma despesa.",
  [MOTIVO_DA_LINHA.SINAL_DESCONHECIDO]:
    "Não deu para dizer se esta linha é entrada ou saída. Ela NÃO foi importada — confira a coluna de sinal ou o valor.",
  [MOTIVO_DA_LINHA.VALOR_ILEGIVEL]: "Não foi possível ler o valor desta linha.",
  [MOTIVO_DA_LINHA.DATA_ILEGIVEL]: "Não foi possível ler a data desta linha.",
  [MOTIVO_DA_LINHA.HISTORICO_VAZIO]:
    "Esta linha não tem descrição — sem ela a despesa não pode ser conferida.",
});

const recusar = (codigo) => {
  throw new DeclaradoRecusado(codigo, FRASE_DO_EXCEL[codigo] || "");
};

const celulaDe = (linha, indice) =>
  Number.isInteger(indice) && indice >= 0 ? linha.celulas[indice] : undefined;

/**
 * ⚠ A competência sai da DATA da transação — a mesma decisão do OFX, e pelo mesmo motivo: o extrato
 * não tem competência própria, e derivar é a única leitura possível (diferente da NOTA, onde deduzir
 * seria descartar dado real). ⚠ UTC, o critério de `utils/dataCivil.js`.
 */
const competenciaDaData = (d) =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 7) : null;

/**
 * ⚠⚠ TRADUZ A LINHA DA PLANILHA PARA A FORMA DE UMA TRANSAÇÃO DE OFX — e é isso que permite reusar
 * `identidadesDoExtrato` sem uma segunda regra de identidade.
 *
 * `fitId` é sempre `null`: planilha de banco não traz identificador de transação. Ou seja, este
 * caminho cai SEMPRE na impressão digital com ordinal — e o ordinal é o que preserva duas tarifas
 * iguais no mesmo dia, que sem ele colapsariam numa só e fariam uma despesa real sumir.
 */
export function transacaoDaLinha(linha, mapa) {
  const brutoValor = celulaDe(linha, mapa.colunas?.[PAPEL.VALOR]);
  const historico = String(celulaDe(linha, mapa.colunas?.[PAPEL.HISTORICO]) ?? "").trim();
  const valorLido = lerValorDoExtrato(brutoValor);
  const dataLida = lerCompetenciaDaPlanilha(celulaDe(linha, mapa.colunas?.[PAPEL.DATA]));
  const leitura = lerSinalDaLinha({
    sinal: mapa.sinal,
    valorBruto: brutoValor,
    celulaDeSinal: celulaDe(linha, mapa.colunas?.[PAPEL.SINAL]),
  });

  // ⚠ A ORDEM DAS RECUSAS IMPORTA para a frase ser útil: valor ilegível EXPLICA o sinal
  // desconhecido, então ele vem antes. Dizer "não sei se é entrada ou saída" quando o problema é o
  // valor mandaria o contador conferir a coluna errada.
  if (!valorLido.ok) return { ok: false, motivo: MOTIVO_DA_LINHA.VALOR_ILEGIVEL, numero: linha.numero };
  if (!dataLida.ok) return { ok: false, motivo: MOTIVO_DA_LINHA.DATA_ILEGIVEL, numero: linha.numero };
  if (!historico) return { ok: false, motivo: MOTIVO_DA_LINHA.HISTORICO_VAZIO, numero: linha.numero };
  if (leitura === LEITURA_DO_SINAL.DESCONHECIDO) {
    return { ok: false, motivo: MOTIVO_DA_LINHA.SINAL_DESCONHECIDO, numero: linha.numero };
  }
  if (leitura === LEITURA_DO_SINAL.ENTRADA) {
    return { ok: false, motivo: MOTIVO_DA_LINHA.ENTRADA, numero: linha.numero };
  }

  return {
    ok: true,
    numero: linha.numero,
    transacao: {
      fitId: null,
      data: dataLida.competencia,
      valor: valorLido.valor,
      sinal: "DEBITO",
      historico,
    },
  };
}

/**
 * ⚠ A tabela do mapeamento pode não existir (migration não aplicada). Isso NÃO pode virar 500 nem
 * derrubar a rota — é o mesmo tratamento que `listarTomadoresEmitidos` dá ao P2021.
 */
async function lerMapeamento(client, portalClientId, assinatura) {
  if (!client?.mapeamentoExtrato) return { indisponivel: true };
  try {
    return await client.mapeamentoExtrato.findUnique({
      where: { portalClientId_assinatura: { portalClientId: String(portalClientId), assinatura } },
    });
  } catch (e) {
    if (e?.code === "P2021") return { indisponivel: true };
    throw e;
  }
}

/**
 * Importa um extrato em Excel para a fila de conferência.
 *
 * @param {Buffer} args.buffer o arquivo
 * @param {string|null} args.contaBancaria ⚠ informada por quem envia — ver o bloco do dedupe
 * @param {Date} args.agora ⚠ injetado — este serviço não lê o relógio
 */
export async function importarExtratoExcelDoCliente({
  portalClientId,
  buffer,
  nomeArquivo = null,
  contaBancaria = null,
  aba = null,
  criadoPor,
  agora,
  client = prisma,
}) {
  const lido = lerPlanilhaExtrato(buffer, aba);
  if (!lido.ok) throw new DeclaradoRecusado(lido.codigo, lido.mensagem);

  const assinatura = assinaturaDoCabecalho(lido.cabecalhos);
  if (!assinatura) recusar(RECUSA_DO_EXCEL.SEM_ASSINATURA);

  const guardado = await lerMapeamento(client, portalClientId, assinatura);
  if (guardado?.indisponivel) recusar(RECUSA_DO_EXCEL.MAPEAMENTO_INDISPONIVEL);

  const mapa = guardado
    ? { colunas: guardado.colunas, sinal: guardado.sinal, confirmado: guardado.confirmado }
    : null;
  const validacao = validarMapeamento(mapa);

  if (!validacao.ok) {
    // ⚠⚠ NADA É IMPORTADO, E NADA É CONFIRMADO POR NÓS. A proposta é gravada como PROPOSTA
    // (`confirmado: false`) só para o contador achá-la na tela dele — e um mapeamento que JÁ EXISTE
    // não é sobrescrito: ele pode ter sido confirmado e depois invalidado por uma mudança de
    // formato, e apagar a decisão de uma pessoa por causa de um arquivo é o que este bloco impede.
    const proposta = proporMapeamento(lido.cabecalhos);
    if (!guardado) {
      await client.mapeamentoExtrato.create({
        data: {
          portalClientId: String(portalClientId),
          assinatura,
          colunas: proposta.colunas,
          sinal: proposta.sinal,
          cabecalhoVisto: lido.cabecalhos,
          confirmado: false,
        },
      });
    }
    return {
      precisaDeMapeamento: true,
      assinatura,
      cabecalhos: lido.cabecalhos,
      linhaDoCabecalho: lido.linhaDoCabecalho,
      certezaDoCabecalho: lido.certezaDoCabecalho,
      abas: lido.abas,
      aba: lido.aba,
      proposta,
      erros: validacao.erros.map((e) => ({ ...e, frase: fraseDoErroDeMapeamento(e.motivo) })),
      // ⚠ A AMOSTRA É O QUE TORNA A CONFIRMAÇÃO CONFERÍVEL. Sem ver linhas de verdade sob os nomes
      // das colunas, o contador confirma um mapeamento no escuro.
      amostra: lido.linhas.slice(0, 3).map((l) => ({ numero: l.numero, celulas: l.celulas })),
      totalDeLinhas: lido.linhas.length,
      criados: 0,
      jaImportadas: 0,
    };
  }

  const conta = contaBancaria ? { acctId: String(contaBancaria).trim() } : null;

  const lidas = lido.linhas.map((l) => transacaoDaLinha(l, guardado));
  const aceitas = lidas.filter((r) => r.ok);
  const rejeitadas = lidas.filter((r) => !r.ok);
  const foraDoEscopo = rejeitadas.filter((r) => r.motivo === MOTIVO_DA_LINHA.ENTRADA).length;
  // ⚠⚠ "NÃO DEU PARA LER" É COMPARTIMENTO PRÓPRIO, separado de "é entrada". A primeira é um fato
  // sobre o extrato (crédito não é despesa); a segunda é defeito do mapeamento ou do arquivo — e
  // some do relatório se as duas virarem um número só, que é como um mapeamento errado passaria
  // por "um extrato só de créditos".
  const naoLegiveis = rejeitadas.length - foraDoEscopo;

  const identidades = identidadesDoExtrato(aceitas.map((r) => r.transacao), conta);
  const anomalias = anomaliasDoExtrato(identidades, conta);

  const hashArquivo = crypto.createHash("sha256").update(buffer).digest("hex");
  // ⚠ INFORMATIVO. Achar não bloqueia — só permite a frase honesta ("você já subiu este arquivo").
  const anterior = await client.ofxImport.findFirst({
    where: { portalClientId: String(portalClientId), hashArquivo },
    orderBy: { criadoEm: "desc" },
    select: { id: true, criadoEm: true, criados: true, jaImportadas: true },
  });

  // ⚠⚠ A AMOSTRA É DAS NÃO LEGÍVEIS, NUNCA DAS ENTRADAS — e este `filter` foi achado por teste.
  // Sem ele a amostra e a contagem falavam de populações diferentes: `naoLegiveisTotal` já excluía
  // os créditos, e a lista os trazia. Num extrato com muitos recebimentos, a primeira linha exibida
  // seria "é uma entrada" — o compartimento que o campo existe para SEPARAR.
  const ilegiveis = rejeitadas.filter((r) => r.motivo !== MOTIVO_DA_LINHA.ENTRADA);
  const exemplos = ilegiveis.slice(0, LIMITE_DE_EXEMPLOS);

  const registro = await client.ofxImport.create({
    data: {
      portalClientId: String(portalClientId),
      formato: "EXCEL",
      mapeamentoExtratoId: guardado.id,
      hashArquivo,
      nomeArquivo: nomeArquivo ? String(nomeArquivo) : null,
      contaBancaria: conta?.acctId || null,
      bancoId: null,
      transacoesLidas: lido.linhas.length,
      criados: 0,
      jaImportadas: 0,
      descartadas: naoLegiveis,
      foraDoEscopo,
      detalhe: { anomalias, naoLegiveis: exemplos },
      criadoPor: String(criadoPor || ""),
      ...(agora instanceof Date && !Number.isNaN(agora.getTime()) ? { criadoEm: agora } : {}),
    },
    select: { id: true },
  });

  let criados = 0;
  let jaImportadas = 0;
  const recusadas = [];

  // ⚠ SEQUENCIAL, sem parâmetro de concorrência — parâmetro é como alguém põe 20 nele depois, e a
  // corrida entre dois uploads é justamente o que o `@@unique(portalClientId, hashDedupe)` pega.
  for (let i = 0; i < identidades.length; i += 1) {
    const { transacao: t, hashDedupe } = identidades[i];
    const numero = aceitas[i].numero;
    try {
      const r = await criarDeclarado({
        portalClientId,
        origem: ORIGEM.EXTRATO_EXCEL_CLIENTE,
        tipo: "SAIDA",
        valor: t.valor,
        competencia: competenciaDaData(t.data),
        descricaoOriginal: t.historico,
        // ⚠⚠ O DÉBITO DO EXTRATO **É** O PAGAMENTO — ele traz a data em que o dinheiro saiu, então
        // o declarado nasce `A_CONFERIR`, não `AGUARDANDO_PAGAMENTO`. A procedência é PROVA, e é um
        // valor SEPARADO do `OFX`: as duas provam, e não com a mesma força.
        dataPagamento: t.data,
        origemPagamento: ORIGEM_PAGAMENTO.EXTRATO_EXCEL,
        ofxImportId: registro.id,
        contaBancariaRef: conta?.acctId || null,
        hashDedupe,
        criadoPor,
        agora,
        client,
      });
      if (r.jaExistia) jaImportadas += 1;
      else criados += 1;
    } catch (e) {
      // ⚠ Uma linha recusada não derruba o extrato, e não some: vira linha nomeada.
      recusadas.push({
        numero,
        historico: t.historico,
        codigo: e?.codigo || "erro",
        motivo: e?.frase || String(e?.message || e),
      });
    }
  }

  await client.ofxImport.update({
    where: { id: registro.id },
    data: { criados, jaImportadas, detalhe: { anomalias, naoLegiveis: exemplos, recusadas } },
  });

  return {
    precisaDeMapeamento: false,
    importId: registro.id,
    assinatura,
    mapeamentoId: guardado.id,
    rotuloDoMapeamento: guardado.rotulo || null,
    aba: lido.aba,
    conta,
    transacoesLidas: lido.linhas.length,
    criados,
    jaImportadas,
    foraDoEscopo,
    // ⚠⚠ AMOSTRA E CONTAGEM SÃO CAMPOS DIFERENTES — o defeito que o OFX pagou: a contagem real ia
    // para a coluna e NÃO voltava, e quem escrevesse `naoLegiveis.length` na tela diria "50".
    naoLegiveis: exemplos.map((r) => ({ ...r, frase: FRASE_DA_LINHA[r.motivo] })),
    naoLegiveisTotal: naoLegiveis,
    naoLegiveisTruncadas: ilegiveis.length > LIMITE_DE_EXEMPLOS,
    recusadas,
    anomalias,
    // ⚠ O RISCO ESPECÍFICO DESTE CAMINHO, dito em vez de descoberto: sem a conta bancária, a
    // conferência de repetidos não alcança o MESMO débito que já tenha entrado por um OFX.
    dedupeAtravessaFormatos: Boolean(conta?.acctId),
    arquivoJaImportado: anterior
      ? { em: anterior.criadoEm, criadosNaquela: anterior.criados, jaImportadasNaquela: anterior.jaImportadas }
      : null,
  };
}

export { MAX_LINHAS, RECUSA_DO_SERVICO };
