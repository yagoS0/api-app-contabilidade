// POR ONDE A GUIA SAI — a regra da TELA, pura.
//
// Sem React, sem `api`, sem relógio. Três perguntas, todas com resposta nomeada:
//   1. ao clicar "Liberar ao cliente", além do e-mail, tenta WhatsApp? (`decidirCanaisAoLiberar`)
//   2. como se resume, numa frase, o que aconteceu em cada canal? (`resumirDesfechoDosCanais`)
//   3. o que a tela oferece diante de um envio por WhatsApp que FALHOU? (`ofertaDeRetentativa`)
//
// ── ⚠ O E-MAIL NÃO MUDA ─────────────────────────────────────────────────────────────────────────
// "Liberar ao cliente" sempre fez duas coisas (libera ao app + e-mail) e continua fazendo. O
// WhatsApp é um TERCEIRO passo, decidido por `PortalClient.canalPadraoEnvio`; ele nunca substitui o
// e-mail nesta tela e nunca é tentado em silêncio: `PERGUNTAR` pergunta, `EMAIL` não tenta.
//
// ── ⚠ TRÊS RESPOSTAS PARA "POSSO TENTAR DE NOVO?" ───────────────────────────────────────────────
// `envioPodeTentarDeNovo` vem do servidor como `true` / `false` / **`null`** (`errosMeta`): `null` é
// "a Meta não diz se reenviar resolve". A terceira resposta NÃO vira `false` — vira um botão
// habilitado com a frase que diz que a decisão é do contador. Um `null` tratado como `false`
// esconderia a ação exatamente no caso em que a fonte não proíbe nada.

export const CANAL = Object.freeze({ EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", PERGUNTAR: "PERGUNTAR" });

/**
 * @param {{canalPadraoEnvio?: string}} p
 * @returns {{email: true, whatsapp: boolean, perguntar: boolean}}
 */
export function decidirCanaisAoLiberar({ canalPadraoEnvio } = {}) {
  const canal = String(canalPadraoEnvio || "EMAIL").toUpperCase();
  return {
    email: true,
    whatsapp: canal === CANAL.WHATSAPP,
    perguntar: canal === CANAL.PERGUNTAR,
  };
}

/**
 * A pergunta do REENVIO (05/09/2026).
 *
 * Decisão do dono: *"deve ser enviada se o contador decidir enviar novamente, avisando na tela de
 * que já foi enviado"*. A recusa do servidor (`GUIA_JA_ENVIADA`) deixou de ser o fim do caminho e
 * virou o AVISO — e a frase carrega o motivo que o servidor deu, nunca um texto genérico.
 *
 * ⚠ Isto vale SÓ no envio por guia. O lote continua pulando as já enviadas: é o que impede a
 * carteira inteira de sair duas vezes num clique.
 */
export function perguntaDeReenvio(mensagemDoServidor) {
  const motivo = String(mensagemDoServidor || "").trim() || "Esta guia já foi enviada ao cliente.";
  return `${motivo}

Enviar de novo mesmo assim?`;
}

export const PERGUNTA_WHATSAPP = "Enviar esta guia também por WhatsApp?\n\nO e-mail já sai de qualquer forma. O WhatsApp só vai se a empresa tiver contato com opt-in e o canal estiver disponível.";

/**
 * Uma frase para os dois canais, com o TOM certo: verde só quando tudo que se tentou saiu.
 *
 * @param {{email:{feito:boolean, message?:string}, whatsapp?:{tentado:boolean, ok?:boolean, message?:string, motivo?:string}}} p
 * @returns {{tom: "ok"|"erro", texto: string}}
 */
export function resumirDesfechoDosCanais({ email, whatsapp } = {}) {
  const partes = [];
  const emailOk = Boolean(email?.feito);
  partes.push(emailOk ? "e-mail enviado" : (email?.message || "o e-mail não saiu"));
  let zapOk = true;
  if (whatsapp?.tentado) {
    zapOk = Boolean(whatsapp.ok);
    partes.push(zapOk
      ? "WhatsApp enviado"
      : `WhatsApp não saiu (${whatsapp.message || whatsapp.motivo || "motivo não informado"})`);
  }
  const tudoOk = emailOk && zapOk;
  return {
    tom: tudoOk ? "ok" : "erro",
    texto: `Guia liberada ao cliente: ${partes.join(" · ")}.`,
  };
}

/**
 * O envio por WhatsApp que FALHOU — o que a tela oferece.
 *
 * @param {{envioPodeTentarDeNovo?: boolean|null, envioErro?: string|null}} tag
 * @returns {{habilitado: boolean, rotulo: string, frase: string}}
 */
export function ofertaDeRetentativa(tag = {}) {
  const pode = tag.envioPodeTentarDeNovo;
  if (pode === true) {
    return { habilitado: true, rotulo: "Tentar de novo por WhatsApp", frase: "Reenviar é o caminho: a Meta documenta este erro como passageiro." };
  }
  if (pode === false) {
    return {
      habilitado: false,
      rotulo: "Tentar de novo por WhatsApp",
      frase: "Reenviar igual falha igual — o conserto é em outro lugar (cadastro, opt-in, template, conta). Corrija e volte aqui.",
    };
  }
  return {
    habilitado: true,
    rotulo: "Tentar de novo por WhatsApp",
    frase: "A Meta não diz se reenviar resolve — a decisão é sua, olhando o motivo. Se a falha foi de transporte, a guia pode ter chegado: confira antes.",
  };
}

/** Rótulos para os MOTIVOS da prévia do lote (`elegibilidadeEnvioGuia.MOTIVOS`). Lista fechada. */
export const ROTULO_MOTIVO = Object.freeze({
  INTEGRACAO_DESLIGADA: "integração desligada (INTEGRACAO_WHATSAPP)",
  TEMPLATE_NAO_CADASTRADO: "template não cadastrado",
  TEMPLATE_NAO_APROVADO: "template ainda não aprovado na Meta",
  TEMPLATE_SEM_DOCUMENTO: "template aprovado sem cabeçalho de documento",
  TEMPLATE_SEM_NOME_META: "nome do template na Meta não registrado",
  CANAL_INDISPONIVEL: "canal indisponível",
  GUIA_NAO_PROCESSADA: "guia sem PDF processado",
  GUIA_JA_ENVIADA: "já enviada",
  SEM_CONTATO: "sem contato de WhatsApp cadastrado",
  SEM_OPT_IN: "contato sem opt-in",
});

export function rotuloDoMotivo(motivo) {
  return ROTULO_MOTIVO[motivo] || String(motivo || "motivo não informado");
}

/**
 * A PRÉVIA do lote, agrupada para a tela: quantas por WhatsApp, quantas caem para e-mail e POR QUÊ.
 *
 * ⚠ O `resumo` sai INTACTO da prévia: é ele que a confirmação repete ao servidor
 * (`CONFERENCIA_OBRIGATORIA` / `CONFERENCIA_DIVERGENTE`). Recontar aqui e mandar outro número é a
 * forma de a confirmação virar decoração.
 */
export function agruparPrevia(previa) {
  const linhas = Array.isArray(previa?.linhas) ? previa.linhas : [];
  const porMotivo = new Map();
  for (const l of linhas) {
    if (l.canalSugerido === CANAL.WHATSAPP) continue;
    const chave = l.motivo || "motivo não informado";
    if (!porMotivo.has(chave)) porMotivo.set(chave, []);
    porMotivo.get(chave).push(l);
  }
  return {
    resumo: previa?.resumo || { total: 0, porWhatsapp: 0, porEmail: 0, jaEnviadas: 0 },
    canal: previa?.canal || null,
    porWhatsapp: linhas.filter((l) => l.canalSugerido === CANAL.WHATSAPP),
    caemParaEmail: [...porMotivo.entries()].map(([motivo, itens]) => ({ motivo, rotulo: rotuloDoMotivo(motivo), linhas: itens })),
  };
}

/** A conferência que o lote exige: os números da prévia, repetidos como vieram. */
export function conferenciaDaPrevia(previa) {
  const r = previa?.resumo || {};
  return { total: Number(r.total || 0), porWhatsapp: Number(r.porWhatsapp || 0), porEmail: Number(r.porEmail || 0) };
}

/**
 * O lote por WhatsApp só faz sentido com UMA competência: a rota exige `competencia` no formato
 * AAAA-MM. "Todas pendentes" (competência vazia) desabilita o botão — com o motivo, nunca some.
 */
export function podeAbrirLoteWhatsapp({ competencia, selecionadas, canal } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    return { pode: false, motivo: "Escolha UMA competência: o envio por WhatsApp é por mês (a opção \"Todas pendentes\" não serve aqui)." };
  }
  if (!Number(selecionadas)) return { pode: false, motivo: "Selecione ao menos uma empresa." };
  if (canal && canal.disponivel === false) {
    return { pode: false, motivo: canal.mensagem || `O canal WhatsApp não está disponível (${canal.motivo}).` };
  }
  return { pode: true, motivo: null };
}
