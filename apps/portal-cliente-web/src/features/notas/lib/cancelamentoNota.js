// CANCELAR UMA NFS-e — a regra da tela. ⚠ ATO FISCAL IRREVERSÍVEL.
//
// > Decisão do dono (19/08/2026): *"esqueça substituir então, deixe apenas o cancelar."*
//
// ⚠⚠ NADA AQUI CANCELA. Quem cancela é `POST /client/companies/:id/notas/:notaId/cancelar`, que
// delega a `NfseService.sendEvent`. Este módulo responde três perguntas de tela: **esta nota pode
// ser cancelada?**, **este formulário está pronto para ser enviado?** e **o que o servidor
// recusou?**.
//
// ═══ ⚠⚠ A LISTA DE MOTIVOS É FECHADA, E É DO LEIAUTE — não é escolha de produto ═══════════════
//
// Fonte: XSD oficial versionado em
// `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01/`:
//   • `tiposEventos_v1.01.xsd:233` — o evento `e101101` declara `<cMotivo type="TSCodJustCanc">`
//   • `tiposSimples_v1.01.xsd:219` — `TSCodJustCanc` enumera **"1", "2", "9"** (UM caractere)
//
// ⚠ **NÃO CONFUNDIR COM `01…05, 99`**: aquela é a `TSCodJustSubst`, da SUBSTITUIÇÃO — escopo
// fechado. Mandar `"01"` num cancelamento é falha de schema.
//
// ⚠ **ESTA LISTA ESTÁ DUPLICADA, DE PROPÓSITO** — o original é
// `apps/api/src/application/nfse/motivosDeEvento.js`, e é ele que VALIDA (o servidor recusa o que
// não estiver lá, e devolve `motivosAceitos` na recusa). Aqui ela existe só para a tela poder
// oferecer os rótulos sem uma ida ao servidor. É o mesmo arranjo de `reaproveitarNota.js`,
// `consultaTomador.js` e `municipioIbge.js`: **mudou lá, muda aqui.**

import { ESCOPO } from "./impedimento";

export { ESCOPO };

export const MOTIVOS_CANCELAMENTO = Object.freeze([
  Object.freeze({ codigo: "1", rotulo: "Erro na emissão" }),
  Object.freeze({ codigo: "2", rotulo: "Serviço não prestado" }),
  Object.freeze({ codigo: "9", rotulo: "Outros" }),
]);

/** `TSMotivo` — `tiposSimples_v1.01.xsd:348` (`minLength=15`, `maxLength=255`). */
export const JUSTIFICATIVA = Object.freeze({ MIN: 15, MAX: 255 });

export const MOTIVO_NAO_CANCELAVEL = {
  NAO_E_NFSE: "nao_e_nfse",
  JA_CANCELADA: "ja_cancelada",
  NAO_CONFIRMADA: "nao_confirmada",
  /** Nós já mandamos cancelar; o ADN ainda não devolveu o evento. Ver `estadoDaLinhaDaNota.js`. */
  CANCELAMENTO_ENVIADO: "cancelamento_enviado",
  /** A nota foi emitida PARA a empresa. Cancelar é ato de quem emitiu. */
  RECEBIDA: "recebida",
};

/**
 * Esta nota pode ser cancelada por aqui?
 *
 * ⚠ O BOTÃO NÃO SOME — fica desabilitado dizendo por quê. Some quem não deve nada; aqui há
 * sempre algo a dizer.
 */
export function podeCancelar(nota, { cancelamentoEnviado = false, cnpjDaEmpresa = "" } = {}) {
  if (!nota) {
    return { pode: false, motivo: null, escopo: ESCOPO.NOTA, resumo: null, texto: "A nota ainda não carregou." };
  }

  // ⚠⚠ JÁ MANDAMOS CANCELAR ESTA NOTA NESTA SESSÃO. O servidor ainda responde "EMITIDA" (a lista
  // lê `PortalInvoice`, a projeção do ADN, e nós não a escrevemos — ver
  // `notasEmitidasNaoConfirmadas.js`). Sem esta guarda o botão continuaria clicável e a pessoa
  // mandaria o mesmo cancelamento duas vezes: o segundo volta recusado pelo sistema nacional e se
  // lê como "falhou", quando o primeiro tinha dado certo.
  if (cancelamentoEnviado) {
    return {
      pode: false,
      motivo: MOTIVO_NAO_CANCELAVEL.CANCELAMENTO_ENVIADO,
      escopo: ESCOPO.NOTA,
      resumo: "Cancelamento enviado.",
      texto:
        "O cancelamento já foi enviado ao sistema nacional. A lista mostra a nota como cancelada "
        + "assim que a consulta trouxer o evento.",
    };
  }

  if (String(nota.type || "").toUpperCase() !== "NFSE") {
    return {
      pode: false,
      motivo: MOTIVO_NAO_CANCELAVEL.NAO_E_NFSE,
      escopo: ESCOPO.NOTA,
      resumo: "Só NFS-e.",
      texto:
        "Este portal cancela apenas NFS-e. A NF-e de venda é capturada da SEFAZ e cancelada por "
        + "outro caminho.",
    };
  }

  // ⚠⚠ NOTA RECEBIDA NÃO SE CANCELA — pedido do dono (20/08/2026): *"as notas recebidas não devem
  // ter opção de emitir elas, nem cancelar. Nota recebida foi emitida PARA NÓS — não temos
  // controle sobre esse tipo de nota."*
  //
  // ⚠ CANCELAR É ATO DO EMITENTE: numa nota recebida quem emitiu foi o PRESTADOR, e o certificado
  // que assinaria o evento é o da empresa errada (a família do E0718). O sistema nacional
  // provavelmente recusaria — mas "provavelmente o servidor deles recusa" não é guarda, é sorte.
  //
  // ⚠ AS MESMAS DUAS FONTES DE `podeReaproveitar`, e na mesma ordem: `papel` (que passou a chegar
  // no contrato em 20/08/2026) e a comparação do CNPJ, que já funcionava sozinha antes disso e
  // continua cobrindo a nota cujo `papel` não veio.
  //
  // ⚠⚠ A GARANTIA NÃO É ESTA FUNÇÃO — é o servidor. `POST /client/companies/:id/notas/:id/cancelar`
  // recusa `nota_recebida` mesmo que alguém chame a rota direto. Isto aqui é a conveniência de não
  // oferecer um botão cuja única saída é a recusa.
  const docEmpresa = String(cnpjDaEmpresa ?? "").replace(/\D+/g, "");
  const docTomador = String(nota.tomador?.cnpjCpf ?? "").replace(/\D+/g, "");
  const docEmitente = String(nota.emitente?.cnpj ?? "").replace(/\D+/g, "");
  const recebida = String(nota.papel || "").toUpperCase() === "DEST"
    // ⚠ `docEmpresa` precisa existir: comparar "" com "" daria `true` e acusaria TODA nota.
    || (Boolean(docEmpresa) && docTomador === docEmpresa && docEmitente !== docEmpresa);
  if (recebida) {
    return {
      pode: false,
      motivo: MOTIVO_NAO_CANCELAVEL.RECEBIDA,
      escopo: ESCOPO.NOTA,
      resumo: "Nota recebida.",
      texto:
        "Esta nota foi emitida PARA a sua empresa — quem a emitiu foi o prestador do serviço. "
        + "O cancelamento é ato de quem emitiu, e só ele pode fazê-lo.",
    };
  }

  const situacao = String(nota.status || "").toUpperCase();
  if (situacao === "CANCELADA" || situacao === "SUBSTITUIDA") {
    return {
      pode: false,
      motivo: MOTIVO_NAO_CANCELAVEL.JA_CANCELADA,
      // ⚠ O chip da linha já diz "Cancelada", em cor própria. A frase seria a segunda vez.
      escopo: ESCOPO.NOTA,
      resumo: "Já cancelada.",
      texto: "Esta nota já não está válida — não há o que cancelar.",
    };
  }

  /**
   * ⚠⚠ A NOTA RECÉM-EMITIDA **PODE** SER CANCELADA — este ramo virou o contrário em 31/08/2026.
   *
   * > Dono: *"eu emiti duas notas em lote na sincrosat e não consigo cancelar elas após a emissão,
   * > as outras eu consigo, quero poder cancelar logo após a emissão, simples."*
   *
   * ⚠⚠ **A RAZÃO QUE ESTE RAMO DAVA ERA FALSA, e foi MEDIDA.** Ele dizia *"o cancelamento é
   * identificado pela CHAVE, que só existe depois que o sistema nacional devolve a nota"*. Em
   * 31/08/2026, contra produção: as duas notas emitidas naquele dia tinham `chaveAcesso`
   * preenchida **desde a emissão**. A chave estava lá; o que faltava era a ROTA procurá-la — ela
   * lia só `PortalInvoice`, e o id que esta lista mostra é um `ServiceInvoice.id`.
   *
   * ⚠ A rota passou a ler dos DOIS lados, como o DANFSe já fazia desde 24/08. O escopo continua
   * fechado por empresa lá (`companyId` resolvido antes do portão), e as guardas de nota recebida
   * e de NF-e continuam valendo — inclusive contra quem chamar a rota direto.
   *
   * ⚠ `MOTIVO_NAO_CANCELAVEL.NAO_CONFIRMADA` FICA no vocabulário: o servidor ainda pode recusar
   * assim (a nota emitida FORA do portal, que não tem `ServiceInvoice` nosso), e `lerRecusa` a
   * traduz. O que sai é a tela ADIVINHAR a recusa antes de perguntar.
   */
  return { pode: true, motivo: null, escopo: null, resumo: null, texto: null };
}

/**
 * O formulário está pronto?
 *
 * ⚠⚠ O MÍNIMO DA JUSTIFICATIVA APARECE **ANTES** DE A PESSOA DIGITAR, não como erro depois. É
 * exigência do leiaute nacional (não nossa), e descobri-la ao clicar em "Cancelar" — no formulário
 * de um ato irreversível — é o pior momento possível.
 */
export function conferirFormulario({ cMotivo, justificativa } = {}) {
  const texto = String(justificativa ?? "").trim();
  const erros = [];

  if (!MOTIVOS_CANCELAMENTO.some((m) => m.codigo === String(cMotivo ?? ""))) {
    erros.push({ campo: "cMotivo", texto: "Escolha o motivo do cancelamento." });
  }
  if (texto.length < JUSTIFICATIVA.MIN) {
    erros.push({
      campo: "justificativa",
      texto:
        `A justificativa precisa ter pelo menos ${JUSTIFICATIVA.MIN} caracteres `
        + `(${texto.length} até agora).`,
    });
  } else if (texto.length > JUSTIFICATIVA.MAX) {
    erros.push({
      campo: "justificativa",
      texto: `A justificativa pode ter no máximo ${JUSTIFICATIVA.MAX} caracteres (tem ${texto.length}).`,
    });
  }

  return { ok: erros.length === 0, erros };
}

/**
 * A recusa do servidor, traduzida sem inventar procedimento.
 *
 * ⚠⚠ `podeTentarDeNovo === false` É O CAMPO QUE DESABILITA O BOTÃO. Ele vem `false` **só** na
 * camada TRANSPORTE, em que o desfecho é DESCONHECIDO: o pedido saiu e a resposta não voltou, e a
 * nota **pode** estar cancelada. Convidar a repetir ali produz um segundo pedido que volta
 * recusado pelo sistema nacional — e quem lê conclui que o cancelamento falhou, quando ele tinha
 * dado certo.
 *
 * ⚠ A MENSAGEM DO SERVIDOR VENCE. Código que esta tela não conhece NÃO ganha um "tente de novo"
 * fabricado.
 */
export function lerRecusaCancelamento(err) {
  const codigo = String(err?.code || "").trim().toLowerCase();
  const corpo = err?.corpo || {};
  const mensagemDoServidor = String(err?.message || "").trim();
  // ⚠ `!== false` e não `?? true`: ausência do campo (contrato antigo, erro de rede) não pode
  // desabilitar o botão para sempre — mas `false` explícito tem de desabilitar.
  const podeTentarDeNovo = corpo.podeTentarDeNovo !== false;
  const camada = String(corpo.camada || "").toUpperCase() || null;

  if (camada === "TRANSPORTE") {
    return {
      codigo: codigo || null,
      camada,
      podeTentarDeNovo: false,
      titulo: "Não sabemos se a nota foi cancelada.",
      texto:
        mensagemDoServidor
        || "O pedido saiu daqui e a resposta do sistema nacional não voltou.",
      porQue:
        corpo.correcao
        || "NÃO envie o cancelamento de novo: consulte a situação da nota antes de decidir. Se ela "
           + "já estiver cancelada, um segundo pedido volta recusado e parece falha.",
      motivosAceitos: null,
    };
  }

  if (codigo === "c_motivo_invalido" || codigo === "c_motivo_required") {
    return {
      codigo,
      camada,
      podeTentarDeNovo: true,
      titulo: "O motivo do cancelamento não foi aceito.",
      texto: mensagemDoServidor || "Escolha um dos motivos da lista.",
      porQue: null,
      // A lista vem do LEIAUTE, e o servidor a devolve na recusa.
      motivosAceitos: Array.isArray(corpo.motivosAceitos) ? corpo.motivosAceitos : null,
    };
  }

  if (codigo === "justificativa_curta" || codigo === "justificativa_longa") {
    return {
      codigo,
      camada,
      podeTentarDeNovo: true,
      titulo: "A justificativa não foi aceita.",
      texto: mensagemDoServidor || "Reescreva a justificativa.",
      porQue: "É exigência do leiaute nacional, não deste portal.",
      motivosAceitos: null,
    };
  }

  if (codigo === "nota_ja_cancelada") {
    return {
      codigo,
      camada,
      podeTentarDeNovo: false,
      titulo: "Esta nota já consta cancelada.",
      texto: mensagemDoServidor || "Não há o que cancelar.",
      porQue: null,
      motivosAceitos: null,
    };
  }

  if (codigo === "nota_sem_chave") {
    return {
      codigo,
      camada,
      podeTentarDeNovo: false,
      titulo: "Esta nota não pode ser cancelada por aqui.",
      texto: mensagemDoServidor || "Não temos a chave de acesso desta nota.",
      porQue: "Fale com o seu escritório de contabilidade.",
      motivosAceitos: null,
    };
  }

  if (camada === "RECEITA") {
    return {
      codigo: codigo || null,
      camada,
      podeTentarDeNovo,
      titulo: "O sistema nacional recusou o cancelamento.",
      texto: mensagemDoServidor || "O pedido foi analisado e recusado.",
      porQue: corpo.correcao || null,
      motivosAceitos: null,
    };
  }

  return {
    codigo: codigo || null,
    camada,
    podeTentarDeNovo,
    titulo: "O cancelamento não foi feito.",
    texto: mensagemDoServidor || "O sistema não disse por quê.",
    porQue: corpo.correcao || null,
    motivosAceitos: null,
  };
}
