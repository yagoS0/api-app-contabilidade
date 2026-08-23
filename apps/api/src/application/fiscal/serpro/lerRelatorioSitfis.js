// AS DUAS LEITURAS DO RELATÓRIO SITFIS, E QUEM VENCE QUANDO ELAS DISCORDAM.
//
// ── O DESENHO, EM UMA FRASE ─────────────────────────────────────────────────────────────────────
//
//   A leitura POSICIONAL vence quando fecha; quando não fecha, CAI PARA O TEXTO.
//
// ⚠⚠ `parseSitfisRelatorio.js` NÃO É LEGADO E NÃO PODE SER APAGADO. Ele é a SEGUNDA OPINIÃO, e o
// confronto entre as duas leituras é uma das TRÊS provas de fidelidade da leitura posicional (as
// outras duas moram dentro do extrator: cada palavra na faixa de UMA coluna, e tipo por coluna —
// ver `apps/pdf-reader/app/extractors/sitfis_posicional.py`). Apagar o parser de texto apagaria a
// prova, e o confronto deixaria de acontecer EM PRODUÇÃO, que é onde ele importa.
//
// ── POR QUE A POSICIONAL EXISTE (medido em 21/08/2026, sobre os 24 relatórios REAIS do banco) ───
//
// O parser de texto lê o PDF já achatado numa fila de linhas (uma célula por linha) e agrupa de N
// em N, então a rede de proteção dele é ARITMÉTICA (`dados % colunas === 0`). Isso deixa passar
// desalinhamento cujo tamanho seja múltiplo do número de colunas, e faz o cabeçalho do SIDA
// (`Inscrito em`, `Ajuizado em`, `Processo`, `Tipo de Devedor`) desabar para dentro dos dados.
// A leitura posicional tira as colunas da GEOMETRIA do PDF — a régua é a largura de um espaço da
// Courier (0,6 × corpo), não um limiar inventado.
//
// Resultado da prova, com o critério de aceite fixado pelo dono ANTES de rodar (*"um só dos 31
// diferente e a abordagem volta para a mesa"*):
//
//   | | texto (o que estava no ar) | posicional |
//   |---|---|---|
//   | tabelas certas | 31 | **31, IDÊNTICAS** |
//   | coluna trocada | 0 | **0** |
//   | blocos SIDA | 3 em linhas cruas | **viraram TABELA** — 15 inscrições em dívida ativa |
//
// ── AS INVARIANTES QUE ESTE MÓDULO EXISTE PARA NÃO DERRUBAR ─────────────────────────────────────
//
//  1. **A TABELA NUNCA SOME.** Bloco que a geometria não conferiu volta com as LINHAS CRUAS em
//     `naoInterpretado` e o motivo em `aviso`. Esconder passaria a impressão de "nada consta" —
//     o oposto do que se sabe.
//  2. **O CONFRONTO É POR DIAGNÓSTICO, e é o MESMO da prova.** `prova_sitfis_posicional.py` pareia
//     bloco a bloco e desiste do órgão quando `len(antes) != len(depois)`. Aqui é igual: órgão em
//     que as duas leituras não concordam no NÚMERO de blocos fica com os blocos do TEXTO, nomeando
//     o motivo. Nunca se mistura bloco de uma leitura com bloco de outra dentro do mesmo órgão.
//  3. **PERDER BLOCO DERRUBA A LEITURA.** É a direção que importa: a posicional pode ACRESCENTAR
//     leitura (bloco cru que virou tabela), nunca fazer um bloco desaparecer da tela.
//  4. **FALHA FECHADO.** Serviço fora do ar, resposta com forma inesperada, exceção — qualquer uma
//     delas cai para o texto, que é exatamente o que a produção mostrava antes. Nunca uma tabela
//     torta, nunca uma tela vazia.
//
// ⚠ O CABEÇALHO DO RELATÓRIO (data de emissão, CNPJ/nome do contribuinte) CONTINUA VINDO DO TEXTO.
// A leitura posicional ignora tudo que está antes do primeiro marco de órgão de propósito (dados
// cadastrais, quadro societário, certidão) — ela responde pelas TABELAS do diagnóstico, não pela
// capa. Por isso o envelope é o do parser de texto e só os `blocos` são substituídos.

import { PDF_READER_TIMEOUT_MS, PDF_READER_URL } from "../../../config.js";
import { postSitfisPosicional } from "../../../modules/pdfReader/pdfReader.service.js";
import { parseSitfisRelatorio } from "./parseSitfisRelatorio.js";

/** Chave gravada em `CompanyFiscalStatus.rawPayload`. Ver `montarRawPayloadComLeitura`. */
export const CHAVE_LEITURA_POSICIONAL = "leituraPosicional";

const ehArray = (v) => Array.isArray(v);
const ehTexto = (v) => typeof v === "string";

/**
 * A forma que a leitura posicional TEM de ter para ser aceita.
 *
 * ⚠ Não é paranoia: o payload atravessa HTTP e um dia alguém muda o extrator. Forma inesperada
 * aqui viraria `colunas`/`registros` indefinidos na tela do contador — ausência com cara de dado.
 * Qualquer desvio recusa o relatório INTEIRO e a produção continua exatamente como está hoje.
 */
function formaValida(relatorio) {
  if (!relatorio || typeof relatorio !== "object") return false;
  if (!ehArray(relatorio.diagnosticos)) return false;
  for (const d of relatorio.diagnosticos) {
    if (!d || typeof d !== "object") return false;
    if (!ehTexto(d.chave) || !d.chave) return false;
    if (!ehArray(d.blocos)) return false;
    for (const b of d.blocos) {
      if (!b || typeof b !== "object") return false;
      if (b.titulo != null && !ehTexto(b.titulo)) return false;
      if (!ehArray(b.descricao) || !ehArray(b.colunas) || !ehArray(b.registros)) return false;
      if (!ehArray(b.anotacoes) || !ehArray(b.naoInterpretado)) return false;
      for (const r of b.registros) {
        if (!r || typeof r !== "object" || ehArray(r)) return false;
      }
    }
  }
  return true;
}

/**
 * Junta as duas leituras. **Função PURA** — não fala com o banco, com o SERPRO nem com o
 * pdf-reader; é ela que os testes exercem.
 *
 * @param {object} opts
 * @param {string|null} opts.texto                 `CompanyFiscalStatus.texto` (o que a produção lê hoje)
 * @param {object|null} opts.posicional            o que `POST /sitfis/posicional` devolveu (ou null)
 * @returns {{ relatorio: object|null, leitura: string, motivo: string|null }}
 */
export function montarRelatorioSitfis({ texto, posicional }) {
  const doTexto = texto && String(texto).trim() ? parseSitfisRelatorio(texto) : null;

  if (!posicional) {
    return { relatorio: doTexto, leitura: "texto", motivo: "leitura posicional ausente" };
  }
  if (!formaValida(posicional)) {
    return { relatorio: doTexto, leitura: "texto", motivo: "leitura posicional com forma inesperada" };
  }

  // ⚠ Relatório antigo, salvo antes de guardarmos o texto: não há segunda opinião a confrontar.
  // A posicional entra INTEIRA — porque a alternativa é `relatorio: null`, e uma tabela lida pela
  // geometria é melhor que tela nenhuma. O que não se faz é fingir que houve confronto.
  if (!doTexto || !doTexto.temTexto) {
    return {
      relatorio: {
        emitidoEm: null,
        contribuinte: { cnpj: null, nome: null },
        diagnosticos: posicional.diagnosticos,
        naoInterpretado: [],
        temTexto: false,
      },
      leitura: "posicional",
      motivo: "sem texto salvo para confrontar",
    };
  }

  const porChave = new Map();
  for (const d of posicional.diagnosticos) porChave.set(d.chave, d);

  const motivos = [];
  let comPosicional = 0;
  const diagnosticos = doTexto.diagnosticos.map((d) => {
    const outro = porChave.get(d.chave);
    if (!outro) {
      motivos.push(`${d.chave}: a leitura posicional não encontrou este órgão`);
      return d;
    }
    const antes = d.blocos || [];
    const depois = outro.blocos || [];
    // INVARIANTE 2/3: mesmo critério da prova. Contagem diferente ⇒ o pareamento bloco a bloco
    // não é confiável, e um bloco poderia sumir da tela. Fica o texto, com o motivo nomeado.
    if (antes.length !== depois.length) {
      motivos.push(
        `${d.chave}: ${antes.length} bloco(s) no texto × ${depois.length} na posição`
      );
      return d;
    }
    comPosicional += 1;
    return { ...d, blocos: depois };
  });

  const leitura = comPosicional === 0
    ? "texto"
    : comPosicional === diagnosticos.length ? "posicional" : "mista";

  return {
    relatorio: { ...doTexto, diagnosticos },
    leitura,
    motivo: motivos.length ? motivos.join(" | ") : null,
  };
}

/**
 * Lê o PDF pela GEOMETRIA, chamando o serviço `pdf-reader` pelo MESMO caminho das guias.
 *
 * ⚠ **NUNCA LANÇA.** Devolve `{ relatorio: null, erro }` em toda falha — serviço não configurado,
 * fora do ar, timeout, 4xx/5xx, corpo inesperado. Quem chama cai para o texto (invariante 4).
 * Uma aba de situação fiscal não pode quebrar porque o parser de PDF está reiniciando.
 *
 * ⚠ **NÃO CHAMA O SERPRO.** O PDF já está guardado; reprocessá-lo custa ZERO chamada paga.
 */
export async function lerSitfisPosicional({ pdfBuffer, filename, requestId, logger } = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    return { relatorio: null, erro: "sem PDF para ler" };
  }
  const baseURL = String(PDF_READER_URL || "").trim();
  if (!baseURL) return { relatorio: null, erro: "PDF_READER_URL não configurada" };

  try {
    const res = await postSitfisPosicional({
      baseURL,
      contentBase64: pdfBuffer.toString("base64"),
      filename: filename || "sitfis.pdf",
      requestId,
      timeoutMs: PDF_READER_TIMEOUT_MS,
    });
    const body = res?.data;
    if (res?.status !== 200 || !body?.success || !body?.relatorio) {
      const primeiro = Array.isArray(body?.errors) && body.errors.length ? body.errors[0] : null;
      const erro = primeiro?.code
        ? `${primeiro.code}: ${primeiro.message || ""}`.trim()
        : `pdf-reader respondeu HTTP ${res?.status}`;
      logger?.warn?.({ status: res?.status, erro }, "SITFIS: leitura posicional não fechou (segue com o parser de texto)");
      return { relatorio: null, erro };
    }
    if (!formaValida(body.relatorio)) {
      return { relatorio: null, erro: "leitura posicional com forma inesperada" };
    }
    return { relatorio: body.relatorio, erro: null };
  } catch (err) {
    const erro = err?.message || String(err);
    logger?.warn?.({ err: erro }, "SITFIS: falha ao chamar a leitura posicional (segue com o parser de texto)");
    return { relatorio: null, erro };
  }
}

/**
 * Onde a leitura posicional é GUARDADA.
 *
 * ⚠ **Dentro de `CompanyFiscalStatus.rawPayload`, que já é `JSONB`, porque NÃO SE FAZ DDL EM
 * PRODUÇÃO.** Uma coluna nova exigiria migration; a chave nova no JSON já existente não exige
 * nada. O envelope do SERPRO fica INTACTO ao lado — a chave é acrescentada, nunca substitui.
 *
 * ⚠ Guarda-se a leitura POSICIONAL CRUA, nunca o relatório já fundido: a fusão é determinística e
 * refeita a cada leitura, e é ela que mantém o parser de texto rodando em produção como segunda
 * opinião. Gravar o resultado fundido congelaria o confronto e aposentaria a prova.
 */
export function montarRawPayloadComLeitura(rawPayload, relatorioPosicional) {
  const base = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  if (!relatorioPosicional) return rawPayload;
  return {
    ...base,
    [CHAVE_LEITURA_POSICIONAL]: {
      relatorio: relatorioPosicional,
      lidoEm: new Date().toISOString(),
    },
  };
}

/** Tira a leitura posicional de um `rawPayload` guardado. `null` quando não há. */
export function lerLeituraPosicionalGravada(rawPayload) {
  const guardado = rawPayload && typeof rawPayload === "object"
    ? rawPayload[CHAVE_LEITURA_POSICIONAL]
    : null;
  const relatorio = guardado?.relatorio;
  return formaValida(relatorio) ? relatorio : null;
}
