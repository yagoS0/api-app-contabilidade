// A CATEGORIA DE PRESUNÇÃO DO LUCRO PRESUMIDO, SUGERIDA A PARTIR DO CNAE.
//
// ⚠⚠ ISTO REVERTE, DE FORMA CONTROLADA, UMA DECISÃO ESCRITA DESTE PROJETO — e a reversão é do dono,
// em 25/08/2026, com a forma dela escolhida por ele: **"Sugerir por CNAE, você confirma"**.
//
// O que estava escrito, e continua VALENDO no que importa (`DadosPlanejamentoService`):
//
//   "A atividade do Lucro Presumido NÃO é derivada do CNAE, de propósito: o projeto não tem
//    de-para CNAE→presunção de IRPJ/CSLL (o `CnaeAnexo` mapeia para ANEXO DO SIMPLES, que é outra
//    tabela e outra lei), e errar entre 8% e 32% inverteria a comparação."
//
// Cada palavra disso segue verdadeira. O que muda é o desenho: em vez de **derivar** (o sistema
// decide e calcula), o módulo **sugere** (o sistema propõe, nomeia o que derrubaria a proposta, e
// só o contador confirma). É a mesma forma da regra dos R$ 120.000, e a forma que a própria
// avaliação do dono pediu para as colunas do Perfil Fiscal: *"deveriam vir preenchidas com
// 'sugerido, confirme'"*.
//
// ⚠⚠ E ELE NUNCA DEVOLVE VALOR CONFIRMADO. `confirmadoPeloContador` é sempre `false` aqui — quem o
// vira é uma pessoa, na tela. Um módulo que pudesse devolver `true` acabaria confirmando sozinho na
// primeira refatoração distraída.
//
// ── A BASE DA SUGESTÃO, e por que ela é fraca para SERVIÇO ────────────────────────────────────
//
// A única âncora que existe é `CnaeAnexo.tipoReceitaSugerido`, que mapeia CNAE → **anexo do
// Simples** (LC 123). A presunção é a Lei 9.249/1995, arts. 15 e 20 — outra lei, outra lista.
// A tradução só é segura numa direção:
//
//   REVENDA_MERCADORIA / INDUSTRIALIZACAO → comércio/indústria (IRPJ 8% · CSLL 12%)
//     forte: a lei fala em "venda de mercadorias" e "atividades industriais" no caput, e o
//     catálogo classifica exatamente por isso.
//
//   SERVICO_* → serviços em geral (IRPJ 32% · CSLL 32%)
//     ⚠ FRACA, e é aqui que mora o dinheiro. "Serviço" no Simples e "serviço em geral" na Lei
//     9.249 NÃO são o mesmo conjunto: transporte de cargas é 8%, de passageiros é 16%, serviços
//     HOSPITALARES são 8%, e obra por empreitada com fornecimento de material também sai do 32%.
//     O catálogo não distingue nada disso — ele nunca foi feito para essa pergunta.
//
// Por isso a resposta de serviço vem com `confianca: "media"` e com as exceções NOMEADAS. O
// contador lê o que derrubaria a sugestão e decide; o sistema não decide por ele.

// ⚠⚠ OS CINCO RÓTULOS SÃO CÓPIA, E A CÓPIA É AMARRADA POR TESTE.
//
// A fonte é `ATIVIDADES_PRESUMIDO`, em `apps/web/src/features/planejamento/lib/lucroPresumido.js`
// — onde moram as presunções com a citação da lei. ⚠ Ela NÃO é importável daqui: cruzar os dois
// apps quebra o boot, e este projeto já registra isso ("o backend não é importável do front").
//
// A saída é a MESMA do `"autorizada"` × `whereFaturamentoEmit`: a duplicação existe e fica
// AMARRADA por um teste que lê o arquivo do outro app e exige as mesmas chaves e os mesmos
// rótulos. Muda lá, cai aqui.
//
// ⚠ E só o RÓTULO é copiado. As PRESUNÇÕES (8%, 16%, 32%, 1,6%, 12%) continuam existindo num lugar
// só — duas cópias de alíquota divergiriam, e a divergência sai como imposto errado.
const ROTULO = Object.freeze({
  comercio: "Comércio / Indústria",
  servicos: "Serviços em geral",
  transporteCargas: "Transporte de cargas",
  transportePassageiros: "Transporte de passageiros",
  combustiveis: "Revenda de combustíveis",
});

export const CATEGORIA = Object.freeze({
  COMERCIO: "comercio",
  SERVICOS: "servicos",
  TRANSPORTE_CARGAS: "transporteCargas",
  TRANSPORTE_PASSAGEIROS: "transportePassageiros",
  COMBUSTIVEIS: "combustiveis",
});

export const CONFIANCA = Object.freeze({
  ALTA: "alta",
  MEDIA: "media",
  /** ⚠ Não é "baixa": é "não há de onde sugerir". Ausência de base, não base fraca. */
  NENHUMA: null,
});

/**
 * ⚠ AS EXCEÇÕES QUE DERRUBAM "SERVIÇOS EM GERAL" — lista FECHADA, e cada uma com a razão.
 *
 * Elas NÃO decidem nada: viajam junto da sugestão para o contador ler. Transformá-las em regra
 * exigiria julgar, pelo CNAE, se a empresa é hospitalar / de transporte / de obra com material —
 * três fatos que o cadastro não tem e que a lei condiciona a circunstâncias da operação.
 */
export const EXCECOES_DO_SERVICO = Object.freeze([
  "serviços hospitalares e de auxílio diagnóstico não são \"serviços em geral\": a presunção de IRPJ cai para 8%",
  "transporte de CARGAS é 8% de IRPJ; de PASSAGEIROS, 16% — nenhum dos dois é 32%",
  "obra de construção por empreitada COM fornecimento de material sai dos 32%",
  "a empresa precisa ser prestadora de serviços em geral de fato, não só pelo CNAE",
]);

export const EXCECOES_DO_COMERCIO = Object.freeze([
  "revenda de COMBUSTÍVEL derivado de petróleo, álcool carburante e gás natural presume 1,6%, não 8%",
]);

const DE_TIPO_RECEITA = Object.freeze({
  REVENDA_MERCADORIA: { categoria: CATEGORIA.COMERCIO, confianca: CONFIANCA.ALTA },
  INDUSTRIALIZACAO: { categoria: CATEGORIA.COMERCIO, confianca: CONFIANCA.ALTA },
  SERVICO_ANEXO_III: { categoria: CATEGORIA.SERVICOS, confianca: CONFIANCA.MEDIA },
  SERVICO_ANEXO_IV: { categoria: CATEGORIA.SERVICOS, confianca: CONFIANCA.MEDIA },
  SERVICO_ANEXO_V: { categoria: CATEGORIA.SERVICOS, confianca: CONFIANCA.MEDIA },
  SERVICO_FATOR_R: { categoria: CATEGORIA.SERVICOS, confianca: CONFIANCA.MEDIA },
  // ⚠ `RECEITA_NAO_CLASSIFICADA` fica FORA de propósito: ela é o "não sei" do classificador, e
  // traduzi-la em categoria seria transformar uma ausência em resposta.
});

/**
 * @param {{cnae?: string, tipoReceita?: string, descricao?: string}} atividade
 * @returns {{
 *   categoria: string|null, rotulo: string|null, confianca: string|null, motivo: string,
 *   excecoes: string[], confirmadoPeloContador: false
 * }}
 */
export function sugerirCategoriaPresumido(atividade = {}) {
  const { cnae, tipoReceita, descricao } = atividade;
  const de = DE_TIPO_RECEITA[String(tipoReceita || "")];

  if (!de) {
    // ⚠ SEM SUGESTÃO NÃO É "SERVIÇOS". Medido em 25/08/2026: 18 dos 64 CNAEs da carteira estão
    // FORA do catálogo do portal (127 de ~1.330 subclasses). Cair no default de serviços ali
    // afirmaria 32% para quem pode ser 8% — a maior diferença isolada do comparativo.
    return {
      categoria: null,
      rotulo: null,
      confianca: CONFIANCA.NENHUMA,
      motivo: cnae
        ? `O CNAE ${cnae} não está no catálogo do portal, então não há de onde sugerir a categoria `
          + "de presunção. Escolha na tela."
        : "Sem CNAE não há de onde sugerir a categoria de presunção. Escolha na tela.",
      excecoes: [],
      confirmadoPeloContador: false,
    };
  }

  const ehServico = de.categoria === CATEGORIA.SERVICOS;
  return {
    categoria: de.categoria,
    rotulo: ROTULO[de.categoria] || null,
    confianca: de.confianca,
    motivo: ehServico
      ? `O CNAE ${cnae || "informado"}${descricao ? ` (${descricao})` : ""} é de SERVIÇO no catálogo do `
        + "Simples. Isso SUGERE \"serviços em geral\" (32%), mas o catálogo mapeia anexo do Simples — "
        + "outra lei — e não distingue as exceções da presunção. Confirme."
      : `O CNAE ${cnae || "informado"}${descricao ? ` (${descricao})` : ""} é de mercadoria/indústria no `
        + "catálogo, o que corresponde à regra geral de 8% de IRPJ e 12% de CSLL. Confirme.",
    excecoes: ehServico ? [...EXCECOES_DO_SERVICO] : [...EXCECOES_DO_COMERCIO],
    // ⚠⚠ SEMPRE `false`. Quem confirma é uma pessoa, na tela.
    confirmadoPeloContador: false,
  };
}

/**
 * A sugestão para a EMPRESA, a partir do perfil de atividades.
 *
 * ⚠⚠ ATIVIDADES ATIVAS QUE DISCORDAM ⇒ NENHUMA SUGESTÃO. Uma empresa com CNAE de comércio E de
 * serviço não tem "a" categoria: no Presumido cada receita tem a sua presunção, e escolher uma
 * delas pelo maior número de CNAEs seria eleger por contagem um número que decide imposto.
 * Mesma disciplina do `DIVIDIDO` do motor de sugestão de conta e do `AMBIGUO` do vínculo de
 * telefone — ambiguidade não se resolve escolhendo.
 */
export function sugerirCategoriaDaEmpresa(atividades = []) {
  const ativas = (Array.isArray(atividades) ? atividades : []).filter((a) => a && a.ativo !== false);
  if (!ativas.length) {
    return {
      categoria: null, rotulo: null, confianca: CONFIANCA.NENHUMA,
      motivo: "Nenhuma atividade ativa no perfil fiscal — não há de onde sugerir a categoria.",
      excecoes: [], confirmadoPeloContador: false,
    };
  }

  // ⚠ A atividade PADRÃO manda, quando existe: ela é a escolha que o contador já fez.
  const padrao = ativas.find((a) => a.padrao);
  if (padrao) return sugerirCategoriaPresumido(padrao);

  const sugestoes = ativas.map(sugerirCategoriaPresumido);
  const categorias = new Set(sugestoes.map((s) => s.categoria).filter(Boolean));

  if (categorias.size === 0) return sugestoes[0];
  if (categorias.size > 1) {
    return {
      categoria: null, rotulo: null, confianca: CONFIANCA.NENHUMA,
      motivo: "As atividades ativas do perfil apontam para categorias DIFERENTES de presunção "
        + `(${[...categorias].map((c) => ROTULO[c] || c).join(" e ")}). `
        + "No Lucro Presumido cada receita tem a sua presunção — escolher uma pelo número de CNAEs "
        + "seria eleger por contagem um número que decide imposto. Escolha na tela, "
        + "ou marque a atividade padrão no perfil fiscal.",
      excecoes: [], confirmadoPeloContador: false,
    };
  }

  // ⚠ Todas concordam: a confiança é a MAIS FRACA entre elas, nunca a mais forte.
  const unica = sugestoes.find((s) => s.categoria);
  const temMedia = sugestoes.some((s) => s.confianca === CONFIANCA.MEDIA);
  return { ...unica, confianca: temMedia ? CONFIANCA.MEDIA : unica.confianca };
}
