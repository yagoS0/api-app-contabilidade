// COMO A GUIA FOI (OU NÃO FOI) PARA O CLIENTE — a regra da coluna "Envio", pura.
//
// ⚠⚠ A PERGUNTA QUE ESTA COLUNA RESPONDE É "CHEGOU?", E ELA NÃO É "MANDAMOS?".
//
// Em 05/09/2026 o dono clicou em enviar, a tela disse **"WhatsApp enviado"** em verde, e a mensagem
// nunca chegou: a Meta aceitou a chamada (devolveu o `wamid`) e **descartou** a mensagem cinco
// segundos depois — limite de template de marketing por pessoa —, avisando pelo webhook. O estado
// verdadeiro chegou ao banco e a tela nunca mais olhou.
//
// Daí as duas leituras separadas:
//   · **aceito**  = a Meta/o SMTP recebeu o pedido. É o que impede disparar de novo.
//   · **chegou**  = o aparelho do cliente confirmou (`entregue`/`lido`).
//
// ⚠ E ELAS DIFEREM POR CANAL. No e-mail **não existe** confirmação de entrega: `enviado` é o
// terminal dele, e exigir um ✓✓ que o SMTP não dá deixaria toda guia por e-mail eternamente
// "aguardando". No WhatsApp existe, vem em segundos, e ignorá-la é o defeito acima.
//
// ⚠ CORES (a lei deste portal): verde é CONCLUÍDO — só entra com chegada confirmada. Vermelho
// BLOQUEIA — só para falha de verdade. Âmbar é pendência de rotina. E "aceito, aguardando
// confirmação" é **neutro**: pintá-lo de verde é exatamente o que a tela fez naquele dia.

/** Lista FECHADA. Estado que não casar com nenhum destes vira `DESCONHECIDA`, nunca "enviada". */
export const SITUACAO_ENVIO = Object.freeze({
  /** Não há e-mail nem WhatsApp cadastrado — a guia não tem para onde ir. */
  SEM_DESTINATARIO: "SEM_DESTINATARIO",
  /** Gerada e nunca tentada. */
  NAO_ENVIADA: "NAO_ENVIADA",
  /** A Meta aceitou e ainda não confirmou entrega. ⚠ NÃO é sucesso. */
  AGUARDANDO_CONFIRMACAO: "AGUARDANDO_CONFIRMACAO",
  /** Saiu por e-mail — o terminal possível daquele canal. */
  ENVIADA_EMAIL: "ENVIADA_EMAIL",
  /** O aparelho do cliente recebeu. */
  ENTREGUE: "ENTREGUE",
  /** O cliente abriu. */
  LIDA: "LIDA",
  /** Nenhum destinatário recebeu. */
  FALHOU: "FALHOU",
  /** Uns receberam, outros não. ⚠ A falha não pode sumir atrás do sucesso. */
  PARCIAL: "PARCIAL",
  /** Contrato antigo ou estado fora da lista: não se afirma nada. */
  DESCONHECIDA: "DESCONHECIDA",
});

const NEUTRO = "var(--state-neutral)";

/**
 * ⚠ O DESENHO DE CADA ESTADO. Ícone próprio por estado — a regra de aceite deste portal pede que um
 * screenshot dessaturado continue legível, e `✓` ≠ `✓✓` ≠ `✖` ≠ `✈` mesmo sem cor.
 */
export const DESENHO_ENVIO = Object.freeze({
  [SITUACAO_ENVIO.SEM_DESTINATARIO]: { icone: "—", tom: NEUTRO, rotulo: "sem destinatário" },
  [SITUACAO_ENVIO.NAO_ENVIADA]: { icone: "✈", tom: "var(--state-warn)", rotulo: "não enviada" },
  // ⚠⚠ NEUTRO, NUNCA VERDE. Ver o cabeçalho: verde aqui foi o defeito.
  [SITUACAO_ENVIO.AGUARDANDO_CONFIRMACAO]: { icone: "✓", tom: NEUTRO, rotulo: "aceita, sem confirmação" },
  [SITUACAO_ENVIO.ENVIADA_EMAIL]: { icone: "✓", tom: "var(--state-ok)", rotulo: "enviada por e-mail" },
  [SITUACAO_ENVIO.ENTREGUE]: { icone: "✓✓", tom: "var(--state-ok)", rotulo: "entregue" },
  // ⚠ `--accent-cyan`, e NÃO um `--accent` — que não existe em `tokens.css`. Tinta pedida a um
  // token inexistente não é erro de CSS: a declaração é descartada e o elemento herda a cor do
  // texto, apagando a hierarquia em silêncio (o defeito medido na tela "A lançar", 10 elementos).
  // Escrevi `--accent` na primeira versão deste arquivo e a guarda de tokens pegou.
  // ⚠ Nenhum exemplo de token inexistente é escrito aqui: a varredura lê o ARQUIVO, comentário
  // incluído, e citar a sintaxe faria a guarda acusar a própria explicação.
  // Ciano é a mesma tinta que o chip do dashboard já usa para "lida".
  [SITUACAO_ENVIO.LIDA]: { icone: "✓✓", tom: "var(--accent-cyan)", rotulo: "lida" },
  [SITUACAO_ENVIO.FALHOU]: { icone: "✖", tom: "var(--state-danger)", rotulo: "não saiu" },
  [SITUACAO_ENVIO.PARCIAL]: { icone: "✖", tom: "var(--state-danger)", rotulo: "só uma parte saiu" },
  [SITUACAO_ENVIO.DESCONHECIDA]: { icone: "–", tom: NEUTRO, rotulo: "sem informação de envio" },
});

const CANAL_ROTULO = Object.freeze({ EMAIL: "e-mail", WHATSAPP: "WhatsApp" });

/** `"EMAIL"` → `"e-mail"`. Canal novo aparece como veio — nunca vira o nome do vizinho. */
export function rotuloDoCanal(canal) {
  return CANAL_ROTULO[String(canal || "").toUpperCase()] || String(canal || "canal");
}

const chegou = (c) => (String(c.canal).toUpperCase() === "EMAIL"
  ? ["enviado", "entregue", "lido"].includes(c.status)
  : ["entregue", "lido"].includes(c.status));

/**
 * A frase de UM canal: o que aconteteceu, para quem, e quando.
 *
 * ⚠ O DESTINO SAI DO ENVIO, não do cadastro: quem recebeu foi o número gravado NAQUELE envio, e o
 * cadastro pode ter mudado depois. Confundir os dois já fez o popover dizer "enviada por WhatsApp
 * para fulano@email.com".
 */
export function frasePorCanal(c) {
  const canal = rotuloDoCanal(c?.canal);
  const para = c?.destino ? ` para ${c.destino}` : "";
  if (c?.status === "lido") return `${canal}: lida${para}`;
  if (c?.status === "entregue") return `${canal}: entregue${para}`;
  if (c?.status === "falhou") return `${canal}: não saiu${para}${c.erroMensagem ? ` — ${c.erroMensagem}` : ""}`;
  if (c?.status === "enviado") {
    return String(c.canal).toUpperCase() === "EMAIL"
      ? `${canal}: enviada${para}`
      : `${canal}: aceita pela Meta${para} — sem confirmação de entrega`;
  }
  if (c?.status === "enviando") return `${canal}: enviando${para}`;
  if (c?.status === "pendente") return `${canal}: na fila deste clique${para}`;
  return `${canal}: ${c?.status || "estado desconhecido"}${para}`;
}

/**
 * LÊ O ESTADO DE ENVIO DE UMA GUIA para a coluna "Envio".
 *
 * Entrada: a guia como a rota do escritório a devolve (bloco `envio`, publicado desde 05/09/2026).
 *
 * @returns {{situacao:string, icone:string, tom:string, rotulo:string, resumo:string,
 *   titulo:string, canais:Array, chegou:boolean, aguardando:boolean, algumFalhou:boolean}}
 */
export function lerEnvioDaGuia(guide) {
  const envio = guide?.envio;
  const canais = Array.isArray(envio?.canais) ? envio.canais : [];

  // ⚠ SEM O BLOCO, NÃO SE INVENTA. Contrato antigo (ou o portal do cliente, que não recebe `envio`)
  // cai em DESCONHECIDA — nunca em "não enviada", que seria afirmar que ninguém tentou.
  if (!envio) {
    const d = DESENHO_ENVIO[SITUACAO_ENVIO.DESCONHECIDA];
    return {
      situacao: SITUACAO_ENVIO.DESCONHECIDA,
      ...d,
      resumo: d.rotulo,
      titulo: "Esta tela não recebeu o estado de envio desta guia.",
      canais: [],
      chegou: false,
      aguardando: false,
      algumFalhou: false,
    };
  }

  const entregues = canais.filter(chegou);
  const falhados = canais.filter((c) => c.status === "falhou");
  const aguardando = canais.filter((c) => String(c.canal).toUpperCase() !== "EMAIL" && c.status === "enviado");
  const tentados = canais.filter((c) => c.status !== "pendente");

  let situacao;
  if (!canais.length) {
    // ⚠ `jaEnviada` sem NENHUMA linha é a tolerância do legado (guias anteriores a `envios_guia`,
    // que valem pelo `emailStatus`). Ela é e-mail enviado — não um estado desconhecido.
    situacao = envio.jaEnviada ? SITUACAO_ENVIO.ENVIADA_EMAIL : SITUACAO_ENVIO.NAO_ENVIADA;
  } else if (entregues.length && falhados.length) {
    situacao = SITUACAO_ENVIO.PARCIAL;
  } else if (falhados.length && !entregues.length && !aguardando.length) {
    situacao = SITUACAO_ENVIO.FALHOU;
  } else if (entregues.some((c) => c.status === "lido")) {
    situacao = SITUACAO_ENVIO.LIDA;
  } else if (entregues.some((c) => c.status === "entregue")) {
    situacao = SITUACAO_ENVIO.ENTREGUE;
  } else if (entregues.length) {
    situacao = SITUACAO_ENVIO.ENVIADA_EMAIL;
  } else if (aguardando.length) {
    situacao = SITUACAO_ENVIO.AGUARDANDO_CONFIRMACAO;
  } else if (!tentados.length) {
    situacao = SITUACAO_ENVIO.NAO_ENVIADA;
  } else {
    situacao = SITUACAO_ENVIO.DESCONHECIDA;
  }

  const d = DESENHO_ENVIO[situacao];
  const frases = canais.map(frasePorCanal);
  return {
    situacao,
    ...d,
    // O resumo é curto porque a célula é estreita; o detalhe por canal vai no `title`.
    resumo: canais.length > 1 ? `${d.rotulo} (${entregues.length}/${canais.length})` : d.rotulo,
    titulo: frases.length ? frases.join("\n") : d.rotulo,
    canais,
    chegou: entregues.length > 0,
    aguardando: aguardando.length > 0,
    algumFalhou: falhados.length > 0,
  };
}

/**
 * ENQUANTO VALE A PENA PERGUNTAR DE NOVO — o polling da coluna.
 *
 * ⚠ A confirmação de entrega do WhatsApp chega pelo webhook em segundos. Sem reolhar, a tela
 * congela no "aceita, sem confirmação" e o contador precisa recarregar a página para saber o que
 * aconteceu — que foi exatamente o que aconteceu no dia do defeito.
 *
 * ⚠ E ELE PARA SOZINHO: só enquanto houver guia aguardando, e com teto de tentativas. Polling sem
 * fim é o que transforma uma tela aberta o dia inteiro numa fonte de carga constante.
 */
export function devePolir(guides, tentativas = 0, teto = 24) {
  if (tentativas >= teto) return false;
  return (Array.isArray(guides) ? guides : []).some((g) => lerEnvioDaGuia(g).aguardando);
}
