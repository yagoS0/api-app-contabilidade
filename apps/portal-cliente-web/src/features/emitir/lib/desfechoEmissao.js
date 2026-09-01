// AS TRÊS CAMADAS, DO LADO DE QUEM LÊ A TELA — a leitura do desfecho, pura.
//
// ⚠ **ERRO NOSSO, QUEDA DE REDE E RECUSA DA RECEITA SÃO TRÊS FATOS DIFERENTES**, e a tela do
// cliente é justamente onde a diferença decide o que a pessoa faz nos próximos cinco minutos:
//
//   | camada       | HTTP | o que houve                                   | e daí                           |
//   |--------------|------|-----------------------------------------------|---------------------------------|
//   | `NOSSA`      | 400  | recusamos antes de enviar — nada saiu daqui   | corrija e envie de novo         |
//   | `TRANSPORTE` | 502  | o pedido saiu e o desfecho é **desconhecido** | ⚠ **NÃO reenvie** — consulte    |
//   | `RECEITA`    | 422  | o sistema nacional analisou e recusou         | corrija a nota e emita de novo  |
//
// A tabela é de `apps/api/src/application/nfse/desfechoEmissao.js`; o mapa para HTTP é de
// `apps/api/src/routes/nfseEmissaoHttp.js`. Nada aqui decide nada — só traduz o que o servidor já
// respondeu para o que a tela precisa desenhar.
//
// ⚠⚠ **A LINHA DO MEIO É A RAZÃO DE ESTE ARQUIVO EXISTIR.** Em `TRANSPORTE` não se sabe se a DPS
// chegou. Reemitir pode gerar nota em duplicidade (E0014), e **não existe inutilização na
// NFS-e**: número queimado é buraco permanente. Por isso `podeReenviar` é `false` nesse ramo e a
// tela não oferece botão nenhum de reenvio — não um botão com aviso, **nenhum botão**. Um "tentar
// de novo" ali é um ato fiscal disparado sobre uma dúvida.

/** O que a tela desenha. Cada valor tem um bloco visual próprio. */
export const TIPO = Object.freeze({
  SUCESSO: "SUCESSO",
  /** 202 — o serviço aceitou mas a nota ainda não está emitida (`status: "pending"`). */
  EM_PROCESSAMENTO: "EM_PROCESSAMENTO",
  NOSSA: "NOSSA",
  TRANSPORTE: "TRANSPORTE",
  RECEITA: "RECEITA",
  /** 403 do portão (`EMISSAO_CLIENTE_*`) — a permissão mudou entre abrir a tela e enviar. */
  PORTAO: "PORTAO",
  /** 400 do validador — campo do formulário. */
  PEDIDO_INVALIDO: "PEDIDO_INVALIDO",
  /** Impedimento no CADASTRO da empresa: nada que o cliente resolva sozinho. */
  EMPRESA: "EMPRESA",
  /** Sessão morreu no meio. A casca leva ao login. */
  SESSAO: "SESSAO",
  /** Rede, 500, qualquer coisa que não se saiba nomear. ⚠ Nunca vira "pode reenviar". */
  DESCONHECIDO: "DESCONHECIDO",
});

/**
 * ⚠⚠ ESTE DESFECHO DEIXA O FORMULÁRIO NA TELA? (31/08/2026, teste de usabilidade)
 *
 * Achado: **qualquer** desfecho substituía o formulário inteiro pelo painel — inclusive a recusa
 * mais barata que existe, a que nem saiu da máquina (CPF com dígito errado, valor zero). Quem
 * digitou um dígito a mais perdia a tela de edição e tinha de clicar "Corrigir e enviar de novo"
 * para reencontrar o próprio texto. É o erro que mais se comete numa sessão de digitação, cobrado
 * ao preço do mais raro.
 *
 * ⚠⚠ A LINHA DE CORTE É "A DPS SAIU DAQUI?", nunca "é grave?": onde nada saiu não houve ato fiscal
 * nenhum — nenhum número consumido, nenhuma nota possível no mundo —, e o estado certo da tela é o
 * formulário de onde a recusa veio, com o motivo em cima dele.
 *
 * ⚠ SUCESSO, TRANSPORTE, RECEITA, PORTAO, EMPRESA e DESCONHECIDO **continuam tomando a tela**, e
 * isso não se afrouxa: eles falam de uma nota que existe ou que pode existir, ou de um impedimento
 * que não se resolve no formulário. O TRANSPORTE ainda APAGA o formulário de propósito — para
 * tirar do caminho o "enviar de novo" de um clique só sobre uma nota que talvez já exista.
 *
 * ⚠ Lista de INCLUSÃO: tipo novo entra tomando a tela, que é o lado seguro.
 */
export function desfechoMantemOFormulario(desfecho) {
  return desfecho?.tipo === TIPO.NOSSA || desfecho?.tipo === TIPO.PEDIDO_INVALIDO;
}

/**
 * Códigos que descrevem um impedimento do CADASTRO da empresa (ou da numeração dela).
 * Nenhum deles é corrigível dentro do formulário — todos terminam em "fale com o seu contador".
 */
const CODIGOS_DE_EMPRESA = new Set([
  "company_not_found",
  "company_missing_fields",
  "nfse_not_configured",
  "nfse_ultima_nota_ilegivel",
  "nfse_leitura_numeracao_indisponivel",
  "nfse_retry_invoice_not_found",
]);

/**
 * ⚠ `nfse_numero_em_estado_indeterminado` (409) É DA FAMÍLIA DO TRANSPORTE, não um erro de
 * validação. Ele é a recusa do servidor a reemitir sobre um número cujo desfecho ninguém conhece —
 * ou seja, é o `TRANSPORTE` de uma tentativa ANTERIOR aparecendo de novo. Tratá-lo como "erro,
 * tente outra vez" desfaria a proteção inteira.
 */
const CODIGO_NUMERO_INDETERMINADO = "nfse_numero_em_estado_indeterminado";

/**
 * ⚠⚠ O JARGÃO DO SERVIDOR NÃO CHEGA AO CLIENTE (31/08/2026, teste de usabilidade).
 *
 * Achado: a tela renderiza `message`/`correcao` **cruas** do servidor, e as recusas da camada
 * NOSSA são escritas para o CONTADOR — elas nomeiam campo de XML (`pTotTribSN`, `pTotTribFed`),
 * citam o código da DPS (`opSimpNac=3`) e, pior, mandam a pessoa a uma tela que **só existe no
 * portal do escritório** (*"Editar cadastro → Emissão de NFS-e"*). O cliente lia um caminho que
 * ele não tem como percorrer.
 *
 * ⚠⚠ ISSO FURAVA UMA REGRA JÁ ESCRITA DESTE APP: `lib/mensagens.js` resolve por CÓDIGO e **não lê**
 * `err.message`, de propósito — *"ela nunca devolve texto cru do servidor"*. O desfecho da emissão
 * era o caminho por onde o texto do servidor entrava assim mesmo.
 *
 * ⚠ O MAPA É DE INCLUSÃO, e curto: só os códigos cuja frase do servidor carrega jargão ou aponta
 * para a tela do contador. Todo o resto continua passando como está — inclusive, e principalmente,
 * **a recusa da RECEITA, que é CITADA e nunca reescrita**: ali a fonte oficial vence, e traduzir a
 * frase do sistema nacional seria apagar a única prova do que ele respondeu.
 *
 * ⚠ As frases terminam em "fale com o seu contador" onde o conserto é dele — que é o caso dos três
 * campos de carga tributária: eles moram no cadastro da empresa, e o cliente não os edita.
 */
const FRASE_DO_CLIENTE = Object.freeze({
  MISSING_P_TOT_TRIB_SN: {
    message: "Falta a alíquota efetiva do Simples desta nota.",
    correcao:
      "Preencha o campo “Alíquota efetiva do Simples (%)” no formulário. Se ele estiver vazio e " +
      "você não souber o percentual, peça ao seu contador.",
  },
  MISSING_TOT_TRIB_NAO_SIMPLES: {
    message: "A carga tributária aproximada desta empresa não está cadastrada.",
    correcao:
      "Ela é preenchida pelo seu contador no cadastro da empresa, e vai impressa na nota por " +
      "exigência da Lei 12.741/2012. Fale com ele.",
  },
  INVALID_TOT_TRIB_NAO_SIMPLES: {
    message: "A carga tributária aproximada cadastrada para esta empresa não é um percentual válido.",
    correcao: "Quem corrige esse cadastro é o seu contador. Fale com ele.",
  },
  NFSE_MUNICIPIO_NAO_CONFIGURADO: {
    message: "O município da sua empresa não está configurado para emitir.",
    correcao: "Quem preenche isso é o seu contador, no cadastro da empresa. Fale com ele.",
  },
  NFSE_REGIME_INDEFINIDO: {
    message: "O regime tributário desta empresa não está cadastrado.",
    correcao:
      "A nota declara o regime, e emitir com o regime errado é declaração falsa — por isso ela " +
      "não sai sem esse dado. Quem o cadastra é o seu contador.",
  },
  NO_COMPANY_CERT: {
    message: "Esta empresa não tem certificado digital cadastrado para assinar a nota.",
    correcao: "Quem cadastra o certificado é o seu contador. Fale com ele.",
  },
});

/**
 * Troca a frase do servidor pela do cliente quando existe uma — e a mantém quando não existe.
 *
 * ⚠ A troca é do PAR inteiro (`message` + `correcao`): substituir só a mensagem deixaria a
 * correção do contador embaixo de um texto de cliente, apontando para uma tela que ele não tem.
 */
function comFraseDeCliente(base) {
  const propria = base?.codigo ? FRASE_DO_CLIENTE[String(base.codigo).toUpperCase()] : null;
  if (!propria) return base;
  return { ...base, message: propria.message, correcao: propria.correcao };
}

function corpoDoErro(err) {
  const corpo = err?.corpo;
  return corpo && typeof corpo === "object" ? corpo : {};
}

/**
 * Lê o RESULTADO de uma emissão que não lançou (2xx).
 *
 * @param {object|null} resultado corpo devolvido pela fachada
 */
export function lerResultado(resultado) {
  const nfse = resultado?.nfse || null;
  if (resultado?.status === "issued") {
    return {
      tipo: TIPO.SUCESSO,
      nfse,
      message: resultado.message || null,
      podeReenviar: false,
      retryInvoiceId: null,
    };
  }
  // ⚠ 202 não é sucesso. `status` diferente de `issued` num 2xx significa que a linha foi criada e
  // a nota **ainda não existe** — dizer "emitida" aqui inventaria um fato fiscal.
  return {
    tipo: TIPO.EM_PROCESSAMENTO,
    nfse,
    message: resultado?.message || null,
    podeReenviar: false,
    retryInvoiceId: null,
  };
}

/**
 * Lê o ERRO de uma emissão.
 *
 * @param {import("../../../api/ApiError").ApiError} err
 * @returns {{tipo: string, codigo: string|null, message: string|null, correcao: string|null,
 *            podeReenviar: boolean, retryInvoiceId: string|null, extra: object}}
 */
export function lerErroEmissao(err) {
  const corpo = corpoDoErro(err);
  const status = Number(err?.status);
  const code = err?.code ? String(err.code) : null;
  const camada = corpo.camada ? String(corpo.camada).toUpperCase() : null;

  const base = {
    codigo: corpo.codigo || code || null,
    message: typeof corpo.message === "string" ? corpo.message : null,
    correcao: typeof corpo.correcao === "string" ? corpo.correcao : null,
    podeReenviar: false,
    retryInvoiceId: null,
    extra: corpo,
  };

  if (status === 401) return { ...base, tipo: TIPO.SESSAO };

  // O portão, com os dois códigos distintos. A tela já o lê antes de montar o formulário, mas ele
  // pode mudar no meio (o contador revoga, o OWNER troca o papel) — e a recusa continua nomeada.
  if (status === 403 && String(corpo.codigo || "").startsWith("EMISSAO_CLIENTE_")) {
    return { ...base, tipo: TIPO.PORTAO };
  }

  if (code === CODIGO_NUMERO_INDETERMINADO || camada === "TRANSPORTE") {
    // ⚠ SEM REENVIO. Nem aqui, nem na tela, nem automaticamente — em nenhuma circunstância.
    return { ...base, tipo: TIPO.TRANSPORTE, podeReenviar: false, retryInvoiceId: null };
  }

  if (camada === "RECEITA" || camada === "NOSSA") {
    // A linha da tentativa é reaproveitável quando o servidor diz que o número não se perdeu — e
    // reenviar COM ela é o que impede queimar um número novo a cada correção.
    // ⚠ `=== true`: numeração não se libera por coerção de tipo.
    const reaproveitavel = corpo.numeroReutilizavel === true && corpo.nfse?.id;
    const daReceita = camada === "RECEITA";
    return {
      // ⚠⚠ A TRADUÇÃO SÓ VALE PARA A RECUSA **NOSSA**. A da RECEITA é CITADA e nunca reescrita: a
      // fonte oficial vence, e trocar a frase do sistema nacional apagaria a única prova do que
      // ele respondeu — que é o que o contador precisa ler para saber o que corrigir.
      ...(daReceita ? base : comFraseDeCliente(base)),
      tipo: daReceita ? TIPO.RECEITA : TIPO.NOSSA,
      podeReenviar: true,
      retryInvoiceId: reaproveitavel ? String(corpo.nfse.id) : null,
    };
  }

  if (code && CODIGOS_DE_EMPRESA.has(code)) {
    // ⚠ Aqui também: o impedimento é do CADASTRO, e a frase do servidor aponta a tela do contador.
    return { ...comFraseDeCliente(base), tipo: TIPO.EMPRESA };
  }

  // 400 sem camada = recusa do validador (`validateNfsePayload`), que é campo do formulário.
  if (status === 400 && code) {
    return { ...base, tipo: TIPO.PEDIDO_INVALIDO, podeReenviar: true };
  }

  // ⚠ O RAMO DE RESERVA NÃO OFERECE REENVIO. Rede caída, 500 nosso, resposta que não se soube
  // ler — em nenhum desses se sabe se a emissão aconteceu. É o mesmo raciocínio do `TRANSPORTE`,
  // e presumir "não emitiu" aqui seria a suposição mais cara possível.
  return { ...base, tipo: TIPO.DESCONHECIDO };
}
