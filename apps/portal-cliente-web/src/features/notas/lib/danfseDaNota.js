// O DANFSe NA TELA DO CLIENTE — quando o botão funciona, e o que a recusa quer dizer.
//
// > Pedido do dono (19/08/2026): *"o DANFE da nota deve ser gerado"*.
//
// ⚠ NADA DE PDF É FEITO AQUI. O DANFSe (leiaute do Padrão Nacional, NT 008, com QR Code) é gerado
// pelo backend — `GET /client/companies/:companyId/notas/:notaId/danfse`, que delega ao MESMO
// serviço da porta do escritório. Este módulo só responde duas perguntas de tela: **este botão
// pode ser clicado?** e **o que o servidor recusou?**
//
// ⚠ ELE É O GÊMEO DE `apps/web/src/features/notas/lib/danfseDaNota.js`, e as perguntas divergem de
// propósito: o contrato do CLIENTE (`serializeInvoice`, em `routes/portalInvoices.js`) **não traz
// `chaveAcesso`** — traz `type` e `hasXml`. Copiar a versão do escritório sem olhar faria
// `podeGerarDanfse` ler um campo que nunca chega e desabilitar o botão em toda nota.

import { ESCOPO } from "./impedimento";

export { ESCOPO };

export const MOTIVO_SEM_DANFSE = {
  NAO_E_NFSE: "nao_e_nfse",
  SEM_XML: "sem_xml",
  NAO_CONFIRMADA: "nao_confirmada",
};

/**
 * Esta nota pode gerar DANFSe?
 *
 * ⚠ O BOTÃO NÃO SOME — ele fica desabilitado DIZENDO POR QUÊ. Botão ausente é indistinguível de
 * "esta versão do app não tem DANFSe", e a diferença importa: "esta nota não tem o XML guardado" é
 * um fato sobre a NOTA.
 *
 * @param {Object} nota — no contrato de `serializeInvoice` (`type`, `hasXml`, `confirmadaPeloAdn`)
 */
export function podeGerarDanfse(nota) {
  if (!nota) {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.SEM_XML,
      escopo: ESCOPO.NOTA,
      resumo: null,
      texto: "A nota ainda não carregou.",
    };
  }

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.NAO_E_NFSE,
      // ⚠ A coluna "Tipo" da linha já mostra NFE — a frase seria a terceira vez que a linha diz isso.
      escopo: ESCOPO.NOTA,
      resumo: "Só NFS-e tem DANFSe.",
      texto:
        "O DANFSe é o documento auxiliar da NFS-e. Esta é uma nota de venda (NF-e), cujo documento "
        + "auxiliar é o DANFE — que este portal não gera.",
    };
  }

  /**
   * ⚠⚠ A NOTA RECÉM-EMITIDA **PODE** GERAR DANFSe — e este ramo virou o contrário em 31/08/2026.
   *
   * > Dono: *"ao emitir a nota não consigo baixar a danfe, o que também deveríamos conseguir de
   * > imediato."*
   *
   * ⚠⚠ **A PREMISSA DESTE RAMO CAIU E NINGUÉM VOLTOU AQUI.** Ele dizia, com razão em 19/08: *"o id
   * dela é um `ServiceInvoice.id`, a rota do DANFSe lê `PortalInvoice` e responderia 404"*. Em
   * **24/08** a rota passou a ler dos DOIS lados — por um pedido do dono com estas palavras:
   * *"ao emitir a nota pelo portal do cliente preciso que a DANFE esteja imediatamente
   * disponível"*. O servidor foi consertado e a TELA continuou recusando o que ele serve.
   *
   * ⚠⚠ **E O `hasXml` NÃO VALE COMO GUARDA AQUI.** `serializeEmitidaNaoConfirmada` crava
   * `hasXml: false` de propósito, e o comentário de lá diz o que ele significa: *"não é 'não temos
   * o XML': é 'não há rota que o sirva por este id'"* — a rota do **XML** lê `PortalInvoice`. O XML
   * existe, em `ServiceInvoice.xml`, e é dele que o DANFSe sai. Manter o `hasXml` na frente trocaria
   * uma recusa errada por outra.
   *
   * ⚠ Por isso o botão passa a CLICAR e quem decide é o servidor: se o XML de lá for a DPS (a nota
   * recusada) ou faltar o QR Code, ele responde recusa NOMEADA e `lerRecusaDanfse` a mostra. É a
   * regra desta casa — o servidor recusa com nome, a tela não adivinha antes.
   */
  if (nota.confirmadaPeloAdn === false) {
    return { pode: true, motivo: null, escopo: null, resumo: null, texto: null };
  }

  if (!nota.hasXml) {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.SEM_XML,
      // ⚠ Só o DANFSe depende do XML — cancelar e reaproveitar não. Nada mais na linha diz isto.
      escopo: ESCOPO.ACAO,
      resumo: "Sem o XML guardado.",
      texto:
        "Não guardamos o XML desta nota, e o DANFSe é gerado a partir dele — nada aqui é "
        + "inventado. Fale com o seu escritório de contabilidade para recapturá-la.",
    };
  }

  return { pode: true, motivo: null, escopo: null, resumo: null, texto: null };
}

/**
 * A recusa do servidor, traduzida sem inventar procedimento.
 *
 * ⚠ A MENSAGEM DO SERVIDOR VENCE. Ela já vem escrita por extenso (`routes/danfseHttp.js`); o texto
 * daqui só entra quando não veio nada. Código que esta tela não conhece NÃO ganha um "tente de
 * novo" fabricado — mesma regra de `emitir/lib/desfechoEmissao.js`.
 */
export function lerRecusaDanfse(err) {
  const codigo = String(err?.code || "").trim().toLowerCase();
  const mensagemDoServidor = String(err?.message || "").trim();
  const motivo = String(err?.motivo || err?.corpo?.motivo || "").trim() || null;

  if (codigo === "danfse_sem_qrcode") {
    return {
      codigo,
      titulo: "O DANFSe não foi gerado — falta o QR Code.",
      texto:
        mensagemDoServidor
        || "O QR Code não pôde ser gerado para esta nota (a chave de acesso está ausente no XML "
           + "ou a geração falhou).",
      // ⚠⚠ ISTO NÃO É "tente de novo": é o motivo pelo qual a ausência é resposta. Um DANFSe sem
      // QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3) — entregá-lo assim faria o tomador receber
      // um documento inválido. Tela em branco ou "falha ao baixar" aqui esconderia exatamente o
      // que este 503 existe para dizer.
      porQue:
        "Um DANFSe sem QR Code não é um DANFSe: entregá-lo assim faria o seu cliente receber um "
        + "documento inválido. Por isso o sistema recusa em vez de mandar um PDF incompleto. "
        + "Fale com o seu escritório de contabilidade.",
      motivo,
    };
  }

  if (codigo === "xml_indisponivel") {
    return {
      codigo,
      titulo: "Esta nota não tem o XML guardado.",
      texto: mensagemDoServidor || "O DANFSe é gerado a partir do XML da nota, e ele não está na base.",
      porQue: "Fale com o seu escritório de contabilidade para recapturar a nota.",
      motivo,
    };
  }

  if (codigo === "xml_nao_e_nfse") {
    return {
      codigo,
      titulo: "O XML guardado não é uma NFS-e.",
      texto: mensagemDoServidor || "O arquivo guardado nesta nota não tem a forma de uma NFS-e.",
      porQue: null,
      motivo,
    };
  }

  if (codigo === "nota_nao_encontrada") {
    return {
      codigo,
      titulo: "Nota não encontrada.",
      texto: mensagemDoServidor || "Esta nota não foi encontrada nesta empresa.",
      porQue: null,
      motivo,
    };
  }

  return {
    codigo: codigo || null,
    titulo: "O DANFSe não foi gerado.",
    texto: mensagemDoServidor || "O sistema não devolveu o PDF e não disse por quê.",
    // Recusa desconhecida não ganha procedimento inventado.
    porQue: null,
    motivo,
  };
}

/**
 * O nome do arquivo. Espelha o `Content-Disposition` da rota, com os mesmos caracteres removidos —
 * é o que faz o arquivo baixado ser reconhecível.
 *
 * ⚠ O contrato do cliente não traz `chaveAcesso`, então aqui a base é o NÚMERO (o servidor tenta a
 * chave primeiro). Os dois nomes descrevem a mesma nota; nenhum deles é inventado.
 */
/**
 * ⚠⚠ ESTA NOTA PODE ENTRAR NO ZIP DO LOTE? — pergunta DIFERENTE de `podeGerarDanfse` (31/08/2026).
 *
 * As duas portas do DANFSe não alcançam a mesma população, e ignorar isso quebrou uma promessa:
 *
 * | porta | rota | acha a nota recém-emitida? |
 * |---|---|---|
 * | individual | `GET /notas/:id/danfse` | **sim** — lê `PortalInvoice` E `ServiceInvoice` (conserto de 24/08) |
 * | lote | `GET /invoices/danfse/bulk?ids=` | **não** — filtra `PortalInvoice` pelo mesmo `where` da listagem |
 *
 * ⚠⚠ **E ISTO É REGRESSÃO DE HOJE, DA MINHA MÃO.** Ao liberar o DANFSe da nota ainda não confirmada
 * (`confirmadaPeloAdn === false` ⇒ `pode: true`), ela passou a ser MARCÁVEL na seleção da página —
 * e `selecaoDeNotas.js` afirma, por escrito, que no escopo PÁGINA *"o que não gera nem pode ser
 * marcado: 'Baixar 3 DANFSe' é uma promessa que se cumpre"*. Marcadas 3, o zip vinha com 2, e a
 * ausente só aparecia abrindo o `RELATORIO.txt` lá dentro.
 *
 * ⚠ O botão INDIVIDUAL continua liberado — ele funciona. O que esta função faz é impedir que a nota
 * entre num zip que não pode carregá-la.
 */
export function podeEntrarNoLoteDeDanfse(nota) {
  if (!podeGerarDanfse(nota).pode) return false;
  // ⚠ `=== false` e não truthy: contrato antigo (e o app mobile) não mandam o campo, e ausência é
  // lida como CONFIRMADA em todo este módulo. Ver `podeGerarDanfse`.
  return nota?.confirmadaPeloAdn !== false;
}

export function nomeDoArquivoDanfse(nota) {
  const base = String(nota?.numero || nota?.invoiceId || "nota").replace(/[^\w.-]/g, "");
  return `danfse-${base || "nota"}.pdf`;
}
