// ⚠⚠ ESPELHO — ESTE ARQUIVO TEM UMA CÓPIA DELIBERADA NO PORTAL DO CLIENTE.
//
//   `apps/portal-cliente-web/src/features/notas/lib/danfseDaNota.js`
//
// ⚠⚠ OS CONTRATOS SÃO DIFERENTES, e é por isso que as PERGUNTAS divergem: o `serializeInvoice` do
// cliente **não traz `chaveAcesso`** — traz `type` e `hasXml`. Copiar esta versão para lá faria
// `podeGerarDanfse` ler um campo que nunca chega e desabilitar o botão em toda nota.
//
// ⚠ Os dois frontends NÃO compartilham código; a obrigação de sincronizar é de quem edita, e a
// tabela "mudou lá, muda aqui" vive em `apps/portal-cliente-web/CLAUDE.md`. ⚠ Duas leituras da
// mesma regra divergem na primeira correção — e a divergência aparece como as duas telas afirmando
// coisas diferentes sobre a MESMA empresa, que é o defeito mais caro de achar.
//
// ⚠ Este aviso foi acrescentado em 24/08/2026: até então **12 dos 13 originais eram mudos** sobre
// ter cópia, e a tabela do `CLAUDE.md` só é consultada por quem já sabe que ela existe.

// O DANFSe NA TELA — quando o botão existe, e o que a recusa quer dizer.
//
// ⚠ A FEATURE INTEIRA ESTAVA CONSTRUÍDA E SEM PORTA NA TELA.
// `GET /firm/companies/:id/notas/:notaId/danfse` gera o PDF no leiaute da NT 008 (com QR Code) e
// tem 50 testes de regressão no backend. Até 18/08/2026, `grep -rn "danfse" apps/web/src` devolvia
// **uma ocorrência, e era um comentário**. Este módulo e o bloco do `NotaDetailModal` são a porta.
//
// ⚠ A RECUSA COM 503 É DELIBERADA E TEM DE APARECER, COM O MOTIVO.
// Chave ausente no XML ou falha da biblioteca de QR ⇒ `danfse_sem_qrcode` + HTTP 503, porque
// *"um DANFSe sem QR Code não é um DANFSe"* (NT 008 §2.2 e §2.4.3): servi-lo em silêncio faria o
// contador mandar ao tomador um documento inválido achando que mandou o certo. Uma tela em branco
// ou um download vazio aqui seria a mesma mentira, do lado de cá.
//
// ⚠ O PDF É GERADO SOB DEMANDA E NUNCA SALVO — não há cache a limpar nem "regerar" a oferecer.
// Ele é inteiramente derivável do `xmlRaw`, que já está guardado; e o volume do Railway é efêmero
// ("registro existe, arquivo não" já é caso real com guias e SITFIS). Ver `apps/api/CLAUDE.md`.

export const MOTIVO_SEM_DANFSE = {
  NAO_E_NFSE: "nao_e_nfse",
  SEM_XML: "sem_xml",
};

/**
 * Esta nota pode gerar DANFSe?
 *
 * ⚠ O BOTÃO NÃO SOME — ele fica desabilitado DIZENDO POR QUÊ. Botão ausente é indistinguível de
 * "esta versão do app não tem DANFSe", e a diferença importa: "esta nota não tem o XML guardado" é
 * um fato sobre a NOTA, e se resolve recapturando.
 *
 * `xml.disponivel === false` é o caso real das 29 NF-e da base (nenhuma tem `xmlRaw`) e de qualquer
 * NFS-e antiga que tenha entrado sem o arquivo. ⚠ `truncadoPorTamanho` NÃO impede: o XML existe no
 * servidor, quem não o recebeu foi a tela — o PDF é gerado lá.
 */
export function podeGerarDanfse(nota) {
  if (!nota) return { pode: false, motivo: MOTIVO_SEM_DANFSE.SEM_XML, texto: "A nota ainda não carregou." };

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.NAO_E_NFSE,
      texto:
        "O DANFSe é o documento auxiliar da NFS-e. Esta é uma nota de venda (NF-e), cujo documento "
        + "auxiliar é o DANFE — que este portal não gera.",
    };
  }

  // O XML existe no servidor mesmo quando não coube na resposta: quem gera o PDF é ele.
  const temXml = Boolean(nota?.xml?.disponivel);
  if (!temXml) {
    return {
      pode: false,
      motivo: MOTIVO_SEM_DANFSE.SEM_XML,
      texto:
        "Não guardamos o XML desta nota, e o DANFSe é gerado a partir dele — nada aqui é "
        + "inventado. Recapture a nota para que o XML entre na base.",
    };
  }

  return { pode: true, motivo: null, texto: null };
}

/**
 * A recusa do servidor, traduzida sem inventar procedimento.
 *
 * ⚠ A MENSAGEM DO SERVIDOR VENCE. Ela já vem escrita por extenso (`bad(res, …, message)`); o texto
 * daqui só entra quando não veio nada. É a mesma regra de `rejeicaoDaEmissao.js`: código que esta
 * tela não conhece NÃO ganha um "tente de novo" fabricado.
 */
export function lerRecusaDanfse(err) {
  const codigo = String(err?.code || "").trim().toLowerCase();
  const mensagemDoServidor = String(err?.message || "").trim();
  const motivo = String(err?.motivo || err?.payload?.motivo || "").trim() || null;

  if (codigo === "danfse_sem_qrcode") {
    return {
      codigo,
      titulo: "O DANFSe não foi gerado — falta o QR Code.",
      texto:
        mensagemDoServidor
        || "O QR Code não pôde ser gerado para esta nota (a chave de acesso está ausente no XML "
           + "ou a geração falhou).",
      // ⚠ Isto NÃO é "tente de novo": é o motivo pelo qual a ausência é resposta.
      porQue:
        "Um DANFSe sem QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3): entregá-lo assim faria o "
        + "tomador receber um documento inválido. Por isso o servidor recusa em vez de mandar um "
        + "PDF incompleto.",
      motivo,
    };
  }

  if (codigo === "xml_indisponivel") {
    return {
      codigo,
      titulo: "Esta nota não tem o XML guardado.",
      texto: mensagemDoServidor || "O DANFSe é gerado a partir do XML da nota, e ele não está na base.",
      porQue: "Recapture a nota para que o XML entre na base.",
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

  return {
    codigo: codigo || null,
    titulo: "O DANFSe não foi gerado.",
    texto: mensagemDoServidor || "O servidor não devolveu o PDF e não disse por quê.",
    // Recusa desconhecida não ganha procedimento inventado.
    porQue: null,
    motivo,
  };
}

/**
 * O nome do arquivo. Espelha o `Content-Disposition` da rota (chave → número → id), com os mesmos
 * caracteres removidos — é o que faz o arquivo baixado ser reconhecível ao lado do XML da mesma nota.
 */
export function nomeDoArquivoDanfse(nota) {
  const base = String(nota?.chaveAcesso || nota?.numero || nota?.id || "nota").replace(/[^\w.-]/g, "");
  return `danfse-${base || "nota"}.pdf`;
}
