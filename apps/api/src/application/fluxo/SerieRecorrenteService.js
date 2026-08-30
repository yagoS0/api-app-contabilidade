// A LIGAÇÃO DO DETECTOR DE RECORRÊNCIA COM O BANCO.
//
// ⚠⚠ ELE OBSERVA E ELE GRAVA A MARCAÇÃO — e são duas coisas diferentes, de propósito.
//
// Quem OBSERVA é `lib/recorrencia.js`, que é PURO: ele recebe observações e devolve uma leitura, e
// **nada do que ele devolve é gravado**. O que esta tabela guarda é a DECISÃO do contador — é ela
// que põe a linha no fluxo de caixa. Gravar a observação faria a tela mostrar um fato onde há uma
// sugestão, que é exatamente o que o desenho inteiro existe para impedir.
//
// > Dono, 25/08/2026: *"deve haver uma forma de o contador indicar se aquilo é recorrente ou não, e
// > parte do software entender se é mesmo, ou não."*
//
// ⚠⚠ A CHAVE É A CONTRAPARTE, não a conta — é como o dono formulou os dois exemplos (*"a Claude"*,
// *"o mesmo cliente"*). `tomadorDoc` na receita, `emitenteDoc` na despesa.
//
// ─── ⚠⚠ O QUE ESTE SERVIÇO **NÃO** ALCANÇA, E POR QUÊ ────────────────────────────────────────
//
// **A despesa SEM NOTA (o débito de extrato) não forma série hoje.** A chave dela teria de ser a
// descrição canonizada, e `chaveDaDescricao` (`declarados/lib/motorDeSugestao.js`) **não remove
// datas**: o memo `ANTHROPIC* CLAUDE.AI 08/26` vira `ANTHROPIC CLAUDE AI 08 26`, e em setembro vira
// outra chave. A série nunca formaria — cada mês seria uma série de UMA observação.
//
// ⚠ Por isso ela não é lida em silêncio: sai contada e NOMEADA em `foraDoAlcance`. O plano já nomeia
// o conserto (reusar `normalizarHistorico`, num lugar só) e ele é pré-requisito, não detalhe.
//
// ⚠⚠ E A PERIODICIDADE DE UMA SÉRIE AINDA NÃO MARCADA É LIDA COMO **MENSAL**. Não há de onde deduzi-
// la: ler a mesma série nas três periodicidades e escolher a que "fecha" seria o sistema decidindo
// qual é o padrão. A consequência está dita e é o desenho do plano — a **taxa anual do Conselho não
// é DETECTADA**, ela é **DECLARADA** (pelo contador ou pelo cliente), e a partir daí a periodicidade
// gravada é que manda nas leituras seguintes. É por isso que a coluna existe.

import { prisma } from "../../infrastructure/db/prisma.js";
// ⚠ REUSADA, nao reescrita: é a canonizacao de descricao que esta casa ja tem. Uma terceira faria
// a gravacao e a leitura da mesma chave divergirem — o defeito que o cabecalho daquele arquivo
// documenta.
import { chaveDaDescricao } from "../declarados/lib/motorDeSugestao.js";
import { whereFaturamentoEmit } from "../notas/apuracao/v2/FechamentoService.js";
import {
  LEITURA,
  PERIODICIDADE,
  fraseDaBase,
  lerSerie,
} from "./lib/recorrencia.js";

/** ⚠ Os dois lados, com a MESMA forma. Vocabulário FECHADO. */
export const LADO = Object.freeze({ RECEITA: "RECEITA", DESPESA: "DESPESA" });

/**
 * ⚠⚠ DETECTADA e DECLARADA NUNCA SE PARECEM NA TELA.
 *
 * A detectada mostra a EVIDÊNCIA (n, janela, mediana, faixa); a declarada mostra QUEM afirmou e
 * QUANDO. Uma afirmação não pode ter o peso visual de doze observações.
 */
export const ORIGEM_DA_SERIE = Object.freeze({ DETECTADA: "DETECTADA", DECLARADA: "DECLARADA" });

/** ⚠ `PENDENTE` é o estado de quem espera a palavra do contador — inclusive o que o cliente declarou. */
export const ESTADO_DA_SERIE = Object.freeze({
  PENDENTE: "PENDENTE",
  ATIVA: "ATIVA",
  RECUSADA: "RECUSADA",
  SUSPENSA: "SUSPENSA",
});

/** ⚠ Só a série ATIVA entra no fluxo de caixa. As outras três existem para NÃO entrar, cada uma por um motivo. */
export const ESTADOS_NO_FLUXO = Object.freeze([ESTADO_DA_SERIE.ATIVA]);

/** Por que um conjunto de despesas não vira série. ⚠ Vocabulário FECHADO — vai para a tela. */
export const FORA_DO_ALCANCE = Object.freeze({
  /**
   * ⚠⚠ A CHAVE DA DESCRIÇÃO CARREGA A DATA, e por isso a memória nunca forma.
   *
   * `chaveDaDescricao` não remove datas nem números de documento (o comentário do próprio arquivo
   * já declara a limitação). O memo de agosto e o de setembro viram chaves diferentes, cada série
   * teria uma observação, e o piso de 3 nunca seria alcançado.
   */
  CHAVE_DE_DESCRICAO_CARREGA_DATA: "chave_de_descricao_carrega_data",
  /** ⚠ Sem `tomadorDoc`/`emitenteDoc` não há contraparte, e a chave da série é a contraparte. */
  SEM_CONTRAPARTE: "sem_contraparte",
});

export const FRASE_DO_FORA_DO_ALCANCE = Object.freeze({
  [FORA_DO_ALCANCE.CHAVE_DE_DESCRICAO_CARREGA_DATA]:
    "Despesas que só aparecem no extrato (tarifa, assinatura, aluguel de pessoa física) ainda não "
    + "formam série: a chave que as identificaria carrega a data do memo do banco, então cada mês "
    + "vira uma série diferente. Enquanto isso, declare a recorrência delas à mão.",
  [FORA_DO_ALCANCE.SEM_CONTRAPARTE]:
    "Estas notas não trazem o documento da contraparte, e é ele que identifica a série.",
});

/** Recusas deste serviço. */
export const RECUSA_DA_SERIE = Object.freeze({
  LADO_INVALIDO: "lado_invalido",
  PERIODICIDADE_INVALIDA: "periodicidade_invalida",
  ESTADO_INVALIDO: "estado_invalido",
  SEM_CHAVE: "sem_chave",
  SEM_ROTULO: "sem_rotulo",
  VALOR_INVALIDO: "valor_invalido",
  NAO_ENCONTRADA: "serie_nao_encontrada",
  INDISPONIVEL: "recorrencia_indisponivel",
});

export const FRASE_DA_RECUSA_DA_SERIE = Object.freeze({
  [RECUSA_DA_SERIE.LADO_INVALIDO]: "O lado da série precisa ser RECEITA ou DESPESA.",
  [RECUSA_DA_SERIE.PERIODICIDADE_INVALIDA]: "A periodicidade precisa ser MENSAL, TRIMESTRAL ou ANUAL.",
  [RECUSA_DA_SERIE.ESTADO_INVALIDO]: "Este estado não existe para uma série recorrente.",
  [RECUSA_DA_SERIE.SEM_CHAVE]: "Falta a chave que identifica a série.",
  [RECUSA_DA_SERIE.SEM_ROTULO]: "Falta o nome pelo qual esta recorrência aparece na tela.",
  [RECUSA_DA_SERIE.VALOR_INVALIDO]: "O valor declarado precisa ser um número maior que zero.",
  [RECUSA_DA_SERIE.NAO_ENCONTRADA]: "Esta série não existe nesta empresa.",
  [RECUSA_DA_SERIE.INDISPONIVEL]:
    "A tabela de recorrências ainda não existe neste banco. A migration não foi aplicada.",
});

export class SerieRecusada extends Error {
  constructor(codigo, frase) {
    super(codigo);
    this.name = "SerieRecusada";
    this.codigo = codigo;
    this.frase = frase || FRASE_DA_RECUSA_DA_SERIE[codigo] || "";
  }
}

const recusar = (codigo, frase) => { throw new SerieRecusada(codigo, frase); };

const texto = (v) => String(v ?? "").trim();

/** ⚠ A tabela pode não existir — a migration `20260826120000` é ato do dono. */
const tabelaAusente = (e) => e?.code === "P2021";

/**
 * ⚠⚠ NOTA CANCELADA NÃO É OBSERVAÇÃO — e o critério é o de `derivarCiclo`, com as DUAS colunas.
 *
 * `statusEfetivo` é `String?` e o vocabulário de `status` tem literalmente `CANCELADA`: olhar só a
 * primeira deixa passar a nota cancelada cujo `statusEfetivo` é nulo. Foi o defeito que o
 * diagnóstico desta mesma fase teve, achado por agente de verificação em 27/08/2026.
 */
const foiCancelada = (nota) =>
  texto(nota?.statusEfetivo).toLowerCase() === "cancelada"
  || texto(nota?.status).toUpperCase() === "CANCELADA";

/**
 * `DateTime` do Prisma → competência `"AAAA-MM"`.
 *
 * ⚠ Acessadores **UTC**, e não é escolha: é o MESMO caminho de `ingestaoNfse.js`, que é quem escreve
 * esta coluna. Ler com acessadores locais devolveria o mês anterior a partir das 21h de Brasília.
 */
function competenciaDaNota(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A competência do mês corrente. ⚠ É o "agora" INJETADO no detector — ele não lê relógio nenhum. */
export function cicloDeHoje(agora = new Date()) {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * ⚠⚠ AS OBSERVAÇÕES, LADO A LADO — e as duas pontas saem da MESMA tabela.
 *
 * | lado | população | chave |
 * |---|---|---|
 * | RECEITA | `PortalInvoice` `papel: EMIT`, `statusEfetivo: autorizada` | `tomadorDoc` |
 * | DESPESA | `PortalInvoice` `papel: DEST`, não cancelada | `emitenteDoc` |
 *
 * ⚠ A receita usa `whereFaturamentoEmit()` — a definição de faturamento da casa, por INCLUSÃO.
 * Escrevê-la aqui de novo seria a sexta cópia, e a receita que o fluxo projeta tem de sair da mesma
 * população que a apuração usa.
 *
 * ⚠ A despesa não tem equivalente (nota RECEBIDA não passa pelo nosso ciclo de autorização), então
 * ali o critério é por EXCLUSÃO da cancelada. A assimetria é real e está dita.
 */
async function observacoesPorContraparte({ portalClientId, client }) {
  const escopo = { clientId: String(portalClientId) };
  const campos = {
    clientId: true, competencia: true, total: true, statusEfetivo: true, status: true,
    tomadorDoc: true, tomadorNome: true, emitenteDoc: true, emitenteNome: true,
  };

  const [emitidas, recebidas] = await Promise.all([
    client.portalInvoice.findMany({
      where: { ...escopo, ...whereFaturamentoEmit(), competencia: { not: null }, total: { not: null } },
      select: campos,
    }),
    client.portalInvoice.findMany({
      where: { ...escopo, papel: "DEST", competencia: { not: null }, total: { not: null } },
      select: campos,
    }),
  ]);

  const series = new Map();
  let semContraparte = 0;

  const juntar = (lado, notas, campoDoc, campoNome) => {
    for (const n of notas) {
      if (foiCancelada(n)) continue;
      const doc = texto(n[campoDoc]);
      if (!doc) { semContraparte += 1; continue; }
      const competencia = competenciaDaNota(n.competencia);
      if (!competencia) continue;

      const chave = `${lado}|${doc}`;
      if (!series.has(chave)) {
        series.set(chave, { lado, contraparteDoc: doc, chave: doc, rotulo: texto(n[campoNome]) || doc, observacoes: [] });
      }
      const s = series.get(chave);
      // ⚠ O rótulo é o nome da contraparte. A primeira nota que o traz vence — trocá-lo a cada nota
      // faria a mesma série mudar de nome na tela conforme a ordem da consulta.
      if (!s.rotulo || s.rotulo === doc) s.rotulo = texto(n[campoNome]) || doc;
      // ⚠ `total` é `Decimal`: ele viaja como está, e quem decide se é número é o `numero()` do
      // detector — que aceita `Decimal` pelo `toString` e recusa o resto por TIPO.
      s.observacoes.push({ competencia, valor: n.total });
    }
  };

  juntar(LADO.RECEITA, emitidas, "tomadorDoc", "tomadorNome");
  juntar(LADO.DESPESA, recebidas, "emitenteDoc", "emitenteNome");

  return { series: [...series.values()], semContraparte };
}

/**
 * ⚠⚠ QUANTAS DESPESAS SÓ DO EXTRATO EXISTEM — o que este serviço ainda NÃO alcança.
 *
 * Contadas, nunca lidas: a chave delas carregaria a data do memo, e cada mês viraria uma série
 * diferente. Contar e NOMEAR é a diferença entre uma limitação declarada e uma ausência silenciosa.
 *
 * ⚠ A tabela pode não existir (migration `20260824120000` não aplicada) — e isso não pode derrubar
 * a leitura das séries que a nota alimenta.
 */
async function quantasDespesasSoDoExtrato({ portalClientId, client }) {
  try {
    return await client.lancamentoDeclarado.count({
      where: { portalClientId: String(portalClientId), origem: "OFX_CLIENTE" },
    });
  } catch {
    return null;
  }
}

/** As séries já marcadas, indexadas por `lado|chave`. ⚠ Sem a tabela, devolve marcador de ausência. */
async function marcadasPorChave({ portalClientId, client }) {
  try {
    const linhas = await client.serieRecorrente.findMany({
      where: { portalClientId: String(portalClientId) },
    });
    const mapa = new Map();
    for (const l of linhas) mapa.set(`${l.lado}|${l.chave}`, l);
    return { mapa, indisponivel: false };
  } catch (e) {
    if (tabelaAusente(e)) return { mapa: new Map(), indisponivel: true };
    throw e;
  }
}

/**
 * ⚠⚠ A LEITURA COMPLETA — observação + marcação, SEM ESCREVER NADA.
 *
 * @param {string} args.cicloAtual competência "AAAA-MM" do "agora" — ⚠ INJETADA. O detector não lê
 *   relógio, e é isso que torna `baseDaObservacao` reproduzível.
 */
export async function listarSeries({ portalClientId, cicloAtual, client = prisma }) {
  const ciclo = texto(cicloAtual) || cicloDeHoje();

  const [{ series: observadas, semContraparte }, { mapa, indisponivel }, soDoExtrato] = await Promise.all([
    observacoesPorContraparte({ portalClientId, client }),
    marcadasPorChave({ portalClientId, client }),
    quantasDespesasSoDoExtrato({ portalClientId, client }),
  ]);

  const vistas = new Set();
  const linhas = [];

  for (const s of observadas) {
    const marcada = mapa.get(`${s.lado}|${s.chave}`) || null;
    vistas.add(`${s.lado}|${s.chave}`);
    // ⚠ A periodicidade da série MARCADA manda; a de uma candidata é MENSAL — ver o cabeçalho.
    const periodicidade = marcada?.periodicidade || PERIODICIDADE.MENSAL;
    const jaMarcada = marcada?.estado === ESTADO_DA_SERIE.ATIVA;
    const leitura = lerSerie({ observacoes: s.observacoes, periodicidade, cicloAtual: ciclo, jaMarcada });
    linhas.push(montarLinha({ s, marcada, leitura, periodicidade }));
  }

  // ⚠⚠ A SÉRIE MARCADA QUE NÃO TEM MAIS OBSERVAÇÃO NENHUMA **NÃO SOME**. Ela está no fluxo de caixa;
  // desaparecer da tela deixaria uma linha projetando dinheiro sem ninguém conseguir achá-la.
  for (const [chave, marcada] of mapa) {
    if (vistas.has(chave)) continue;
    const periodicidade = marcada.periodicidade || PERIODICIDADE.MENSAL;
    const leitura = lerSerie({
      observacoes: [],
      periodicidade,
      cicloAtual: ciclo,
      jaMarcada: marcada.estado === ESTADO_DA_SERIE.ATIVA,
    });
    linhas.push(montarLinha({
      s: { lado: marcada.lado, chave: marcada.chave, contraparteDoc: marcada.contraparteDoc, rotulo: marcada.rotulo },
      marcada,
      leitura,
      periodicidade,
    }));
  }

  const foraDoAlcance = [];
  if (soDoExtrato) {
    foraDoAlcance.push({
      motivo: FORA_DO_ALCANCE.CHAVE_DE_DESCRICAO_CARREGA_DATA,
      frase: FRASE_DO_FORA_DO_ALCANCE[FORA_DO_ALCANCE.CHAVE_DE_DESCRICAO_CARREGA_DATA],
      quantos: soDoExtrato,
    });
  }
  if (semContraparte) {
    foraDoAlcance.push({
      motivo: FORA_DO_ALCANCE.SEM_CONTRAPARTE,
      frase: FRASE_DO_FORA_DO_ALCANCE[FORA_DO_ALCANCE.SEM_CONTRAPARTE],
      quantos: semContraparte,
    });
  }

  return { series: linhas, cicloAtual: ciclo, foraDoAlcance, indisponivel };
}

/**
 * A linha que vai à tela.
 *
 * ⚠⚠ A EVIDÊNCIA VIAJA SEMPRE, e a FAIXA nunca é omitida: *"≈ R$ 130, entre 120 e 140"*. Medido em
 * 27/08/2026, o CV mediano das despesas deste banco é **36,1%** — a mediana sozinha erraria por um
 * terço rotineiramente, e o fluxo diria um número que ninguém pode usar.
 */
function montarLinha({ s, marcada, leitura, periodicidade }) {
  return {
    id: marcada?.id || null,
    lado: s.lado,
    chave: s.chave,
    contraparteDoc: s.contraparteDoc ?? null,
    rotulo: marcada?.rotulo || s.rotulo || s.chave,
    periodicidade,
    // ⚠ Sem marcação, a série é uma CANDIDATA: `estado` e `origem` nulos, nunca "PENDENTE" — que é
    // um estado gravado, de quem espera resposta. Candidata ninguém ainda olhou.
    estado: marcada?.estado || null,
    origem: marcada?.origem || null,
    valorDeclarado: marcada?.valorDeclarado != null ? String(marcada.valorDeclarado) : null,
    declaradoPor: marcada?.declaradoPor || null,
    declaradoEm: marcada?.declaradoEm || null,
    confirmadoPor: marcada?.confirmadoPor || null,
    confirmadoEm: marcada?.confirmadoEm || null,
    saidaSugeridaEm: marcada?.saidaSugeridaEm || null,
    leitura: leitura.leitura,
    valorProjetado: leitura.valorProjetado,
    base: leitura.base,
    // ⚠ A frase sai do DETECTOR, num lugar só — a tela não escreve a sua, senão as duas divergem.
    frase: fraseDaBase(leitura.base),
    // ⚠⚠ ENTRA NO FLUXO? É uma pergunta só, e ela é respondida AQUI: a linha só entra se o contador
    // marcou. Deixar a tela derivar isso de `estado` faria cada consumidor ter a sua regra.
    entraNoFluxo: ESTADOS_NO_FLUXO.includes(marcada?.estado),
  };
}

function conferirVocabulario({ lado, periodicidade, estado }) {
  if (lado != null && !Object.values(LADO).includes(lado)) recusar(RECUSA_DA_SERIE.LADO_INVALIDO);
  if (periodicidade != null && !Object.values(PERIODICIDADE).includes(periodicidade)) {
    recusar(RECUSA_DA_SERIE.PERIODICIDADE_INVALIDA);
  }
  if (estado != null && !Object.values(ESTADO_DA_SERIE).includes(estado)) {
    recusar(RECUSA_DA_SERIE.ESTADO_INVALIDO);
  }
}

/**
 * ⚠⚠ A MARCAÇÃO DO CONTADOR — e é ela, e só ela, que põe a linha no fluxo de caixa.
 *
 * Ela grava a EVIDÊNCIA do instante da decisão em `baseDaObservacao`. Sem isso, *"por que esta linha
 * está no fluxo?"* não tem resposta em seis meses — e a observação muda com o tempo, então guardar
 * só um ponteiro para "a leitura de agora" não responderia a pergunta.
 *
 * ⚠ `upsert` pela chave natural `(portalClientId, lado, chave)`: a série observada ainda não tem
 * linha, e a marcada tem. Duas rotas para o mesmo ato dariam duas regras.
 */
export async function marcarSerie({
  portalClientId,
  lado,
  chave,
  rotulo,
  periodicidade = PERIODICIDADE.MENSAL,
  estado,
  contraparteDoc = null,
  baseDaObservacao = null,
  usuarioId,
  agora = new Date(),
  client = prisma,
}) {
  conferirVocabulario({ lado, periodicidade, estado });
  const k = texto(chave);
  if (!k) recusar(RECUSA_DA_SERIE.SEM_CHAVE);
  const nome = texto(rotulo) || k;

  // ⚠ `confirmadoPor`/`confirmadoEm` marcam QUEM decidiu e QUANDO — inclusive na recusa. Recusar é
  // uma decisão tanto quanto confirmar, e daqui a seis meses "quem disse que isto não é recorrente?"
  // é a mesma pergunta.
  const dados = {
    rotulo: nome,
    periodicidade,
    estado,
    contraparteDoc: texto(contraparteDoc) || null,
    confirmadoPor: texto(usuarioId) || null,
    confirmadoEm: agora,
    // ⚠⚠ A EVIDÊNCIA DO INSTANTE DA DECISÃO. Ela é gravada porque a observação muda; sem congelá-la,
    // a resposta a "por que esta linha está no fluxo?" mudaria junto com o dado.
    ...(baseDaObservacao ? { baseDaObservacao } : {}),
  };

  try {
    return await client.serieRecorrente.upsert({
      where: { portalClientId_lado_chave: { portalClientId: String(portalClientId), lado, chave: k } },
      update: dados,
      create: {
        portalClientId: String(portalClientId),
        lado,
        chave: k,
        // ⚠ A série que nasce de uma marcação do contador é DETECTADA: ele está respondendo a uma
        // observação. A DECLARADA nasce por outro caminho, e as duas não se parecem na tela.
        origem: ORIGEM_DA_SERIE.DETECTADA,
        ...dados,
      },
    });
  } catch (e) {
    if (tabelaAusente(e)) recusar(RECUSA_DA_SERIE.INDISPONIVEL);
    throw e;
  }
}


/**
 * ⚠⚠ A RECORRÊNCIA DECLARADA — e ela VOLTOU EM 29/08/2026, por outra porta.
 *
 * Escrita em `e9dd2be5` (Fase D), **removida em 28/08** junto com a tela "Declarar o que se repete",
 * e recuperada agora — não reescrita. Com a remoção, `ORIGEM_DA_SERIE.DECLARADA` ficou **sem
 * escritor**, e o vocabulário sobreviveu sozinho no código.
 *
 * ⚠ O que mudou é DE ONDE ela é chamada: não há mais tela própria. Quem declara é o cliente, dentro
 * do próprio fluxo de caixa (*"o cliente pode modificar as saídas, podendo colocar novas saídas"*),
 * e a declaração aparece para o contador na Conferência.
 *
 * Ela nasce **`PENDENTE`**: uma afirmação não entra no fluxo sozinha, do mesmo jeito que uma
 * observação não entra.
 *
 * ⚠⚠ E ELA NÃO SOBRESCREVE UMA SÉRIE JÁ CONFIRMADA. Quem já foi decidido pelo contador continua
 * como está; a declaração volta marcada e a tela mostra a divergência. *"O observado vence"* é
 * decisão do dono — e uma declaração que rebaixasse uma série ATIVA para PENDENTE apagaria a
 * decisão dele.
 *
 * ⚠ A extração de TEXTO LIVRE (*"1.000 que eu pago de jantar todo mês"*) **não existe**: não há
 * nenhuma integração de LLM neste repositório. Esta porta recebe os campos já estruturados, e quem
 * os estrutura é a pessoa preenchendo a tela.
 */
export async function declararSerie({
  portalClientId,
  lado,
  chave,
  rotulo,
  periodicidade,
  valorDeclarado,
  contraparteDoc = null,
  usuarioId,
  agora = new Date(),
  client = prisma,
}) {
  conferirVocabulario({ lado, periodicidade });
  const nome = texto(rotulo);
  if (!nome) recusar(RECUSA_DA_SERIE.SEM_ROTULO);
  /**
   * ⚠⚠ A CHAVE DE UMA DECLARAÇÃO É A DESCRIÇÃO **CANONIZADA** — e é `chaveDaDescricao`, a que já
   * existe, nunca uma terceira canonização.
   *
   * Sem canonizar, "Anuidade do Conselho" e "anuidade do conselho " viram duas séries, e a segunda
   * declaração não encontraria a primeira.
   *
   * ⚠ É a MESMA função cuja limitação está declarada no cabeçalho deste arquivo (ela não remove
   * datas) — e aqui isso não morde: quem digita um RÓTULO não escreve a data dentro dele. O que a
   * limitação impede é a chave saída de um MEMO BANCÁRIO, que é outro caminho.
   */
  const k = chaveDaDescricao(texto(chave) || nome);
  if (!k) recusar(RECUSA_DA_SERIE.SEM_CHAVE);

  // ⚠⚠ O VALOR É O QUE A PESSOA AFIRMA, e sem ele a declaração não diz nada de útil ao fluxo.
  // ⚠ `Number(null)` é 0 e 0 é finito — a guarda é `> 0`, nunca `Number.isFinite` sozinha.
  const valor = Number(valorDeclarado);
  if (!Number.isFinite(valor) || valor <= 0) recusar(RECUSA_DA_SERIE.VALOR_INVALIDO);

  try {
    const existente = await client.serieRecorrente.findUnique({
      where: { portalClientId_lado_chave: { portalClientId: String(portalClientId), lado, chave: k } },
    });
    // ⚠ Já decidida pelo contador ⇒ a declaração NÃO a toca. Ela volta marcada, e a tela mostra a
    // divergência em vez de apagar a decisão.
    if (existente && existente.estado !== ESTADO_DA_SERIE.PENDENTE) {
      return { serie: existente, jaDecidida: true };
    }

    const dados = {
      rotulo: nome,
      periodicidade,
      valorDeclarado: valor,
      origem: ORIGEM_DA_SERIE.DECLARADA,
      estado: ESTADO_DA_SERIE.PENDENTE,
      contraparteDoc: texto(contraparteDoc) || null,
      declaradoPor: texto(usuarioId) || null,
      declaradoEm: agora,
    };

    const serie = await client.serieRecorrente.upsert({
      where: { portalClientId_lado_chave: { portalClientId: String(portalClientId), lado, chave: k } },
      update: dados,
      create: { portalClientId: String(portalClientId), lado, chave: k, ...dados },
    });
    return { serie, jaDecidida: false };
  } catch (e) {
    if (e instanceof SerieRecusada) throw e;
    if (tabelaAusente(e)) recusar(RECUSA_DA_SERIE.INDISPONIVEL);
    throw e;
  }
}

/**
 * ⚠⚠ A SAÍDA SE **REGISTRA**, NUNCA SE APLICA.
 *
 * O detector diz que a série sumiu por 2 ciclos; isto grava que ele disse, e QUANDO. A série
 * continua `ATIVA` — desmarcar sozinho seria o sistema revogando a decisão do contador, pela mesma
 * razão que a entrada não se marca sozinha.
 */
export async function registrarSaidaSugerida({ portalClientId, serieId, agora = new Date(), client = prisma }) {
  try {
    const r = await client.serieRecorrente.updateMany({
      where: { id: String(serieId), portalClientId: String(portalClientId), saidaSugeridaEm: null },
      data: { saidaSugeridaEm: agora },
    });
    return { marcadas: r.count };
  } catch (e) {
    if (tabelaAusente(e)) recusar(RECUSA_DA_SERIE.INDISPONIVEL);
    throw e;
  }
}

/**
 * A série gravada, pronta para a tela.
 *
 * ⚠ Ela mora AQUI, e não na rota do escritório: as DUAS portas a devolvem (o contador marca, o
 * cliente declara), e pôr o serializador numa delas faria a outra importar um router inteiro só por
 * causa de uma função — acoplando os dois lados por acidente.
 *
 * ⚠ `Decimal` não viaja cru: a tela precisa de texto.
 */
export function paraTela(s) {
  if (!s) return null;
  return {
    id: s.id,
    lado: s.lado,
    chave: s.chave,
    contraparteDoc: s.contraparteDoc ?? null,
    rotulo: s.rotulo,
    periodicidade: s.periodicidade,
    origem: s.origem,
    estado: s.estado,
    valorDeclarado: s.valorDeclarado != null ? String(s.valorDeclarado) : null,
    baseDaObservacao: s.baseDaObservacao ?? null,
    declaradoPor: s.declaradoPor ?? null,
    declaradoEm: s.declaradoEm ?? null,
    confirmadoPor: s.confirmadoPor ?? null,
    confirmadoEm: s.confirmadoEm ?? null,
    saidaSugeridaEm: s.saidaSugeridaEm ?? null,
  };
}

/** ⚠ Exportado para a rota poder dizer o que o detector respondeu, sem reimplementar a leitura. */
export { LEITURA };
