// A JANELA DE 24 HORAS — dá para conversar, ou só cabe template?
//
// Regra PURA: sem prisma, sem rede, sem relógio escondido. Recebe o FATO (o instante da última
// mensagem recebida do cliente) e devolve a resposta nomeada. Mesma disciplina de
// `vinculoTelefone.js`, `fechamentoBlockers.js`, `divergenciaDeFonte.js` e `obrigatoriedadeEfd.js`
// — para que teste, tela e (na fase seguinte) webhook respondam a MESMA coisa.
//
// ── POR QUE ERRAR AQUI CUSTA NOS DOIS SENTIDOS ──────────────────────────────────────────────────
// Fechada demais: o atendimento manda template quando podia conversar — mensagem paga e mais fria.
// Aberta demais: a Meta RECUSA a mensagem e o cliente **não recebe nada**, sem ninguém perceber.
// A segunda é a pior, e é ela que decide todos os desempates deste arquivo: **na dúvida, fecha**.
//
// ── ⚠ A JANELA É DERIVADA. NUNCA UMA COLUNA `aberta: true/false` ────────────────────────────────
// Um booleano gravado envelhece sozinho: às 24h01 ele continuaria dizendo `true` sem que ninguém
// tivesse escrito nada, e nada no banco denunciaria a mentira. O precedente já tem nome neste
// projeto — `hasAccountingDivergence` é uma guarda com 1 escritor e 0 leitores, e foi por isso que
// `divergenciaDeFonte` nasceu derivada. Aqui: **guarda-se o INSTANTE do fato** (na linha da
// mensagem recebida) e a janela se calcula na leitura, contra o `agora` de quem pergunta.
//
// ── FONTE (documentação oficial da Meta, consultada em 14/08/2026) ──────────────────────────────
//
//   https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
//   ("Service messages" — a mesma página responde em
//    https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/)
//
//   1. O QUE ABRE: *"When a WhatsApp user messages you or calls you, a 24-hour timer"* — a janela
//      conta do **contato do CLIENTE conosco**, não da nossa resposta, não do envio do template,
//      não do cadastro.
//   2. REABRE: nova mensagem (ou chamada) do cliente antes de expirar **reinicia** as 24h. Por isso
//      a base é a ÚLTIMA recebida, não a primeira.
//   3. O QUE MUDA AO FECHAR: fechada, só se envia template pré-aprovado.
//
// ⚠ **CHAMADA DE VOZ TAMBÉM ABRE E REINICIA A JANELA, E NÓS NÃO REGISTRAMOS CHAMADAS.** Nenhuma
// linha deste projeto trata evento de chamada. Consequência exata, e ela é assimétrica de
// propósito: a janela derivada só das mensagens é um **piso** — pode dizer FECHADA quando a Meta a
// considera aberta (erro barato: manda-se template), e **nunca** o contrário (erro caro). O aviso
// viaja NOMEADO em toda resposta que não seja ABERTA, para que ninguém leia "expirada" como
// certeza. Assinar o webhook de chamadas é decisão do dono — ver o relatório.
//
// ⚠ **O QUE NÃO ESTÁ CONFIRMADO EM FONTE OFICIAL, E POR ISSO NÃO É DECIDIDO AQUI:** o significado
// exato do campo `timestamp` do objeto de mensagem do webhook (a página de payloads o mostra com
// exemplo — `"1749416383"` — mas **não** descreve o que ele marca nem em que unidade). Terceiros
// afirmam ser "quando o servidor do WhatsApp recebeu a mensagem"; terceiro não é fonte. É por isso
// que `instanteQueAbreAJanela` recebe os DOIS instantes e escolhe **com o critério declarado**, em
// vez de este módulo fingir que sabe qual é o certo.

/** As 24 horas, em milissegundos. Uma constante, um lugar. */
export const JANELA_MS = 24 * 60 * 60 * 1000;

export const SITUACOES_JANELA = Object.freeze({
  /** Há mensagem recebida e ela ainda está dentro das 24h. */
  ABERTA: "ABERTA",
  /** Houve mensagem recebida, e as 24h já correram. */
  EXPIRADA: "EXPIRADA",
  /**
   * O cliente NUNCA escreveu neste fio. ⚠ Não é o mesmo que EXPIRADA, e colapsá-los tiraria da
   * tela a única diferença que importa para quem atende: "a conversa esfriou, reabra" contra
   * "esta conversa nunca começou". A permissão é a mesma; a frase, não.
   */
  NUNCA_ABERTA: "NUNCA_ABERTA",
  /**
   * Veio algo no lugar do instante e não dá para afirmar que é um instante. RECUSA COM MOTIVO —
   * calcular em cima de lixo produziria uma janela plausível e errada.
   */
  INSTANTE_INVALIDO: "INSTANTE_INVALIDO",
});

/**
 * O que a janela permite. ⚠ NÃO é autorização de envio: opt-in, RBAC e aprovação do template são
 * outras portas (`ContatoWhatsappService.destinatarioWhatsapp`, `requireClientCompanyAccess`).
 * Este módulo responde só o que a janela responde.
 */
export const PERMISSOES = Object.freeze({
  /** Texto livre (mensagem de serviço) e template. */
  TEXTO_LIVRE: "TEXTO_LIVRE",
  /** Só template pré-aprovado. */
  SOMENTE_TEMPLATE: "SOMENTE_TEMPLATE",
});

/** De onde saiu o instante que abriu a janela. Nada é escolhido em silêncio. */
export const FONTES_DO_INSTANTE = Object.freeze({
  /** O instante que a própria Meta reportou no evento. */
  PROVEDOR: "PROVEDOR",
  /** O instante em que NÓS gravamos o evento. */
  NOSSO_REGISTRO: "NOSSO_REGISTRO",
});

export const AVISOS = Object.freeze({
  CHAMADAS_NAO_REGISTRADAS:
    "chamada de voz do cliente também reabre a janela na Meta, e este sistema não registra chamadas: a janela calculada é um piso",
  SEM_INSTANTE_DO_PROVEDOR:
    "o evento não trouxe instante do provedor; a base é o instante do nosso registro, que é POSTERIOR ao fato",
  PROVEDOR_ADIANTADO:
    "o instante do provedor é POSTERIOR ao do nosso registro (relógios discordam); usada a base mais antiga",
  INSTANTE_NO_FUTURO: "o instante da última mensagem recebida está no futuro em relação ao agora informado",
});

/** Por que um instante foi recusado. */
export const MOTIVOS_INSTANTE_INVALIDO = Object.freeze({
  NUMERO_CRU:
    "instante veio como número cru — segundos e milissegundos são indistinguíveis aqui, e a conversão é de quem lê o payload",
  NAO_E_DATA: "não é uma data reconhecível",
});

/**
 * Data, ou a recusa nomeada. Aceita `Date` e string ISO-8601.
 *
 * ⚠ **NÚMERO CRU É RECUSADO DE PROPÓSITO.** O `timestamp` do webhook é um Unix timestamp e a
 * documentação oficial não declara a unidade na página de payloads. Lido como milissegundos,
 * `1749416383` cai em janeiro de 1970 e a janela sai "expirada há 56 anos" — plausível na tela,
 * errada no fato. Converter é trabalho de quem LÊ o payload (a fase do webhook), com a unidade
 * confirmada; este módulo não adivinha por ordem de grandeza.
 */
function paraData(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? { data: null, motivo: MOTIVOS_INSTANTE_INVALIDO.NAO_E_DATA } : { data: valor, motivo: null };
  if (typeof valor === "number") return { data: null, motivo: MOTIVOS_INSTANTE_INVALIDO.NUMERO_CRU };
  if (typeof valor === "string" && valor.trim()) {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? { data: null, motivo: MOTIVOS_INSTANTE_INVALIDO.NAO_E_DATA } : { data: d, motivo: null };
  }
  return { data: null, motivo: null }; // ausência não é invalidez
}

/**
 * O INSTANTE QUE ABRE A JANELA, e de onde ele veio.
 *
 * Uma mensagem recebida carrega dois instantes, e eles não são a mesma coisa:
 *
 *   `ocorridaEmProvedor` — o que a Meta reportou no evento (campo `timestamp`).
 *   `registradaEm`       — quando NÓS gravamos. Sempre POSTERIOR ao fato: a entrega do webhook,
 *                          a fila e o nosso processamento acontecem depois.
 *
 * ⚠ **ESCOLHE-SE A MAIS ANTIGA, E O MOTIVO É A ASSIMETRIA DO ERRO.** A Meta ancora a contagem no
 * lado dela. Ancorar em `registradaEm` faria a nossa janela terminar DEPOIS da dela — e nesse
 * intervalo mandaríamos texto livre que a Meta recusa, com o cliente não recebendo nada. Ancorar na
 * mais antiga faz a nossa fechar ANTES ou junto: no pior caso manda-se um template a mais.
 *
 * ⚠ Não é uma média, nem um "se existir usa o do provedor": quando os relógios discordam ao
 * contrário do esperado (provedor adiantado), a regra continua sendo a mais antiga, com aviso.
 */
export function instanteQueAbreAJanela(ultimaRecebida) {
  const avisos = [];
  if (!ultimaRecebida) return { instante: null, fonte: null, avisos, motivoInvalido: null };

  const prov = paraData(ultimaRecebida.ocorridaEmProvedor);
  const nosso = paraData(ultimaRecebida.registradaEm);

  if (prov.motivo || nosso.motivo) {
    return { instante: null, fonte: null, avisos, motivoInvalido: prov.motivo || nosso.motivo };
  }
  if (!prov.data && !nosso.data) return { instante: null, fonte: null, avisos, motivoInvalido: null };

  if (!prov.data) {
    avisos.push(AVISOS.SEM_INSTANTE_DO_PROVEDOR);
    return { instante: nosso.data, fonte: FONTES_DO_INSTANTE.NOSSO_REGISTRO, avisos, motivoInvalido: null };
  }
  if (!nosso.data) return { instante: prov.data, fonte: FONTES_DO_INSTANTE.PROVEDOR, avisos, motivoInvalido: null };

  if (prov.data.getTime() > nosso.data.getTime()) avisos.push(AVISOS.PROVEDOR_ADIANTADO);
  const maisAntiga = prov.data.getTime() <= nosso.data.getTime() ? prov : nosso;
  return {
    instante: maisAntiga.data,
    fonte: maisAntiga === prov ? FONTES_DO_INSTANTE.PROVEDOR : FONTES_DO_INSTANTE.NOSSO_REGISTRO,
    avisos,
    motivoInvalido: null,
  };
}

/**
 * A JANELA DE 24H. Pura.
 *
 * @param {object|null} ultimaRecebida a ÚLTIMA mensagem RECEBIDA do cliente neste fio, no formato
 *   `{ ocorridaEmProvedor, registradaEm }` (Date ou string ISO). `null` = o cliente nunca escreveu.
 *   ⚠ Mensagem ENVIADA por nós não entra: responder não reabre janela nenhuma (ver a fonte no
 *   cabeçalho — quem abre é o cliente).
 * @param {Date} [agora] o instante da pergunta. Injetável para o teste não depender do relógio.
 * @returns {{situacao:string, permite:string, instante:Date|null, fonte:string|null,
 *            expiraEm:Date|null, restanteMs:number|null, avisos:string[], motivoInvalido:string|null}}
 */
export function avaliarJanela24h(ultimaRecebida, agora = new Date()) {
  const base = { avisos: [], motivoInvalido: null, instante: null, fonte: null, expiraEm: null, restanteMs: null };
  const { instante, fonte, avisos, motivoInvalido } = instanteQueAbreAJanela(ultimaRecebida);

  if (motivoInvalido) {
    // ⚠ RECUSA, não "fechada". Tratar lixo como janela fechada esconderia um defeito de leitura do
    // payload atrás de um estado normal da tela.
    return { ...base, situacao: SITUACOES_JANELA.INSTANTE_INVALIDO, permite: PERMISSOES.SOMENTE_TEMPLATE, motivoInvalido, avisos };
  }

  if (!instante) {
    return {
      ...base,
      situacao: SITUACOES_JANELA.NUNCA_ABERTA,
      permite: PERMISSOES.SOMENTE_TEMPLATE,
      avisos: [...avisos, AVISOS.CHAMADAS_NAO_REGISTRADAS],
    };
  }

  const expiraEm = new Date(instante.getTime() + JANELA_MS);
  const restanteMs = expiraEm.getTime() - agora.getTime();
  const noFuturo = instante.getTime() > agora.getTime();
  const todos = [...avisos];
  if (noFuturo) todos.push(AVISOS.INSTANTE_NO_FUTURO);

  if (restanteMs > 0) {
    // ⚠ Instante no futuro NÃO recusa: o cliente acabou de escrever e a Meta considera a janela
    // aberta; o desencontro é de relógio. O aviso sobe para que a tela não apresente "23h59
    // restantes" como se nada houvesse de estranho.
    return { ...base, situacao: SITUACOES_JANELA.ABERTA, permite: PERMISSOES.TEXTO_LIVRE, instante, fonte, expiraEm, restanteMs, avisos: todos };
  }

  return {
    ...base,
    situacao: SITUACOES_JANELA.EXPIRADA,
    permite: PERMISSOES.SOMENTE_TEMPLATE,
    instante,
    fonte,
    expiraEm,
    restanteMs,
    // Só quem NÃO está aberta carrega o aviso da chamada: é exatamente aí que ele pode estar errado.
    avisos: [...todos, AVISOS.CHAMADAS_NAO_REGISTRADAS],
  };
}
