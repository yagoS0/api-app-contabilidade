// O LOTE DE DANFSe — vários PDFs num zip, nomeados pelo CNPJ da empresa + o número da nota.
//
// > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote, com o nome dos arquivos
// > sendo o CNPJ da empresa + um número caso tenha mais notas da mesma empresa"* — e, na sequência,
// > *"quero o download no portal do cliente, e fazer o download dos DANFSe e não do XML."*
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A DIFERENÇA QUE DECIDIU O DESENHO: O DANFSe É GERADO, NÃO GUARDADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// O lote de XML que já existe no portal do escritório (`application/notas/download/
// NotasDownloadService.js`) zipa `PortalInvoice.xmlRaw`: o arquivo JÁ ESTÁ no banco, e zipar 200
// notas é ler 200 linhas. Aqui não — o DANFSe é gerado sob demanda e nunca salvo, então um lote de
// 200 são **200 gerações de PDF**, cada uma parseando o XML e desenhando o documento.
//
// ⚠ POR ISSO O CUSTO FOI MEDIDO ANTES DE ESCOLHER A FORMA (19/08/2026, Node 20, esta máquina,
// a amostra `docs/leiaute-nfse/nfse-nacional-substituicao.xml`):
//
//   • 1ª geração (fria, carrega fontes/qrcode) ......... 387 ms
//   • geração quente: mediana 35,5 ms · média 36,8 ms · p95 55,9 ms · máx 72,5 ms
//   • 100 notas ponta a ponta (com yield entre elas) ... 3.242 ms  (32,4 ms/nota)
//   • zipar as 100 (nível 9) .......................... 81 ms
//   • PDF resultante .................................. ~7,4 KB  (100 notas ⇒ 576 KB de zip)
//   • ⚠⚠ **pior travamento do event loop: 58 ms** — a parte SÍNCRONA de UMA geração
//
// ⚠ **É SÍNCRONO (a pessoa espera), e não um job em segundo plano.** Os 58 ms são o número que
// decide: com um `setImmediate` entre as notas, o lote nunca segura a API por mais que o tempo de
// UM PDF, então gerar 200 não congela o processo para os outros clientes — só custa ~58 ms de
// latência a quem estiver pedindo outra coisa no meio. Não há o que um job compre aqui:
//
//   1. **O job do escritório NÃO PODIA SER REUSADO.** Ele serializa tudo num lock global único
//      (`LOCK_ID = "notas_download_lock"`, TTL de 15 min). Se cada cliente do portal passasse por
//      ele, um cliente esperaria o lote de 12 meses × N empresas do CONTADOR terminar para baixar
//      10 notas — e desistiria depois de 5 tentativas de lock com a mensagem "outro download em
//      andamento". O job existe porque o escopo dele é grande de verdade (N empresas × 12 meses);
//      o do cliente é UMA empresa e UMA competência.
//   2. Um job custaria tabela nova (migração), disco (o volume do Railway é efêmero), expiração,
//      limpeza de órfão e polling na tela — tudo para um trabalho de ~3 s.
//   3. O IRMÃO DELE JÁ É SÍNCRONO: `GET /invoices/xml/bulk`, no MESMO router, já responde um zip
//      em streaming. Um lote de DANFSe assíncrono seria o estranho da casa.
//
// ⚠ E O ZIP VAI EM STREAMING (`archive.pipe(res)`), como o do XML: os bytes começam a sair no
// primeiro PDF pronto, então a conexão nunca fica ociosa esperando os outros 199.
//
// ⚠ O LIMITE EXISTE E TEM NOME. Ver `LOTE_MAXIMO`.

import { gerarDanfseDaNota } from "./danfseDaNotaDoPortal.js";

/**
 * ⚠⚠ O TETO DO LOTE — a recusa NOMEADA que substitui "o navegador caiu".
 *
 * 200 notas = 6,5 s de geração medidos aqui (32,4 ms/nota × 200), ~1,2 MB de zip. O teto não está
 * no que a máquina aguenta — ela aguenta muito mais —, está em **quanto tempo é honesto fazer
 * alguém esperar olhando para um botão sem barra de progresso**. Num servidor 3× mais lento que
 * esta máquina (fator de segurança escolhido, não medido — o Railway é vCPU compartilhada), 200
 * notas dão ~20 s; 500 (o teto do lote de XML) dariam ~50 s, e aí a espera vira "travou".
 *
 * ⚠ ELE RECUSA ANTES DE COMEÇAR, com `count()`, e por isso a recusa pode ser JSON: depois que o
 * primeiro byte do zip sai, não há mais como responder um erro. Quem estoura o teto recebe 400
 * `lote_muito_grande` dizendo **quantas foram encontradas** e **qual é o teto** — deixar o
 * navegador cair aos 300 seria exatamente a ausência descoberta contando arquivos.
 *
 * ⚠ Este número é um botão de ajuste apoiado numa medição, não uma lei física: subir é decisão do
 * dono, e o custo de subir é linear (32,4 ms por nota acrescentada).
 */
export const LOTE_MAXIMO = 200;

export const LOTE_ERRO = Object.freeze({
  MUITO_GRANDE: "LOTE_DANFSE_MUITO_GRANDE",
  VAZIO: "LOTE_DANFSE_VAZIO",
});

/** O relatório vai SEMPRE, com este nome. Ver `textoDoRelatorio`. */
export const NOME_DO_RELATORIO = "RELATORIO.txt";

/**
 * Sanitiza um pedaço de nome de arquivo.
 *
 * ⚠ Barra e dois-pontos num nome dentro de zip não são teoria: `a/b.pdf` vira uma PASTA `a` no
 * descompactador, e `..` sobe um nível. Mesma expressão de `routes/portalInvoices.js#safeFilePart`
 * e de `NotasDownloadService.js` — só `[\w.-]` sobrevive.
 */
export function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * O nome de UM arquivo no lote: `{CNPJ}_{número}.pdf`.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ O "NÚMERO" É O NÚMERO DA NOTA, E NÃO UM CONTADOR SEQUENCIAL — e isto é uma escolha, não
 * uma leitura literal do pedido. O dono disse *"o CNPJ da empresa + um número caso tenha mais
 * notas da mesma empresa"*. Um contador (`_1`, `_2`, `_3`) atenderia a letra e seria pior:
 *
 *   • ele é **instável**. Baixar a mesma competência duas vezes com um filtro diferente produz um
 *     `_3` apontando para OUTRA nota; quem arquivou o arquivo antigo passa a ter dois "3"
 *     diferentes, e nada no arquivo diz qual é qual;
 *   • ele **não é rastreável**. `12345678000199_3.pdf` não permite achar a nota no sistema;
 *     `12345678000199_13995.pdf` é a nota 13995 e ponto;
 *   • o número da NFS-e é **estável, único por emitente e fiscalmente significativo** — é por ele
 *     que o cliente e o contador conversam sobre a nota.
 *
 * ⚠ No portal do CLIENTE o CNPJ se repete em todos os arquivos (ele escolhe a empresa antes de
 * entrar, e o recorte padrão é `direcao=emitidas`), então o número é o que de fato distingue. O
 * CNPJ vem do EMITENTE de cada nota, com o da empresa como reserva: nos recortes `recebidas`/
 * `todas` o emitente é outro, e escrever o CNPJ da empresa num DANFSe alheio seria mentira.
 *
 * ⚠ NOTA SEM NÚMERO TEM RESPOSTA: cai na chave de acesso e, na falta dela, no id. Nunca fica sem
 * nome, e nunca dois arquivos ficam com o mesmo — ver `criarNomeadorDeLote`.
 */
export function nomeNoLote({ cnpj, numero, chaveAcesso, id }) {
  const doc = safeFilePart(String(cnpj || "").replace(/\D+/g, "")) || "sem-cnpj";
  const sufixo =
    safeFilePart(numero)
    || safeFilePart(chaveAcesso)
    || safeFilePart(id)
    || "sem-numero";
  return `${doc}_${sufixo}.pdf`;
}

/**
 * Um nomeador que GARANTE nomes distintos dentro do mesmo zip.
 *
 * ⚠⚠ POR QUE ISTO EXISTE. `archiver` aceita duas entradas com o mesmo nome sem reclamar, e a
 * maioria dos descompactadores fica com a última: uma nota **sobrescreveria a outra em silêncio**,
 * e a pessoa só descobriria contando arquivos. O número da NFS-e é único por emitente, então na
 * prática isto não deve disparar — mas "não deve" não é "não pode": duas notas sem número, ou uma
 * base com o mesmo número em séries diferentes, colidiriam.
 *
 * ⚠ A COLISÃO NÃO É SILENCIOSA. O segundo arquivo ganha `-2` **e** o nomeador devolve
 * `colidiu: true`, para que o relatório dentro do zip diga que aconteceu.
 *
 * @returns {(alvo: {cnpj?, numero?, chaveAcesso?, id?}) => {nome: string, colidiu: boolean}}
 */
export function criarNomeadorDeLote() {
  const usados = new Set([NOME_DO_RELATORIO.toLowerCase()]);
  return (alvo) => {
    const base = nomeNoLote(alvo);
    const chave = base.toLowerCase();
    if (!usados.has(chave)) {
      usados.add(chave);
      return { nome: base, colidiu: false };
    }
    const semExt = base.slice(0, -4); // ".pdf"
    for (let i = 2; i < 10000; i += 1) {
      const tentativa = `${semExt}-${i}.pdf`;
      if (!usados.has(tentativa.toLowerCase())) {
        usados.add(tentativa.toLowerCase());
        return { nome: tentativa, colidiu: true };
      }
    }
    /* c8 ignore next */
    throw new Error("Não foi possível nomear o arquivo do lote sem colidir.");
  };
}

/**
 * O motivo de uma nota NÃO ter virado PDF, em português, a partir do `code` que o serviço lança.
 *
 * ⚠ OS CÓDIGOS SÃO OS MESMOS DA PORTA INDIVIDUAL (`danfseDaNotaDoPortal.js` + `danfseHttp.js`).
 * O lote **espelha** as recusas; não afrouxa nenhuma. Em particular, `DANFSE_SEM_QRCODE` continua
 * sendo recusa: um DANFSe sem QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3), e um zip que o
 * incluísse entregaria ao tomador o documento inválido que aquele 503 existe para impedir.
 *
 * ⚠ MEDIDO EM PRODUÇÃO (19/08/2026, pelo dono): das 15.209 notas EMIT com XML, **0** estão sem
 * chave de acesso — ou seja, este guarda hoje não dispara sobre o dado real. Ele fica assim mesmo:
 * `0` hoje não é `0` para sempre, e nota capturada do ADN pode chegar diferente amanhã.
 */
export function motivoDaFalha(err) {
  const code = String(err?.code || "");
  if (code === "DANFSE_SEM_QRCODE") {
    return "o QR Code não pôde ser gerado, e um DANFSe sem QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3)";
  }
  if (code === "DANFSE_XML_INDISPONIVEL") {
    return "o XML desta nota não está guardado, e o DANFSe é gerado a partir dele";
  }
  if (code === "DANFSE_XML_NAO_E_NFSE" || code === "DANFSE_XML_VAZIO") {
    return "o XML guardado nesta nota não tem a forma de uma NFS-e";
  }
  if (code === "DANFSE_NOTA_NAO_ENCONTRADA") {
    return "a nota não foi encontrada nesta empresa";
  }
  const msg = String(err?.message || "").trim();
  return msg ? `falha inesperada: ${msg}` : "falha inesperada, sem motivo informado";
}

/** Rótulo curto de uma nota nas linhas do relatório. */
function rotuloDaNota(nota) {
  const numero = String(nota?.numero || "").trim();
  if (numero) return `nota ${numero}`;
  const chave = String(nota?.chaveAcesso || "").trim();
  if (chave) return `nota sem número (chave ${chave})`;
  return `nota sem número (id ${String(nota?.id || "?")})`;
}

/**
 * O RELATÓRIO QUE VAI DENTRO DO ZIP.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ELE VAI SEMPRE, inclusive quando tudo deu certo, e isso é deliberado. Um relatório que só
 * aparece quando há problema é indistinguível de um relatório que não foi gerado — a pessoa que
 * baixa 47 PDFs de 50 notas precisa poder abrir UM arquivo e ler quais três faltaram e por quê,
 * em vez de descobrir a ausência **contando arquivos**. Quando não falta nada, ele custa 300 bytes
 * e diz "50 de 50", que é a confirmação que o silêncio não dá.
 *
 * ⚠ ELE É A FORMA MAIS BARATA QUE CUMPRE A REGRA. Não há tela de pré-voo nem fluxo de conferência
 * antes de baixar: medido em produção, o cenário "nota que não gera" é raro (0 notas sem chave em
 * 15.209), e construir uma etapa de conferência para ele seria gastar a entrega no improvável.
 */
export function textoDoRelatorio({
  empresa,
  cnpj,
  competencia,
  direcao,
  geradas,
  falhas = [],
  colisoes = [],
  geradoEm = new Date(),
}) {
  const linhas = [];
  linhas.push("DANFSe em lote — relatório do download");
  linhas.push("=".repeat(60));
  linhas.push(`Empresa .......: ${empresa || "(sem razão social)"}`);
  linhas.push(`CNPJ ..........: ${cnpj || "(não informado)"}`);
  linhas.push(`Competência ...: ${competencia || "todas"}`);
  linhas.push(`Notas ..........: ${direcao || "emitidas"}`);
  linhas.push(`Gerado em .....: ${geradoEm.toISOString()}`);
  linhas.push("");
  const total = geradas + falhas.length;
  linhas.push(`PDFs neste zip ........: ${geradas}`);
  linhas.push(`Notas no filtro .......: ${total}`);
  linhas.push(`Notas SEM DANFSe ......: ${falhas.length}`);
  linhas.push("");

  if (!falhas.length) {
    linhas.push("Todas as notas do filtro geraram DANFSe. Nenhuma ficou de fora.");
  } else {
    // ⚠ A LISTA É O PONTO DO ARQUIVO. Sem ela, "3 notas ficaram de fora" seria tão inútil quanto
    // o silêncio: a pessoa não saberia QUAIS nem o que fazer a respeito.
    linhas.push("Estas notas NÃO geraram DANFSe:");
    linhas.push("");
    for (const f of falhas) {
      linhas.push(`  • ${rotuloDaNota(f.nota)} — ${f.motivo}`);
    }
    linhas.push("");
    linhas.push(
      "A ausência acima é resposta, não defeito: o sistema recusa em vez de entregar um documento"
    );
    linhas.push(
      "incompleto. Fale com o seu escritório de contabilidade sobre as notas listadas."
    );
  }

  if (colisoes.length) {
    linhas.push("");
    linhas.push("Nomes repetidos (o arquivo ganhou um sufixo para não sobrescrever o outro):");
    for (const c of colisoes) linhas.push(`  • ${c}`);
  }

  linhas.push("");
  return `${linhas.join("\r\n")}\r\n`;
}

/** Devolve o event loop entre as notas — ver o cabeçalho: 58 ms é o pior travamento aceito. */
function yieldEventLoop() {
  return new Promise((res) => setImmediate(res));
}

/**
 * Gera os DANFSe de uma lista de notas e os despeja num `archiver` já aberto.
 *
 * ⚠ ELE NÃO BUSCA AS NOTAS E NÃO AUTORIZA NADA. A lista chega pronta, já escopada pela empresa
 * (quem monta o filtro é `routes/portalInvoices.js`, com o MESMO `buildWhereFilters` da listagem —
 * se o lote tivesse o seu próprio filtro, o zip e a tela discordariam sobre o mesmo mês).
 *
 * ⚠ CADA PDF SAI DE `gerarDanfseDaNota`, o MESMO serviço da porta individual. Ele refaz a busca
 * com `{ id, clientId }` — de novo, por nota —, o que é redundante de propósito: é o que garante
 * que o lote não possa vazar a nota de outra empresa nem discordar da porta individual sobre a
 * marca d'água ou sobre uma recusa. As três consultas por nota custam muito menos que os 32 ms da
 * geração, e uma segunda implementação da regra é o defeito que esta casa já nomeou três vezes.
 *
 * @param {Object} params
 * @param {Array} params.notas — `{ id, numero, chaveAcesso, emitenteDoc, type }`, já escopadas
 * @param {string} params.portalClientId
 * @param {string} params.cnpjDaEmpresa — reserva quando a nota não traz `emitenteDoc`
 * @param {Object} params.archive — instância de `archiver` já pipeada
 * @param {Function} [params.gerar=gerarDanfseDaNota] — injetável para teste
 * @returns {Promise<{geradas: number, falhas: Array, colisoes: string[]}>}
 */
export async function gerarLoteDanfse({
  notas,
  portalClientId,
  cnpjDaEmpresa,
  archive,
  gerar = gerarDanfseDaNota,
}) {
  const nomear = criarNomeadorDeLote();
  const falhas = [];
  const colisoes = [];
  let geradas = 0;

  for (const nota of notas) {
    // ⚠ NF-e ENTRA NA CONTA E SAI NO RELATÓRIO, em vez de ser filtrada fora da consulta. A tela do
    // cliente mostra NF-e na mesma tabela; se o lote as removesse no SQL, a pessoa veria 50 linhas
    // e receberia 43 PDFs sem nada dizendo que as outras 7 não têm DANFSe. Este portal não gera
    // DANFE (o documento auxiliar da NF-e) — dizer isso é a resposta certa.
    if (String(nota?.type || "").toUpperCase() !== "NFSE") {
      falhas.push({
        nota,
        motivo: "é NF-e, e o documento auxiliar dela é o DANFE — este portal não o gera",
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const { pdf } = await gerar({ portalClientId, notaId: nota.id });
      const { nome, colidiu } = nomear({
        cnpj: nota.emitenteDoc || cnpjDaEmpresa,
        numero: nota.numero,
        chaveAcesso: nota.chaveAcesso,
        id: nota.id,
      });
      if (colidiu) colisoes.push(`${nome} (${rotuloDaNota(nota)})`);
      archive.append(pdf, { name: nome });
      geradas += 1;
    } catch (err) {
      falhas.push({ nota, motivo: motivoDaFalha(err) });
    }

    // eslint-disable-next-line no-await-in-loop
    await yieldEventLoop();
  }

  return { geradas, falhas, colisoes };
}
