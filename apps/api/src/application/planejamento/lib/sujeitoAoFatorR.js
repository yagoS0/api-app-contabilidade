// A ATIVIDADE DA EMPRESA É SUJEITA AO FATOR R? — três respostas, nunca duas.
//
// ⚠⚠ POR QUE ISTO IMPORTA: o Fator R (folha ÷ RBT12, corte em 28%) decide **Anexo III ou V**, e a
// diferença entre eles é a maior alavanca isolada do Simples para uma prestadora de serviços. Num
// RBT12 de ~R$ 718 mil, III dá ~11,04% e V dá ~17,6% — cerca de 6,6 pontos, dezenas de milhares de
// reais no ano.
//
// ⚠ O DEFEITO QUE ISTO CONSERTA, relatado pelo dono em 25/08/2026 com as telas na frente: o Perfil
// fiscal da LENTE mostrava os DOIS CNAEs (7319003 "Marketing direto" e 6319400 "Portais…") como
// "III ou V (Fator R) — sim", e o Planejamento da MESMA empresa exibia o checkbox de Fator R
// DESMARCADO, com o anexo travado em III. Cada tela dizia uma coisa.
//
// A causa: `DadosPlanejamentoService` lia `CadastroFiscal.usaFatorR` CRU (um booleano com
// `@default(false)`), enquanto o catálogo de CNAE já classificava as duas atividades como
// `SERVICO_FATOR_R`. Ninguém derivava.
//
// ⚠⚠ `false` NAQUELA COLUNA NÃO PROVA NADA, e é o eixo desta regra. Ele é o default do banco: não
// distingue "o contador conferiu e disse que não" de "ninguém nunca abriu essa tela". Lê-lo como
// resposta é o mesmo erro de `Number(null) === 0` que a folha ausente já custou a este projeto —
// e o custo aqui é da mesma família: uma empresa cai no Anexo V (a alíquota MAIOR) sem que ninguém
// tenha decidido isso.
//
// ⚠ POR ISSO A RESPOSTA "SIM" NUNCA É REBAIXADA. Se o contador marcou a caixa, vale; se o perfil
// diz que uma atividade ATIVA é de Fator R, vale. O que o `false` do cadastro NÃO pode fazer é
// derrubar o que o catálogo afirma — ele viraria um "não" que ninguém digitou.
//
// ⚠ Decisão do dono (25/08/2026): "Derivar, com override" — e avisar quando os dois divergirem.

export const RESPOSTA = Object.freeze({
  SIM: "sim",
  NAO: "nao",
  /** ⚠ NÃO É "não". É "não há como saber", e a tela tem de dizer isso em vez de afirmar. */
  INDEFINIDO: "indefinido",
});

export const ORIGEM = Object.freeze({
  PERFIL: "perfil_de_atividades",
  CADASTRO: "cadastro_fiscal",
  SEM_CADASTRO: "sem_cadastro",
  SEM_CATALOGO: "cnae_fora_do_catalogo",
});

/** Só a atividade ATIVA conta. Desativada é atividade que a empresa não exerce. */
const ativa = (a) => a && a.ativo !== false;

/**
 * @param {object} args
 * @param {Array<{cnae, sujeitoFatorR, ativo, impeditivo}>} args.atividades — do perfil fiscal.
 * @param {boolean|null|undefined} args.usaFatorRCadastro — `CadastroFiscal.usaFatorR`.
 * @param {boolean} args.temCadastro — existe linha em `cadastros_fiscais`?
 * @returns {{resposta, origem, motivo, cnaesDeFatorR: string[], divergencia: object|null}}
 */
export function sujeitoAoFatorR({ atividades, usaFatorRCadastro, temCadastro = true } = {}) {
  const lista = Array.isArray(atividades) ? atividades.filter(ativa) : [];
  const doFatorR = lista.filter((a) => a.sujeitoFatorR === true);
  const cnaesDeFatorR = doFatorR.map((a) => String(a.cnae)).filter(Boolean);
  const marcado = usaFatorRCadastro === true;

  // ⚠⚠ O PERFIL VENCE QUANDO AFIRMA. Uma atividade ativa catalogada como `SERVICO_FATOR_R` é o
  // catálogo da RFB dizendo que o anexo sai da folha — o `false` do cadastro não o desmente.
  if (doFatorR.length > 0) {
    return {
      resposta: RESPOSTA.SIM,
      origem: ORIGEM.PERFIL,
      motivo: `${cnaesDeFatorR.length === 1 ? "A atividade" : "As atividades"} `
        + `${cnaesDeFatorR.join(", ")} ${cnaesDeFatorR.length === 1 ? "é sujeita" : "são sujeitas"} `
        + "ao Fator R: o anexo sai da folha (III a partir de 28%, V abaixo), não da escolha.",
      cnaesDeFatorR,
      // ⚠ DIVERGÊNCIA NOMEADA, NÃO CORREÇÃO SILENCIOSA. O perfil e o cadastro discordam, e quem
      // conserta o cadastro é o contador — o sistema só não deixa a discordância passar calada.
      divergencia: marcado ? null : {
        codigo: "CADASTRO_NAO_MARCA_FATOR_R",
        frase: "O cadastro fiscal está com \"usa Fator R\" desmarcado, mas o perfil tem atividade "
          + "sujeita ao Fator R. Vale o perfil — confirme o cadastro.",
      },
    };
  }

  // O contador marcou a caixa. Isso é decisão explícita de uma pessoa e não se rebaixa por
  // observação — mesma disciplina da regra APRENDIDA que nunca suspende uma regra MANUAL.
  if (marcado) {
    return {
      resposta: RESPOSTA.SIM,
      origem: ORIGEM.CADASTRO,
      motivo: "O cadastro fiscal marca \"usa Fator R\".",
      cnaesDeFatorR: [],
      divergencia: {
        codigo: "PERFIL_NAO_TEM_ATIVIDADE_DE_FATOR_R",
        frase: "O cadastro marca \"usa Fator R\", mas nenhuma atividade ATIVA do perfil é de "
          + "Fator R. Vale o cadastro — confira as atividades.",
      },
    };
  }

  // ⚠⚠ DAQUI PARA BAIXO A RESPOSTA SÓ PODE SER "NÃO" SE HOUVER BASE PARA DIZER "NÃO".
  if (!temCadastro) {
    return {
      resposta: RESPOSTA.INDEFINIDO,
      origem: ORIGEM.SEM_CADASTRO,
      motivo: "Sem cadastro fiscal não há como saber se a atividade é sujeita ao Fator R.",
      cnaesDeFatorR: [],
      divergencia: null,
    };
  }

  // Nenhuma atividade ativa reconhecida no catálogo: o catálogo cobre ~10% da CNAE 2.3, então
  // "não achei" é ausência de informação, não ausência de Fator R.
  const catalogadas = lista.filter((a) => a.impeditivo !== true);
  if (catalogadas.length === 0) {
    return {
      resposta: RESPOSTA.INDEFINIDO,
      origem: ORIGEM.SEM_CATALOGO,
      motivo: lista.length === 0
        ? "Nenhuma atividade ativa no perfil fiscal — não há de onde derivar o Fator R."
        : "Nenhuma das atividades ativas está no catálogo de CNAE do portal, então não há como "
          + "derivar o Fator R. Confirme no cadastro fiscal.",
      cnaesDeFatorR: [],
      divergencia: null,
    };
  }

  return {
    resposta: RESPOSTA.NAO,
    origem: ORIGEM.PERFIL,
    motivo: "Nenhuma atividade ativa do perfil é sujeita ao Fator R.",
    cnaesDeFatorR: [],
    divergencia: null,
  };
}
