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

export const PERGUNTA_WHATSAPP = "Enviar esta guia também por WhatsApp?\n\nO envio por e-mail também será tentado, se houver endereço cadastrado. O WhatsApp exige contato autorizado e canal disponível.";

// E-mail tem confirmação de envio; WhatsApp depende do webhook de entrega.
// ok significa algum pedido aceito, nunca entrega; preserva o resultado por destinatário.
export function desfechoWhatsapp(r = {}) {
  return { ...r, tentado: true, ok: r.ok === true, message: r.message || r.mensagem || null, motivo: r.error || r.motivo || null };
}
export function resumirWhatsapp(w = {}) {
  const resultados = Array.isArray(w.resultados) ? w.resultados : [];
  const falhas = w.falhas != null ? Number(w.falhas) : resultados.filter(r => r.ok === false && !["indeterminado", "em_andamento"].includes(r.estado)).length;
  const incertas = Number(w.indeterminadas || 0) || resultados.filter(r => ["indeterminado", "em_andamento"].includes(r.estado)).length;
  const parcial = w.parcial === true || (w.ok === true && falhas > 0);
  const detalhe = resultados.filter(r => r.ok === false || ["indeterminado", "em_andamento"].includes(r.estado))
    .map(r => `${r.destino || "destinatário"}: ${r.message || r.mensagem || r.motivo || "resultado não confirmado"}`).join("; ");
  if (parcial) return { tom: "erro", texto: `WhatsApp parcialmente aceito: ${Number(w.aceitas ?? w.enviadas ?? 0)} aceito(s), ${falhas} falha(s)${incertas ? `, ${incertas} sem confirmação` : ""}. ${detalhe || w.message || w.mensagem || "Confira os destinatários na coluna Envio."}` };
  if (incertas || ["indeterminado", "em_andamento"].includes(w.estado)) return { tom: "pendente", texto: `WhatsApp com resultado indeterminado. ${detalhe || w.message || w.mensagem || "Confira o histórico antes de repetir: o pedido pode ter sido aceito."}` };
  if (!w.ok) return { tom: "erro", texto: `WhatsApp não saiu (${w.message || w.mensagem || w.motivo || "motivo não informado"})` };
  if (w.estado === "ja_enviada") return { tom: "pendente", texto: "WhatsApp: envio anterior registrado; confira a confirmação de entrega na coluna Envio" };
  return { tom: "pendente", texto: "WhatsApp: pedido aceito pela Meta, aguardando confirmação de entrega" };
}
export function resumirDesfechoDosCanais({ email, whatsapp } = {}) {
  const partes = [];
  const emailOk = Boolean(email?.feito);
  const emailAusente = !emailOk && email?.naoSeAplica === true;
  partes.push(emailOk ? "e-mail enviado" : emailAusente ? "sem e-mail cadastrado" : (email?.message || "o e-mail não saiu"));
  const zap = whatsapp?.tentado ? resumirWhatsapp(whatsapp) : null;
  if (zap) partes.push(zap.texto);
  const falhou = (!emailOk && !emailAusente) || zap?.tom === "erro";
  const nadaATentar = !emailOk && emailAusente && !zap;
  return { tom: falhou || nadaATentar ? "erro" : zap ? "pendente" : "ok",
    texto: `Resultado do envio: ${partes.join(" · ")}.${nadaATentar ? ` ${SEM_NINGUEM_PARA_RECEBER}` : ""}` };
}

/** ⚠ Guia que não foi para ninguém não se parece com guia entregue — e o conserto tem endereço. */
export const SEM_NINGUEM_PARA_RECEBER =
  "A guia NÃO foi enviada a ninguém: cadastre um e-mail ou um WhatsApp em Configuração de envio "
  + "(aba Guias) e envie de novo.";

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
