// A LEITURA DE TELA DA FILA DE CONFERÊNCIA — pura, testável, sem React.
//
// ⚠ O QUE MORA AQUI E O QUE NÃO MORA. A REGRA é do backend
// (`application/declarados/lib/estadosDeclarado.js`): quem decide se uma transição pode acontecer é
// o servidor, sempre. Aqui vive só o que é de TELA — rótulo em português, token de cor, ordem, e a
// decisão de qual botão sequer aparece. Reimplementar `podeTransitar` no front faria a tela oferecer
// o que o servidor recusa (ou esconder o que ele aceita), e a divergência apareceria como "cliquei e
// não aconteceu nada".
//
// ⚠⚠ A LEI DE COR DESTE PROJETO, aplicada aqui letra por letra (`apps/web/CLAUDE.md`):
// `--state-ok` é CONCLUÍDO · `--state-warn` é PENDÊNCIA (ação rápida) · `--state-danger` BLOQUEIA o
// fechamento · `--state-neutral` é o padrão. Usar um fora do significado recria o problema que o
// redesign resolveu: quando quase tudo é vermelho, nada se destaca.

/** ⚠ Espelho do vocabulário do backend. Valor novo lá que não chegue aqui cai em `desconhecido`. */
export const ESTADO = Object.freeze({
  AGUARDANDO_PAGAMENTO: "AGUARDANDO_PAGAMENTO",
  A_CONFERIR: "A_CONFERIR",
  CONTABILIZADO: "CONTABILIZADO",
  RECUSADO: "RECUSADO",
  FUNDIDO: "FUNDIDO",
});

export const ORIGEM_PAGAMENTO = Object.freeze({
  OFX: "OFX",
  DECLARADO_PELO_CONTADOR: "DECLARADO_PELO_CONTADOR",
  CLIENTE: "CLIENTE",
});

/** ⚠ O recorte das que chegaram sem competência. É o MESMO literal que a rota aceita. */
export const COMPETENCIA_AUSENTE = "sem-competencia";

/**
 * Como cada estado se lê na tela.
 *
 * ⚠⚠ `AGUARDANDO_PAGAMENTO` É NEUTRO, NUNCA ÂMBAR — e isto é o achado mais fácil de desfazer sem
 * querer. Nota sem pagamento identificado **não é pendência nossa: é a resposta certa**. Âmbar ali
 * diria que o sistema falhou em alguma coisa, e um âmbar permanente treina o olho a ignorar a cor
 * que significa "falta fazer" (o mesmo defeito do menu do SERPRO, registrado no `CLAUDE.md` do web).
 *
 * ⚠ `RECUSADO` também é NEUTRO, não vermelho: vermelho, nesta casa, **bloqueia o fechamento** — e
 * uma despesa recusada não bloqueia nada. É a mesma disciplina que tirou o `--state-danger` da aba
 * de Auditoria.
 */
const LEITURA_DO_ESTADO = Object.freeze({
  [ESTADO.AGUARDANDO_PAGAMENTO]: {
    rotulo: "Sem pagamento identificado",
    token: "--state-neutral",
    // ⚠ A frase diz o que é, não o que falta. "Pendente" faria parecer erro nosso.
    frase: "A nota chegou; o pagamento ainda não foi identificado. Ela não vira lançamento enquanto a data não for conhecida.",
    ordem: 1,
  },
  [ESTADO.A_CONFERIR]: {
    rotulo: "A conferir",
    token: "--state-warn",
    frase: "Tem data de pagamento e espera a conferência do contador.",
    ordem: 0,
  },
  [ESTADO.CONTABILIZADO]: {
    rotulo: "Contabilizado",
    token: "--state-ok",
    frase: "Virou lançamento contábil.",
    ordem: 2,
  },
  [ESTADO.RECUSADO]: {
    rotulo: "Recusado",
    token: "--state-neutral",
    frase: "O contador recusou esta despesa. Pode ser reaberta.",
    ordem: 3,
  },
  [ESTADO.FUNDIDO]: {
    rotulo: "Absorvido",
    token: "--state-neutral",
    frase: "Este débito do extrato virou o pagamento de uma nota, e por isso não aparece como despesa própria.",
    ordem: 4,
  },
});

const ESTADO_DESCONHECIDO = Object.freeze({
  rotulo: "Estado desconhecido",
  token: "--state-neutral",
  // ⚠ Estado novo no backend chega aqui como incógnita. Dizer "desconhecido" é honesto; escolher um
  // rótulo bonito faria a tela afirmar algo sobre um estado que ela não conhece.
  frase: "Este estado não é conhecido por esta tela. Confira a versão do sistema.",
  ordem: 9,
});

export function leituraDoEstado(estado) {
  return LEITURA_DO_ESTADO[estado] || ESTADO_DESCONHECIDO;
}

/**
 * ⚠⚠ A PROCEDÊNCIA DA DATA DE PAGAMENTO — o campo mais importante desta tela.
 *
 * Decisão do dono (24/08/2026): o contador pode lançar a despesa **sem comprovante**, informando a
 * data ele mesmo. O que separa isso de um pagamento provado pelo extrato é UMA COLUNA, e se a tela
 * não a mostrar o contador olha para duas linhas idênticas sem saber qual delas o banco confirmou.
 *
 * Mesma disciplina da baixa manual de parcela, que já grava `origemBaixa: "MANUAL"` e escreve
 * "(declarado)" no histórico — *"o contador precisa saber qual das duas está fazendo"*.
 */
const LEITURA_DA_ORIGEM = Object.freeze({
  [ORIGEM_PAGAMENTO.OFX]: {
    rotulo: "Extrato bancário",
    ehProva: true,
    frase: "A data veio do extrato importado — é prova do pagamento.",
  },
  [ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR]: {
    rotulo: "Declarado",
    ehProva: false,
    // ⚠ "declaração, não prova" é literal de propósito. É o que o contador precisa ler.
    frase: "A data foi informada pelo contador, sem comprovante. É declaração, não prova.",
  },
  [ORIGEM_PAGAMENTO.CLIENTE]: {
    rotulo: "Informado pelo cliente",
    ehProva: false,
    frase: "A data veio do cliente, sem comprovante. É declaração, não prova.",
  },
});

/**
 * ⚠⚠ AUSÊNCIA NUNCA VIRA PROVA. `origemPagamento` nulo devolve `ehProva: false` com o motivo — nunca
 * um objeto vazio, e nunca o rótulo do OFX por default. É a mesma família do
 * `Number.isFinite(Number(null))` que já custou um "0%" na tela do cliente.
 */
export function leituraDaOrigemDoPagamento(origem) {
  if (!origem) {
    return {
      rotulo: "Sem data",
      ehProva: false,
      frase: "Nenhuma data de pagamento foi informada até agora.",
    };
  }
  return (
    LEITURA_DA_ORIGEM[origem] || {
      rotulo: "Procedência desconhecida",
      ehProva: false,
      frase: "Esta tela não reconhece a procedência desta data. Confira a versão do sistema.",
    }
  );
}

/**
 * Quais ações a tela OFERECE para uma linha.
 *
 * ⚠⚠ ISTO NÃO É A GUARDA, e a distinção importa. Quem recusa continua sendo `aplicarTransicao`, no
 * servidor, que enxerga o estado do instante do clique. Esta função existe para a tela não oferecer
 * um botão que vai voltar recusado — o precedente do menu SERPRO: *"a resposta do POST chegaria
 * tarde demais"*.
 *
 * ⚠ Mapa de INCLUSÃO, como o `ORIGENS_VALIDAS` do backend: estado novo nasce **sem ação nenhuma**,
 * não com todas.
 */
const ACOES_POR_ESTADO = Object.freeze({
  [ESTADO.AGUARDANDO_PAGAMENTO]: ["informar-pagamento", "confirmar", "recusar"],
  [ESTADO.A_CONFERIR]: ["confirmar", "ajustar", "recusar"],
  [ESTADO.CONTABILIZADO]: ["desfazer"],
  [ESTADO.RECUSADO]: ["reabrir"],
  [ESTADO.FUNDIDO]: [],
});

/** ⚠ Vocabulário FECHADO das ações, com o rótulo e o peso visual de cada uma. */
export const ACAO = Object.freeze({
  "informar-pagamento": {
    rotulo: "Informar pagamento",
    // ⚠ `accent`, nunca verde: verde é CONCLUÍDO nesta casa, e um botão verde de "faça isto" ensina
    // o contrário exatamente onde o verde precisa significar "está fechado".
    tom: "accent",
    // ⚠⚠ A data é OBRIGATÓRIA no mesmo ato — é a invariante do caixa. A tela pergunta antes de
    // enviar; ela não manda um POST que vai voltar `sem_data_de_pagamento`.
    pedeData: true,
  },
  confirmar: {
    rotulo: "Confirmar",
    tom: "accent",
    // ⚠ Confirmar a partir de AGUARDANDO_PAGAMENTO exige a data junto (o atalho do dono). A partir
    // de A_CONFERIR a data já existe. Quem decide é `acaoPedeData`, abaixo.
    criaLancamento: true,
  },
  ajustar: { rotulo: "Ajustar valor", tom: "neutro", criaLancamento: true, pedeValor: true },
  recusar: { rotulo: "Recusar", tom: "neutro", pedeMotivo: true },
  reabrir: { rotulo: "Reabrir", tom: "neutro" },
  desfazer: { rotulo: "Desfazer lançamento", tom: "perigo", desfazLancamento: true },
});

/**
 * ⚠ O tom da ação → a `variant` do `Button`, num mapa NOMEADO e testado.
 *
 * ⚠⚠ `success` NÃO EXISTE no `Button` deste app, de propósito: verde significa CONCLUÍDO, e um
 * botão verde de "faça isto" ensina o contrário. Tom desconhecido cai em `secondary` — o mais
 * discreto —, nunca em `primary`: promover um botão que ninguém classificou é o erro caro.
 */
const VARIANT_DO_TOM = Object.freeze({ accent: "primary", neutro: "secondary", perigo: "danger" });

export function variantDoTom(tom) {
  return VARIANT_DO_TOM[tom] || "secondary";
}

export function acoesDaLinha(item) {
  const base = ACOES_POR_ESTADO[item?.estado] || [];
  return base.filter((a) => ACAO[a]);
}

/**
 * ⚠⚠ CONFIRMAR SEM DATA PRECISA PEDIR A DATA — senão o POST volta `sem_data_de_pagamento` e o
 * contador lê como "o sistema está quebrado".
 *
 * O atalho do dono (confirmar direto de `AGUARDANDO_PAGAMENTO`) só é legal **com a data no mesmo
 * ato**. A tela pergunta; ela não descobre a regra pelo erro.
 */
export function acaoPedeData(acao, item) {
  if (ACAO[acao]?.pedeData) return true;
  if (acao === "confirmar" || acao === "ajustar") return !item?.dataPagamento;
  return false;
}

/**
 * ⚠ A data nasce pré-preenchida com a EMISSÃO DA NOTA — a única data que o documento oferece —, à
 * vista e trocável.
 *
 * ⚠⚠ NUNCA COM "HOJE". Hoje é a data do CLIQUE, e a invariante 3 do plano a proíbe: ela afirmaria
 * que a empresa pagou no instante em que alguém abriu a tela. Sem data no documento, o campo nasce
 * VAZIO e o contador digita — vazio é honesto, um palpite não é.
 */
export function dataSugeridaParaPagamento(item) {
  return item?.dataPagamento || item?.dataDocumento || "";
}

/**
 * Por que uma ação está desabilitada — ou `null` se ela pode acontecer.
 *
 * ⚠ O motivo é devolvido junto, sempre. Botão desabilitado e mudo é o defeito que a aba de Guias já
 * pagou: o contador não sabe se é falta de permissão, mês fechado ou defeito.
 */
export function motivoDeBloqueio(acao, item, { podeEscrever = true } = {}) {
  if (!podeEscrever) return "Seu perfil não pode alterar lançamentos desta empresa.";

  const cfg = ACAO[acao];
  if (!cfg) return "Ação desconhecida.";

  // ⚠⚠ MÊS FECHADO BLOQUEIA NOS DOIS SENTIDOS, e é o servidor que recusa (409). Contabilizar
  // escreveria num mês fechado sem rastro de reabertura; desfazer apagaria lançamento que o
  // fechamento já conferiu.
  if (item?.mesFechado && (cfg.criaLancamento || cfg.desfazLancamento)) {
    return "A competência está fechada. Reabra o mês para mexer no lançamento.";
  }

  // ⚠ Competência nula não vira lançamento, e NÃO é deduzida da data — seria o sistema decidindo em
  // qual apuração a despesa entra. A recusa aparece ANTES do clique, com o conserto nomeado.
  if (cfg.criaLancamento && !item?.competencia) {
    return "Esta nota chegou sem competência. Defina a competência antes de contabilizar.";
  }

  // ⚠⚠ SEM CONTA NÃO SE CONTABILIZA — e o servidor recusa com `sem_conta`.
  //
  // Achado por auditoria em 25/08/2026: a tela oferecia "Confirmar" em toda linha, inclusive nas que
  // não têm conta nenhuma (débito de extrato, nota de fornecedor novo). O clique ia ao servidor e
  // voltava recusado — a tela descobrindo a regra pelo erro, que é justamente o que este pré-voo
  // existe para impedir.
  //
  // A conta vem da SUGESTÃO (regra ou histórico, derivada a cada leitura) ou da coluna
  // `contaSugerida`, gravada quando o declarado nasceu.
  //
  // ⚠ LIMITAÇÃO DECLARADA: não há seletor de conta nesta tela. Enquanto não houver, a linha sem
  // conta conhecida **não é contabilizável por aqui** — e o certo é DIZER isso, não oferecer um
  // botão que falha. O caminho hoje é lançar por Lançamentos, ou criar a regra do fornecedor.
  if (cfg.criaLancamento && !contaQueSeraUsada(item)) {
    // ⚠⚠ "NÃO SEI QUAL CONTA" E "SEI, E ELA NÃO SERVE" PEDEM CONSERTOS OPOSTOS — e a frase genérica
    // dava o conselho ERRADO para o segundo caso. Com a conta conhecida sendo SINTÉTICA, mandar
    // "confirme uma vez para o sistema aprender" reensinaria a MESMA regra torta, e ela sugeriria a
    // mesma conta de agregação no mês seguinte. O conserto é corrigir a regra, não alimentá-la.
    // ⚠ A frase do SERVIDOR vence quando ela existe (`sugestao.frase`) — ela nomeia a conta e diz o
    // que fazer. Mesmo princípio do `ONDE_CONFIGURA_EMISSAO` e da `correcao` da emissão de NFS-e.
    // ⚠ Nos dois casos a frase do SERVIDOR vence quando existe (`sugestao.frase`) — ela nomeia a
    // conta e diz o que fazer. Nenhum dos dois se conserta "confirmando para o sistema aprender":
    // um pede corrigir a REGRA, o outro pede corrigir o PLANO.
    if (MOTIVO_COM_CONTA_CONHECIDA.has(item?.sugestao?.motivo)) {
      return item?.sugestao?.frase || FRASE_LOCAL_DO_MOTIVO[item.sugestao.motivo];
    }
    return "Nenhuma conta conhecida para esta despesa. Escolha a conta em Lançamentos, ou confirme uma vez este fornecedor para o sistema aprender.";
  }

  return null;
}

/**
 * ⚠⚠ "NÃO SEI QUAL CONTA" E "SEI, E ELA NÃO SERVE" PEDEM CONSERTOS OPOSTOS.
 *
 * Estes dois motivos dizem que existe conta conhecida e que ela é que está errada. A frase genérica
 * ("confirme uma vez este fornecedor para o sistema aprender") dá, para eles, o conselho ERRADO:
 * confirmar reensinaria a mesma regra torta, e ela sugeriria a mesma conta no mês seguinte.
 *
 * ⚠ Lista de INCLUSÃO: motivo novo do servidor cai no texto genérico até alguém decidir o dele —
 * conselho errado é pior que conselho genérico.
 */
export const MOTIVO_COM_CONTA_CONHECIDA = new Set([
  "conta_sintetica",
  "conta_ambigua",
  // ⚠ `fora_da_faixa` entrou depois, achado NA TELA em 26/08/2026: a linha mostrava
  // "valor fora do normal" na coluna e o botão dizia "Nenhuma conta conhecida" — a mesma linha
  // afirmando as duas coisas. Existe regra; o que fugiu foi o VALOR, e o conserto é conferir o
  // valor, não ensinar o fornecedor de novo.
  "fora_da_faixa",
]);

/**
 * ⚠ FALLBACK, só. A frase que vale é a do SERVIDOR (`sugestao.frase`), que nomeia a conta. Esta
 * existe para o caso de ela não vir — e é cópia literal de `FRASE_DO_SEM_SUGESTAO` (backend), nunca
 * um segundo texto: duas redações fariam a tela dizer uma coisa e a recusa do clique outra.
 */
export const FRASE_LOCAL_DO_MOTIVO = Object.freeze({
  conta_sintetica:
    "A conta conhecida para esta despesa é sintética (de agregação) e não recebe lançamento. "
    + "Escolha uma conta analítica abaixo dela — e corrija a regra, senão ela sugere o mesmo no mês que vem.",
  conta_ambigua:
    "Duas contas do plano desta empresa têm o mesmo código completo. O sistema não escolhe entre elas.",
  fora_da_faixa:
    "Há uma regra para esta despesa, mas o valor está fora da faixa dela. Confira antes de aplicar.",
});

/** ⚠ O rótulo curto da coluna. `null` = não há texto próprio, cai em "sem conta". */
export const ROTULO_CURTO_DO_MOTIVO = Object.freeze({
  fora_da_faixa: "valor fora do normal",
  conta_sintetica: "conta é de agregação",
  conta_ambigua: "conta ambígua",
});

/**
 * ⚠ Qual conta o servidor usaria se esta linha fosse confirmada agora.
 *
 * A ordem espelha `podeTransitar`: o que o ato traz vence, e a **sugestão derivada** (regra ou
 * histórico, recalculada a cada leitura) vence a coluna `contaSugerida`, que foi gravada quando o
 * declarado nasceu e pode estar velha — uma regra criada depois não a atualizou.
 *
 * ⚠ Devolve `null` quando não há nenhuma: é o que o pré-voo usa para bloquear o botão COM motivo.
 */
export function contaQueSeraUsada(item) {
  const daSugestao = item?.sugestao?.conta;
  if (daSugestao) return String(daSugestao);
  if (item?.contaSugerida) return String(item.contaSugerida);
  return null;
}

/**
 * ⚠⚠ A LINHA DA NOTA ABRE O DOCUMENTO — e quando não pode, ela DIZ POR QUÊ.
 *
 * A FK é `SetNull`: a nota pode ter sido apagada. Esconder o link faria parecer que aquele declarado
 * nunca teve documento; desabilitá-lo com o motivo é a resposta honesta.
 */
export function leituraDoDocumento(item) {
  if (item?.origem === "OFX_CLIENTE") {
    return { temDocumento: false, motivo: "Veio do extrato bancário — não há nota vinculada." };
  }
  if (!item?.nota) {
    return { temDocumento: false, motivo: "A nota de origem não está mais na base." };
  }
  const { numero, serie, tipo } = item.nota;
  return {
    temDocumento: true,
    // ⚠ Traço para o componente ausente, nunca uma string colada que esconda a falta.
    rotulo: `${tipo || "Nota"} ${numero || "—"}${serie ? `/${serie}` : ""}`,
    chaveAcesso: item.nota.chaveAcesso || null,
  };
}

/**
 * O agrupamento da fila por FORNECEDOR.
 *
 * ⚠⚠ É ISTO QUE TORNA A FILA CONFERÍVEL. São 1.897 notas recebidas na base; 229 entram só com o
 * piso de julho. Uma lista plana de 229 linhas não é fila, é muro — e o contador confere por
 * fornecedor, não por ordem de chegada.
 *
 * ⚠ A chave é o CNPJ quando existe, e o NOME quando não existe. Nunca o contrário: dois fornecedores
 * podem ter nomes parecidos, mas o CNPJ identifica. Sem CNPJ (o caso do débito de extrato), o nome é
 * tudo que há — e agrupar por ele é melhor que jogar todos num balde "sem fornecedor".
 */
export function agruparPorFornecedor(itens) {
  const grupos = new Map();
  for (const item of itens || []) {
    const chave = item?.cnpjFornecedor || `nome:${item?.descricaoOriginal || ""}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        cnpj: item?.cnpjFornecedor || null,
        nome: item?.descricaoOriginal || "Sem descrição",
        itens: [],
        total: 0,
      });
    }
    const g = grupos.get(chave);
    g.itens.push(item);
    // ⚠ O valor AJUSTADO vence o original quando existe — é ele que vira lançamento.
    const v = Number(item?.valorAjustado ?? item?.valor);
    if (Number.isFinite(v)) g.total += v;
  }
  // ⚠ Ordem por VOLUME, não alfabética: o fornecedor que concentra dinheiro é o que o contador
  // precisa conferir primeiro. Empate desempata pelo nome, para a ordem ser estável entre recargas.
  return [...grupos.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

/**
 * O painel de contagem, a partir do `porEstado` do servidor.
 *
 * ⚠⚠ O TOTAL VEM DO `groupBy` DO SERVIDOR, NUNCA DE `itens.length`. Lista paginada como total
 * mentiria exatamente na empresa em que o problema é grande — o defeito que a auditoria de notas já
 * pagou com as notas sem competência.
 *
 * ⚠ Estado com zero aparece com zero. Sumir faria "não há nenhum" e "não perguntei" ficarem iguais.
 */
export function contagemParaTela(porEstado) {
  const bruto = porEstado || {};
  return Object.values(ESTADO)
    .map((estado) => ({
      estado,
      ...leituraDoEstado(estado),
      // ⚠ `Number(undefined)` é `NaN`, que renderiza como "NaN" na tela. O `|| 0` aqui é seguro
      // porque a ausência de um estado no groupBy significa literalmente zero linhas dele.
      quantidade: Number(bruto[estado]) || 0,
    }))
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * ⚠ Formatação de dinheiro numa função só — a tela nunca monta `R$` à mão.
 *
 * ⚠⚠ `Number(null)` É `0`, E `Number.isFinite(0)` É `true`. Sem a guarda de ausência, valor ausente
 * imprimiria **R$ 0,00** — que AFIRMA que a despesa é de zero reais, em vez de dizer que não se
 * sabe. É a mesma família do `folhaAusenteNaoEZero` e do "0%" que já foi parar na tela do cliente.
 * Zero INFORMADO continua imprimindo R$ 0,00: a distinção é ausência × afirmação.
 */
export function dinheiro(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * ⚠ A data vem do servidor como `AAAA-MM-DD` (dia civil, sem fuso).
 *
 * ⚠⚠ NÃO USE `new Date("2026-07-15")` AQUI. O construtor lê a string como **UTC** e `toLocaleDateString`
 * a devolve no fuso local — no Brasil (UTC−3) isso imprime **14/07**, um dia antes. É o defeito que
 * o lote de NFS-e já registrou ("a data sai com os mesmos acessadores, nunca em ISO").
 */
export function dataCivil(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ⚠ CNPJ formatado; o que não tiver 14 dígitos volta como veio, nunca truncado nem completado. */
export function cnpjFormatado(cnpj) {
  const d = String(cnpj || "").replace(/\D+/g, "");
  if (d.length !== 14) return cnpj || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O CASAMENTO DÉBITO × NOTA
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚠ Por que um débito ficou sem sugestão. Vocabulário FECHADO, espelho do backend. */
export const SEM_CASAMENTO = Object.freeze({
  NENHUM_CANDIDATO: "nenhum_candidato",
  AMBIGUO: "ambiguo",
});

/**
 * Como cada resposta do casamento se desenha.
 *
 * ⚠⚠ `AMBIGUO` NÃO É ERRO, e a cor precisa dizer isso. Dois candidatos é o sistema **funcionando**:
 * ele viu duas notas parecidas e se RECUSOU a escolher, que é a regra. Vermelho ali diria que algo
 * quebrou; âmbar diz o certo — *há uma decisão sua esperando*.
 *
 * ⚠ `NENHUM_CANDIDATO` é NEUTRO: um débito sem nota correspondente é comum e legítimo (despesa sem
 * nota, ou a nota ainda não chegou). Pintá-lo de âmbar encheria a tela de pendência falsa.
 */
const LEITURA_DO_CASAMENTO = Object.freeze({
  sugerido: {
    rotulo: "Sugestão",
    token: "--state-warn",
    // ⚠ "Sugestão", nunca "Casado" — o sistema NUNCA automatiza aqui, e o rótulo tem de lembrar.
    frase: "Uma nota se parece com este débito. Confira antes de casar — o sistema não decide isso sozinho.",
  },
  [SEM_CASAMENTO.AMBIGUO]: {
    rotulo: "Mais de uma nota",
    token: "--state-warn",
    frase: "Duas ou mais notas se parecem com este débito. O sistema não escolhe entre elas.",
  },
  [SEM_CASAMENTO.NENHUM_CANDIDATO]: {
    rotulo: "Sem nota correspondente",
    token: "--state-neutral",
    frase: "Nenhuma nota em aberto se parece com este débito. Pode ser despesa sem nota, ou a nota ainda não chegou.",
  },
});

export function leituraDoCasamento(linha) {
  if (linha?.sugestao) return LEITURA_DO_CASAMENTO.sugerido;
  return (
    LEITURA_DO_CASAMENTO[linha?.motivo] || {
      rotulo: "Situação desconhecida",
      token: "--state-neutral",
      frase: "Esta tela não reconhece esta resposta. Confira a versão do sistema.",
    }
  );
}

/**
 * ⚠⚠ QUANDO O BOTÃO "CASAR" PODE APARECER.
 *
 * SÓ com sugestão única. Com dois candidatos **não existe botão nenhum** — nem "casar com o
 * primeiro", nem "escolher". A tela mostra os dois e o contador resolve na fila, informando o
 * pagamento na nota certa.
 *
 * ⚠ Oferecer um "casar" ao lado de cada candidato pareceria inofensivo e **desfaria a regra**: a
 * ambiguidade existe para o sistema não decidir, e um clique fácil converte a decisão dele numa
 * decisão do dedo de quem está com pressa.
 */
export function podeCasar(linha) {
  return Boolean(linha?.sugestao?.nota?.id && linha?.debito?.id);
}

/** ⚠ A ordem: o que tem decisão esperando primeiro; o que não tem nota, por último. */
export function ordenarCasamentos(linhas) {
  const peso = (l) => (l?.sugestao ? 0 : l?.motivo === SEM_CASAMENTO.AMBIGUO ? 1 : 2);
  return [...(linhas || [])].sort((a, b) => peso(a) - peso(b));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A VARREDURA DAS NOTAS
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠⚠ A DATA-PISO NÃO TEM DEFAULT, E ISSO É A REGRA — não uma lacuna a preencher.
 *
 * São 1.897 NFS-e recebidas na base. Sem corte, a primeira varredura produz a base inteira de uma
 * vez, e isso não é fila, é muro. Um default aqui faria a TELA escolher, em silêncio, o tamanho do
 * trabalho que o contador vai encontrar — que é decisão dele.
 *
 * O servidor recusa sem `desde` (400 `data_piso_obrigatoria`); esta função existe para a tela não
 * precisar descobrir isso pelo erro.
 */
export function dataPisoEhValida(desde) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(desde || ""));
}

/**
 * O relatório da varredura, pronto para a tela.
 *
 * ⚠⚠ O RELATÓRIO SAI INTEIRO. Um "criei 12" sozinho esconderia o que NÃO entrou — e deixaria
 * "não veio nada" indistinguível de "deu erro". As três categorias são respostas diferentes:
 * criadas (entrou), já existiam (idempotência funcionando), fora/recusadas (não entrou, e por quê).
 */
export function leituraDaVarredura(r) {
  if (!r) return null;
  const criados = Number(r.criados) || 0;
  const jaExistiam = Number(r.jaExistiam) || 0;
  const fora = Array.isArray(r.fora) ? r.fora.length : 0;
  const recusados = Array.isArray(r.recusados) ? r.recusados : [];
  return {
    varridas: Number(r.varridas) || 0,
    criados,
    jaExistiam,
    fora,
    recusados,
    // ⚠ Rodar de novo e ver "0 novas · 12 já existiam" é a IDEMPOTÊNCIA funcionando, não falha. A
    // tela precisa dizer isso, senão o contador roda três vezes achando que não funcionou.
    tudoJaExistia: criados === 0 && jaExistiam > 0,
    // ⚠ Nada varrido é diferente de nada criado: no primeiro, o piso não alcançou nota nenhuma.
    nadaVarrido: (Number(r.varridas) || 0) === 0,
  };
}

/** ⚠ Motivos de recusa da varredura, em português. Desconhecido volta CRU, nunca traduzido a esmo. */
const FRASE_DA_RECUSA = Object.freeze({
  sem_valor: "A nota não tem valor.",
  sem_data: "A nota não tem data de emissão.",
  sem_emitente: "A nota não identifica o emitente.",
  cancelada: "A nota foi cancelada.",
  substituida: "A nota foi substituída por outra.",
  anterior_ao_piso: "A nota é anterior à data escolhida.",
});

export function fraseDaRecusa(motivo) {
  // ⚠ Motivo novo no backend aparece CRU na tela em vez de sumir ou virar "erro desconhecido":
  // o contador vê o código e pode perguntar, e nada se esconde.
  return FRASE_DA_RECUSA[motivo] || motivo || "Sem motivo informado.";
}
