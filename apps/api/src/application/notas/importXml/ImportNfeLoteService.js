// IMPORT DO LOTE DE NF-e DO FISCO FÁCIL — o caminho pelo qual a nota de VENDA entra no sistema.
//
// ═══ POR QUE ISTO EXISTE, e por que NÃO é integração ═══════════════════════════════════════════
//
// A NT 2014.002 §3 dá acesso, no NFeDistribuiçãoDFe, aos documentos *"que NÃO tenham sido gerados
// por ele"* [o consulente]; a tabela normativa marca **"Emitente: Não"** para NF-e e para Resumo, e
// o §3.7 é literal: *"Para o emitente a NF-e NÃO será disponibilizada nesta consulta."* Ou seja: a
// nota que a empresa EMITIU não vem por API nenhuma — nem SEFAZ, nem ADN. Medido na base:
// 47 NF-e, 100% recebidas, ZERO emitidas. Não é defeito de captura; é o desenho da norma.
//
// O caminho oficial é o **Fisco Fácil** (SEFAZ-RJ, "Extrator de Documentos Fiscais Eletrônicos"):
// o dono pede o lote lá, baixa o(s) ZIP(s) e sobe AQUI. ⚠ Não proponha alternativa de captura.
//
// ⚠⚠ NADA NESTE ARQUIVO CHAMA A SEFAZ OU O ADN. Consulta indevida devolve cStat 656 e BLOQUEIA o
// CNPJ por uma hora (`apps/api/CLAUDE.md`, "a janela de 1 hora mora dentro de syncDfeForCompany").
// Este import lê arquivo e escreve no banco — zero I/O externo, inclusive nos testes.
//
// ═══ O RELATÓRIO É REQUISITO, NÃO ENFEITE ═════════════════════════════════════════════════════
//
// O lote pode vir **legitimamente vazio** — o portal tem o estado "Processada sem resultado" — e
// sempre tem defasagem mínima de 10 dias (carência). Sem os contadores, "não veio nada" e "deu
// erro" ficam idênticos na tela, e **ausência nunca é resposta** é regra escrita deste projeto.
// Por isso o retorno traz `importadas / duplicadas / ignoradas / recusadas`, o motivo de cada
// ignorada e — o número que responde à pergunta original — `emitidas` × `recebidas`.
//
// ⚠ O EVENTO QUE VEM NO ZIP É CONTADO, NÃO APLICADO. O extrator mistura `procEventoNFe` com as
// notas. Esta versão os IGNORA (pedido explícito: "ignorar com contagem e motivo, nunca derrubar o
// lote") — o que significa que uma nota CANCELADA depois da emissão entra e permanece
// `statusEfetivo: "autorizada"` até a captura/evento tratar disso. Por isso o relatório separa
// `eventosDeCancelamento`: o dono precisa VER que N cancelamentos vieram e não foram aplicados.
// Aplicá-los é decisão dele, e não foi feita aqui.

import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { prisma as prismaPadrao } from "../../../infrastructure/db/prisma.js";
import { upsertNfeFromParsed } from "../ingestaoNfe.js";
import { classificarDocumentoDoLote, MOTIVO, apenasDigitos } from "./loteNfe.js";
import { ehArquivoZip, percorrerZip, decodificarXml, MAX_BYTES_POR_ENTRADA } from "./zipLeitura.js";

// Teto de XML solto lido para a memória. O ZIP não passa por aqui (é lido por stream, entrada a
// entrada) — este limite vale só para o arquivo `.xml` avulso.
const MAX_BYTES_XML_SOLTO = MAX_BYTES_POR_ENTRADA;

// Quantos motivos individuais o relatório carrega. Acima disso o AGREGADO continua exato (é ele
// que o dono lê); só a lista item a item para de crescer, para o JSON não virar o lote inteiro.
const MAX_DETALHES = 200;

const TP_EVENTO_CANCELAMENTO = "110111";

function novoResultado() {
  return {
    importadas: 0,
    duplicadas: 0,
    ignoradas: 0,
    recusadas: 0,
    documentos: 0,
    emitidas: 0,
    recebidas: 0,
    eventosDeCancelamento: 0,
    motivos: {},
    arquivos: [],
    detalhes: [],
    detalhesTruncados: false,
  };
}

function contarMotivo(res, motivo) {
  res.motivos[motivo] = (res.motivos[motivo] || 0) + 1;
}

function anotar(res, detalhe) {
  if (res.detalhes.length >= MAX_DETALHES) {
    res.detalhesTruncados = true;
    return;
  }
  res.detalhes.push(detalhe);
}

/**
 * Importa um lote de NF-e do Fisco Fácil.
 *
 * @param {Object}   opts
 * @param {string}   opts.portalClientId
 * @param {string}   opts.cnpjEmpresa      CNPJ do ESTABELECIMENTO (14 dígitos) — ver abaixo
 * @param {Array}    opts.arquivos         [{ nome, caminho }] — ZIP ou XML, já em disco
 * @param {Object}   [opts.db]             prisma (injetável no teste)
 * @param {Object}   [opts.log]
 */
export async function importarLoteNfe({ portalClientId, cnpjEmpresa, arquivos, db = prismaPadrao, log = null }) {
  const res = novoResultado();
  const empresa = apenasDigitos(cnpjEmpresa);

  // ⚠ SEM O CNPJ DA EMPRESA NÃO SE IMPORTA NADA. Ele é o ÚNICO jeito de medir o `papel`; sem ele
  // toda nota cairia no default proibido. Recusar o lote inteiro é a resposta certa — importar
  // "sem papel" encheria a base de linhas que ninguém consegue classificar depois.
  if (!empresa) {
    return { ...res, ok: false, erro: "empresa_sem_cnpj" };
  }

  // Dedup DENTRO do próprio envio: o dono pode subir dois ZIPs com janelas que se sobrepõem, e a
  // mesma chave apareceria duas vezes. Sem isto, a segunda seria contada como "importada" (o banco
  // a trata como update) e o relatório mentiria sobre quantas notas novas entraram.
  const chavesDoEnvio = new Set();

  for (const arquivo of arquivos || []) {
    const linha = {
      nome: arquivo.nome,
      tipo: null,
      documentos: 0,
      importadas: 0,
      duplicadas: 0,
      ignoradas: 0,
      recusadas: 0,
      erro: null,
    };
    try {
      const zip = await ehArquivoZip(arquivo.caminho);
      linha.tipo = zip ? "zip" : "xml";
      if (zip) {
        for await (const entrada of percorrerZip(arquivo.caminho)) {
          await processarDocumento({
            res, linha, db, log, portalClientId, empresa, chavesDoEnvio,
            arquivo: arquivo.nome,
            documento: entrada.nome,
            texto: entrada.texto,
            erroLeitura: entrada.erro || null,
          });
        }
      } else {
        const { size } = await stat(arquivo.caminho);
        if (size > MAX_BYTES_XML_SOLTO) {
          linha.erro = "arquivo_grande_demais";
        } else {
          const texto = decodificarXml(await readFile(arquivo.caminho));
          await processarDocumento({
            res, linha, db, log, portalClientId, empresa, chavesDoEnvio,
            arquivo: arquivo.nome,
            documento: arquivo.nome,
            texto,
            erroLeitura: null,
          });
        }
      }
    } catch (err) {
      // ⚠ UM ARQUIVO RUIM NÃO DERRUBA O LOTE — mas ele também não some. O erro fica NA LINHA do
      // arquivo, e o resto do envio continua.
      linha.erro = err?.codigo || "arquivo_ilegivel";
      log?.warn?.({ err, arquivo: arquivo.nome }, "Falha ao ler arquivo do lote de NF-e");
    }
    res.arquivos.push(linha);
  }

  // ⚠ VAZIO É RESPOSTA, e ela tem nome próprio. O Fisco Fácil devolve "Processada sem resultado"
  // quando não há documento no período — e o portal só disponibiliza com ~10 dias de carência.
  // Sem esta marca, zero documento e falha de leitura ficariam indistinguíveis na tela.
  res.loteVazio = res.documentos === 0 && res.arquivos.every((a) => !a.erro);
  res.ok = true;
  return res;
}

async function processarDocumento({
  res, linha, db, log, portalClientId, empresa, chavesDoEnvio, arquivo, documento, texto, erroLeitura,
}) {
  res.documentos += 1;
  linha.documentos += 1;

  const ignorar = (motivo, detalhe) => {
    res.ignoradas += 1;
    linha.ignoradas += 1;
    contarMotivo(res, motivo);
    anotar(res, { arquivo, documento, resultado: "ignorada", motivo, detalhe: detalhe ?? null });
  };

  if (erroLeitura) return ignorar(MOTIVO.ENTRADA_ILEGIVEL, erroLeitura);
  if (/\.zip$/i.test(String(documento || ""))) return ignorar(MOTIVO.ZIP_ANINHADO, null);

  const decisao = classificarDocumentoDoLote(texto, { cnpjEmpresa: empresa });

  if (decisao.decisao === "ignorar") {
    if (decisao.motivo === MOTIVO.EVENTO && decisao.tpEvento === TP_EVENTO_CANCELAMENTO) {
      res.eventosDeCancelamento += 1;
    }
    return ignorar(decisao.motivo, decisao.detalhe);
  }

  if (decisao.decisao === "recusar") {
    res.recusadas += 1;
    linha.recusadas += 1;
    contarMotivo(res, decisao.motivo);
    anotar(res, {
      arquivo, documento, resultado: "recusada",
      motivo: decisao.motivo, detalhe: decisao.detalhe ?? null, chaveAcesso: decisao.chaveAcesso || null,
    });
    return undefined;
  }

  // Mesma chave duas vezes no MESMO envio (dois ZIPs com janelas sobrepostas).
  if (chavesDoEnvio.has(decisao.chaveAcesso)) {
    res.duplicadas += 1;
    linha.duplicadas += 1;
    contarMotivo(res, "duplicada_no_envio");
    anotar(res, { arquivo, documento, resultado: "duplicada", motivo: "duplicada_no_envio", chaveAcesso: decisao.chaveAcesso });
    return undefined;
  }
  chavesDoEnvio.add(decisao.chaveAcesso);

  try {
    // ⚠ A PERSISTÊNCIA É A MESMA DA CAPTURA — `../ingestaoNfe.js`, a função que
    // `dfe/DfeSyncService.js` chama. Uma segunda implementação aqui é o defeito já pago na NFS-e:
    // as duas gravações discordaram na chave de dedup e o FATURAMENTO SOMOU A NOTA DUAS VEZES
    // (`apps/api/CLAUDE.md`, "UMA ingestão só"). Uma transação por documento: nota e itens entram
    // juntos ou não entram.
    const r = await db.$transaction(async (tx) => upsertNfeFromParsed(tx, {
      portalClientId,
      parsed: decisao.parsed,
      items: decisao.items,
    }));

    if (r?.skipped) {
      return ignorar(MOTIVO.SEM_CHAVE, r.reason || null);
    }
    if (r?.existia) {
      res.duplicadas += 1;
      linha.duplicadas += 1;
      anotar(res, { arquivo, documento, resultado: "duplicada", motivo: "ja_estava_na_base", chaveAcesso: decisao.chaveAcesso, notaId: r.notaId });
    } else {
      res.importadas += 1;
      linha.importadas += 1;
    }
    // ⚠ O NÚMERO QUE RESPONDE À PERGUNTA ORIGINAL. "47 notas, 100% recebidas, zero emitidas" foi o
    // que motivou este import; `emitidas` é o que prova que ele funcionou. Conta a nota de venda
    // mesmo quando ela já estava na base — a pergunta é sobre o LOTE, não sobre o delta.
    if (decisao.papel === "EMIT") res.emitidas += 1;
    else res.recebidas += 1;
  } catch (err) {
    res.ignoradas += 1;
    linha.ignoradas += 1;
    contarMotivo(res, "falha_ao_gravar");
    anotar(res, { arquivo, documento, resultado: "ignorada", motivo: "falha_ao_gravar", chaveAcesso: decisao.chaveAcesso });
    log?.warn?.({ err, arquivo, documento }, "Falha ao gravar NF-e do lote");
  }
  return undefined;
}

/**
 * A frase do relatório. ⚠ Ela mora AQUI, e não na tela, porque é a mesma frase que precisa sair no
 * log e na resposta da API — e porque "importadas 0" tem DOIS significados, que só o servidor
 * distingue: lote vazio de verdade (o portal respondeu "Processada sem resultado") × lote cheio de
 * documento que não é nota nossa.
 */
export function textoDoResultado(res) {
  if (!res?.ok) return `Não foi possível importar o lote (${res?.erro || "erro"}).`;
  if (res.loteVazio) {
    return "O lote não trouxe nenhum documento. Isso é uma resposta possível do Fisco Fácil "
      + "(\"Processada sem resultado\") — e o portal só disponibiliza documentos com cerca de "
      + "10 dias de carência.";
  }
  const partes = [
    `importadas ${res.importadas}`,
    `duplicadas ${res.duplicadas}`,
    `ignoradas ${res.ignoradas}`,
  ];
  if (res.recusadas > 0) partes.push(`recusadas ${res.recusadas}`);
  const detalheIgnoradas = Object.entries(res.motivos)
    .filter(([m]) => m !== "duplicada_no_envio")
    .map(([m, n]) => `${m}: ${n}`)
    .join(", ");
  const cauda = detalheIgnoradas ? ` (${detalheIgnoradas})` : "";
  return `${partes.join(" · ")}${cauda}. Emitidas ${res.emitidas} · recebidas ${res.recebidas}.`;
}
