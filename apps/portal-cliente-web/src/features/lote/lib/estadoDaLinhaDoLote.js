// O ESTADO DE CADA LINHA NA TELA — e a SEGUNDA METADE da prova do município.
//
// ⚠⚠ **A CLASSIFICAÇÃO É DO BACKEND. ESTA TELA MOSTRA.** A lista de estados é FECHADA e vem de
// `apps/api/src/application/nfse/lote/classificarLinhaLote.js`; nenhum estado novo é inventado
// aqui, e nenhuma regra de negócio é reescrita.
//
// ⚠⚠ **O QUE ESTE MÓDULO FAZ A MAIS É O QUE O BACKEND PEDIU QUE FIZÉSSEMOS.** O classificador
// marca `municipio_nao_conferido` e diz, por escrito, o motivo: *"a conferência acontece na tela de
// ajuste, que tem a lista"*. A lista oficial do IBGE **não existe no `apps/api`** — ela mora nos
// dois fronts (5.571 linhas), e uma terceira cópia foi recusada em 19/08/2026. Então a prova não se
// perde: **ela muda de camada**, e a camada é esta.
//
// ⚠⚠ **A TELA SÓ REBAIXA, NUNCA PROMOVE.** Um código que não existe na lista do IBGE derruba a
// linha para `PENDENTE`, com o código de pendência **do próprio backend** (`municipio_inexistente`)
// — é o veredito que ele teria dado se tivesse a lista. Nada aqui transforma `conferir`,
// `consultar` ou `pendente` em `pronta`: numa planilha de 200 linhas, o erro que se paga caro é a
// linha ruim passando por boa.
//
// ⚠ **ESTADO QUE ESTA TELA NÃO CONHECE NÃO VIRA PRONTA.** Ele aparece nomeado, contado fora das
// prontas, e a linha diz que não pode ser emitida. É a mesma disciplina do `PENDENTE` do
// classificador: o padrão é NÃO estar pronta.

import { municipioPorCodigo, rotuloMunicipio } from "../../../lib/municipios/municipioIbge";

/** ESPELHO da lista fechada de `classificarLinhaLote.js`. Amarrado por teste. */
export const ESTADO = Object.freeze({
  PRONTA: "pronta",
  CONFERIR: "conferir",
  CONSULTAR: "consultar",
  PENDENTE: "pendente",
});

/**
 * ⚠⚠ DE ONDE VEIO O NOME DO TOMADOR — ESPELHO de `ORIGEM_DO_DADO` (`classificarLinhaLote.js`).
 *
 * O nome deixou de ser coluna da planilha em 20/08/2026 (dono: *"não precisamos de nada do tomador,
 * apenas o CNPJ ou CPF"*) e passou a ter três origens. A tela DIZ qual foi, pelo mesmo motivo que o
 * `RotuloOrigem` da emissão avulsa existe: **valor preenchido sem procedência é indistinguível de
 * valor conferido por uma pessoa** — e quem confere um lote de 50 notas precisa saber quais nomes
 * ele mesmo escreveu.
 */
export const ORIGEM_DO_DADO = Object.freeze({
  REVISAO: "revisao",
  MEMORIA: "memoria",
  CONSULTA: "consulta",
});

const ROTULO_DA_ORIGEM = Object.freeze({
  // ⚠ A REVISÃO NÃO GANHA RÓTULO: a linha já diz "ajustada aqui", e repetir a mesma informação em
  // duas frases na mesma célula é o ruído que o corte de legendas de 19/08/2026 mandou tirar.
  [ORIGEM_DO_DADO.REVISAO]: null,
  [ORIGEM_DO_DADO.MEMORIA]: "nome de uma nota já emitida",
  [ORIGEM_DO_DADO.CONSULTA]: "razão social vinda da Receita",
});

/**
 * O rótulo da procedência do nome, ou `null` quando não há o que dizer.
 *
 * ⚠ Origem que esta tela não conhece **não vira silêncio**: sai como veio. Um valor novo no backend
 * some da tela se o padrão for `null`, e some justamente a informação que ele foi criado para dar.
 */
export function rotuloDaOrigemDoNome(linha) {
  const origem = String(linha?.origemNome || "");
  if (!origem) return null;
  if (Object.prototype.hasOwnProperty.call(ROTULO_DA_ORIGEM, origem)) return ROTULO_DA_ORIGEM[origem];
  return `nome de origem “${origem}”`;
}

/** Os códigos do backend que ESTA tela precisa nomear. Ela não inventa nenhum. */
export const CODIGO = Object.freeze({
  MUNICIPIO_NAO_CONFERIDO: "municipio_nao_conferido",
  MUNICIPIO_INEXISTENTE: "municipio_inexistente",
});

const APRESENTACAO = Object.freeze({
  [ESTADO.PRONTA]: { rotulo: "Pronta", chip: "emitida", ordem: 4 },
  [ESTADO.CONFERIR]: { rotulo: "Conferir", chip: "rascunho", ordem: 3 },
  [ESTADO.CONSULTAR]: { rotulo: "Consultando", chip: "processando", ordem: 2 },
  [ESTADO.PENDENTE]: { rotulo: "Pendente", chip: "rejeitada", ordem: 1 },
});

export function ehEstadoConhecido(estado) {
  return Object.prototype.hasOwnProperty.call(APRESENTACAO, String(estado || ""));
}

/**
 * Como o estado aparece. ⚠ Estado desconhecido NÃO ganha desenho de "ok": ele sai com o próprio
 * nome, em vermelho, e no fim da fila — quem lê precisa ver que há algo que a tela não entendeu.
 */
export function apresentacaoDoEstado(estado) {
  return (
    APRESENTACAO[String(estado || "")] || {
      rotulo: String(estado || "sem estado"),
      chip: "rejeitada",
      ordem: 0,
    }
  );
}

/**
 * O código IBGE desta linha, como o backend o entendeu.
 *
 * ⚠ Sai de `dados.tomador.endereco.cMun` porque é o valor que o classificador ACEITOU (o bloco de
 * endereço só é montado quando os cinco campos existem). Ler a célula crua traria o que a pessoa
 * digitou, que pode ser outra coisa — e a conferência tem de ser sobre o que vai para a nota.
 */
function codigoDoMunicipio(linha) {
  return String(linha?.dados?.tomador?.endereco?.cMun || "").replace(/\D+/g, "");
}

function temCodigo(lista, codigo) {
  return (lista || []).some((c) => c?.codigo === codigo);
}

/**
 * A conferência do município desta linha — a metade que o backend não pôde fazer.
 *
 * @returns `{ situacao: "nao_pedida" }`               a linha não carrega `municipio_nao_conferido`
 *        | `{ situacao: "sem_lista" }`                a lista oficial ainda não carregou
 *        | `{ situacao: "sem_codigo" }`               a linha não tem `cMun` aceito (já é pendente)
 *        | `{ situacao: "conferido", rotulo }`        o código existe: a tela mostra de quem ele é
 *        | `{ situacao: "inexistente", codigo }`      o código não existe na lista oficial
 */
export function conferirMunicipioDaLinha(linha, municipios) {
  if (!temCodigo(linha?.conferencias, CODIGO.MUNICIPIO_NAO_CONFERIDO)) {
    return { situacao: "nao_pedida" };
  }
  if (!Array.isArray(municipios) || municipios.length === 0) return { situacao: "sem_lista" };
  const codigo = codigoDoMunicipio(linha);
  // ⚠⚠ SEM CÓDIGO NÃO HÁ O QUE CONFERIR — e isto não é detalhe. A linha que já é PENDENTE por outro
  // motivo (valor ambíguo, competência em branco) volta com `dados: null`, e o `cMun` que ela
  // carregava some junto. Sem esta guarda, a conferência lia "" e acusava
  // `municipio_inexistente` — inventando um segundo defeito, com o código VAZIO no texto, numa
  // linha cujo problema é outro. Medido em 19/08/2026, em três linhas do mock.
  if (!codigo) return { situacao: "sem_codigo" };
  const achado = municipioPorCodigo(municipios, codigo);
  if (!achado) return { situacao: "inexistente", codigo };
  return { situacao: "conferido", rotulo: rotuloMunicipio(achado), codigo };
}

/**
 * A linha do backend, com a conferência do município aplicada.
 *
 * ⚠ **A FRASE QUE DESCREVE UM COMPORTAMENTO É PARTE DO COMPORTAMENTO.** O texto que o backend
 * escreveu diz *"não foi conferido contra a lista oficial aqui — a conferência acontece na tela de
 * ajuste"*. Depois que ESTA tela confere, aquela frase fica **falsa**: ela é substituída pelo
 * resultado da conferência, que é o que a pessoa precisa olhar (o município, com a UF).
 */
export function vereditoDaLinha(linha, { municipios = null } = {}) {
  const conferencia = conferirMunicipioDaLinha(linha, municipios);
  const base = { ...linha, municipio: null, conhecido: ehEstadoConhecido(linha?.estado) };

  if (conferencia.situacao === "conferido") {
    return {
      ...base,
      municipio: conferencia.rotulo,
      conferencias: (linha.conferencias || []).map((c) =>
        c.codigo === CODIGO.MUNICIPIO_NAO_CONFERIDO
          ? { ...c, texto: `Confira o município do tomador: ${conferencia.rotulo}.` }
          : c
      ),
    };
  }

  if (conferencia.situacao === "inexistente") {
    // ⚠ O código é do BACKEND (`PENDENCIA.MUNICIPIO_INEXISTENTE`) — é o veredito que ele daria se
    // tivesse a lista. A tela não cria vocabulário novo; ela completa a prova.
    return {
      ...base,
      estado: ESTADO.PENDENTE,
      conferencias: (linha.conferencias || []).filter((c) => c.codigo !== CODIGO.MUNICIPIO_NAO_CONFERIDO),
      pendencias: [
        ...(linha.pendencias || []),
        {
          codigo: CODIGO.MUNICIPIO_INEXISTENTE,
          texto:
            `O código ${conferencia.codigo} não existe na lista oficial do IBGE. Corrija o código `
            + "do município nesta linha — a nota sairia no município errado.",
        },
      ],
      // ⚠ `dados` some junto: linha pendente não tem payload de emissão. Deixá-lo preenchido numa
      // linha que a tela chama de pendente seria uma armadilha para a fase que vai emitir.
      dados: null,
    };
  }

  return base;
}

/**
 * A leitura inteira, com os vereditos e o resumo RECONTADO.
 *
 * ⚠ O `resumo` do backend não serve sozinho: ele não sabe da conferência do município, e uma linha
 * que ele contou em `conferir` pode ter virado `pendente` aqui. Mostrar o número dele ao lado das
 * linhas rebaixadas faria a tela discordar de si mesma no número que decide se dá para seguir.
 */
export function vereditosDoLote(resposta, { municipios = null } = {}) {
  const linhas = (resposta?.linhas || []).map((l) => vereditoDaLinha(l, { municipios }));
  const contar = (estado) => linhas.filter((l) => l.estado === estado).length;
  return {
    linhas,
    resumo: {
      total: linhas.length,
      prontas: contar(ESTADO.PRONTA),
      conferir: contar(ESTADO.CONFERIR),
      consultar: contar(ESTADO.CONSULTAR),
      pendentes: contar(ESTADO.PENDENTE),
      /** ⚠ Contado à parte, e NUNCA somado às prontas. */
      desconhecidas: linhas.filter((l) => !l.conhecido).length,
    },
  };
}

/**
 * Quantas linhas ainda NÃO estão prontas — o número que decide se dá para seguir.
 *
 * ⚠ É `total - prontas`, e não a soma dos outros três: se um estado novo aparecer no backend e esta
 * tela não o conhecer, ele entra aqui por construção, em vez de sumir da conta.
 */
export function quantasNaoProntas(resumo) {
  return Math.max(0, Number(resumo?.total || 0) - Number(resumo?.prontas || 0));
}
