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
    return { pode: false, motivo: MOTIVO_SEM_DANFSE.SEM_XML, texto: "A nota ainda não carregou." };
  }

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.NAO_E_NFSE,
      resumo: "Só NFS-e tem DANFSe.",
      texto:
        "O DANFSe é o documento auxiliar da NFS-e. Esta é uma nota de venda (NF-e), cujo documento "
        + "auxiliar é o DANFE — que este portal não gera.",
    };
  }

  // ⚠ ESTE RAMO EXISTE POR CAUSA DA OUTRA MUDANÇA DA MESMA ENTREGA. A nota que nós acabamos de
  // emitir aparece na lista antes de o ADN a devolver (`confirmadaPeloAdn: false`), e o id dela é
  // um `ServiceInvoice.id`: a rota do DANFSe lê `PortalInvoice` e responderia 404. Dizer isso é a
  // resposta certa; oferecer o botão para receber "nota não encontrada" seria a errada.
  if (nota.confirmadaPeloAdn === false) {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.NAO_CONFIRMADA,
      resumo: "Ainda não confirmada.",
      texto:
        "O DANFSe é gerado a partir do XML que o sistema nacional devolve, e esta nota ainda não "
        + "voltou de lá. Assim que a consulta trouxer a nota, o documento fica disponível.",
    };
  }

  if (!nota.hasXml) {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.SEM_XML,
      resumo: "Sem o XML guardado.",
      texto:
        "Não guardamos o XML desta nota, e o DANFSe é gerado a partir dele — nada aqui é "
        + "inventado. Fale com o seu escritório de contabilidade para recapturá-la.",
    };
  }

  return { pode: true, motivo: null, resumo: null, texto: null };
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
export function nomeDoArquivoDanfse(nota) {
  const base = String(nota?.numero || nota?.invoiceId || "nota").replace(/[^\w.-]/g, "");
  return `danfse-${base || "nota"}.pdf`;
}
