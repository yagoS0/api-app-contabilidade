// A LISTA OFICIAL DO IBGE, DO LADO DO SERVIDOR — para que a prova do município não dependa do
// navegador.
//
// ─── POR QUE ESTE ARQUIVO PASSOU A EXISTIR (20/08/2026) ─────────────────────────────────────
//
// Até aqui a lista morava **só nos dois portais**, e o `apps/api` classificava a planilha com
// `municipios: null`. Isso tinha duas consequências, e as duas apareceram medindo a emissão em lote:
//
//   1. **Endereço vindo da PLANILHA nunca podia ser `PRONTA`.** `conferirMunicipioDaPlanilha` sem
//      lista devolve `municipio_nao_conferido`, que é uma CONFERÊNCIA — e conferência rebaixa a
//      linha para `conferir`. Ou seja: o cliente que preenchesse o endereço na planilha (o fluxo que
//      o dono descreveu) teria **zero** linhas emitíveis.
//   2. **A prova do município da CONSULTA era um booleano do navegador** (`cMunVerificado`). Na
//      emissão avulsa isso é uma nota por vez, com uma pessoa olhando. Num lote seriam 50 notas a
//      partir de uma afirmação que o servidor não conferia.
//
// Com a tabela unificada em `packages/shared` (Bloco A), o servidor alcança a lista e **refaz a
// prova por conta própria**. `cMunVerificado` deixou de ser prova — ver `classificarLinhaLote.js`.
//
// ⚠⚠ ISTO NÃO É UMA TERCEIRA CÓPIA. É o MESMO arquivo do pacote compartilhado, importado. A recusa
// de 19/08/2026 foi contra **duplicar** a tabela dentro do `apps/api`; aqui não se duplica nada.
//
// ⚠⚠ **O PACOTE PRECISA ESTAR NA IMAGEM DO DOCKER, E A FALTA DELE É SILENCIOSA NO CI.** Em
// desenvolvimento o import resolve pelo symlink de workspace, então `npm test` passa verde sem o
// pacote ser copiado. Dentro do container não há symlink: sem o `COPY packages/shared`, isto estoura
// `ERR_MODULE_NOT_FOUND` **em runtime** — no primeiro lote do contador, não no deploy. O `Dockerfile`
// e o `railway.toml` foram corrigidos junto, e há teste guardando os dois
// (`__tests__/listaIbgeChegaNaImagem.test.js`).

/**
 * A lista, carregada sob demanda e memorizada.
 *
 * ⚠ `import()` DINÂMICO e não estático no topo, de propósito: são ~197 KB de literais de array, e a
 * emissão em lote nasce DESLIGADA (`INTEGRACAO_NFSE_LOTE`). Com a flag OFF nenhuma rota chega aqui,
 * e o processo não paga o parse no arranque. É o mesmo desenho dos dois portais, pelo mesmo motivo
 * — lá o custo é o bundle inicial, aqui é o boot.
 *
 * ⚠ A promessa é ZERADA em caso de falha. Sem isso, uma falha de carga viraria "lista vazia"
 * permanente — e lista vazia, no classificador, é `municipio_nao_conferido` em toda linha: o lote
 * inteiro pararia de emitir sem ninguém entender por quê.
 */
let promessaDaLista = null;

export function carregarMunicipiosIbge() {
  if (!promessaDaLista) {
    promessaDaLista = import("@contabilidade/shared/municipios-ibge")
      .then((m) => {
        const lista = m.MUNICIPIOS_IBGE || m.default || [];
        if (!Array.isArray(lista) || lista.length === 0) {
          throw new Error("A lista oficial do IBGE foi carregada vazia.");
        }
        return lista;
      })
      .catch((err) => {
        promessaDaLista = null;
        throw err;
      });
  }
  return promessaDaLista;
}

/**
 * A lista, ou `null` se ela não puder ser carregada — para quem NÃO pode derrubar a resposta.
 *
 * ⚠ `null` **não** é "aceite sem conferir": no classificador ele produz `municipio_nao_conferido`,
 * que rebaixa a linha para `conferir` e a mantém FORA da emissão. Falhar aqui custa o lote parado,
 * nunca uma nota emitida sem prova — e é essa a direção certa do erro.
 */
export async function municipiosIbgeOuNulo({ log = null } = {}) {
  try {
    return await carregarMunicipiosIbge();
  } catch (err) {
    log?.error?.(
      { err: err?.message },
      "NFS-e lote: a lista oficial do IBGE não pôde ser carregada — as linhas ficarão sem a prova do município"
    );
    return null;
  }
}

/** Só para teste: esquece a lista memorizada. */
export function esquecerMunicipiosIbge() {
  promessaDaLista = null;
}

/**
 * `3548708` → `"São Bernardo do Campo / SP"`. `null` quando não dá para resolver.
 *
 * ⚠⚠ ISTO NÃO É UMA TERCEIRA CÓPIA DE `municipioPorCodigo` — é a PRIMEIRA no `apps/api`. Ela existe
 * nos dois portais (`web` e `portal-cliente-web`, uma em cada, e é o par que a tabela "mudou lá,
 * muda aqui" já registra); o servidor nunca precisou dela porque só carregava a lista para PROVAR
 * um código, nunca para DESCREVÊ-LO. O DANFSe precisa descrever.
 *
 * ⚠ MORA AQUI, e não numa pasta nova, porque este é o único módulo do `apps/api` que conhece a
 * lista. O caminho diz `lote/` por história (foi a emissão em lote que o trouxe), e o conteúdo
 * sempre foi genérico — um segundo módulo de IBGE no servidor seria exatamente a duplicação que o
 * cabeçalho acima recusa.
 *
 * ⚠ O SEPARADOR É " / ", COM BARRA, e não é escolha estética: a NT §2.4.5 escreve
 * *"Concatenar o nome do município com a respectiva UF. Ex.: Município / UF"*, e o `apps/api/CLAUDE.md`
 * já registra que **onde o DANFSe oficial imprime `<nome> - <UF>` nós seguimos a NT**. Mesmo formato
 * do `rotuloMunicipio` dos dois portais.
 *
 * ⚠ SETE DÍGITOS EXATOS, sem `padStart`. Código com outro comprimento devolve `null` — completar
 * com zero fabricaria um município plausível a partir de um dígito perdido, que é a classe do
 * `cLocEmi="0000000"`.
 *
 * @param {Array<[string,string,string]>|null} lista  as tuplas `[codigo, nome, uf]`
 * @param {string|number|null} codigo
 * @returns {string|null}
 */
export function rotuloMunicipioIbge(lista, codigo) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const digitos = String(codigo ?? "").replace(/\D+/g, "");
  if (digitos.length !== 7) return null;
  const achado = lista.find((m) => String(m?.[0] ?? "") === digitos);
  if (!achado) return null;
  const nome = String(achado[1] ?? "").trim();
  const uf = String(achado[2] ?? "").trim();
  // ⚠ Nome sem UF não vira meia resposta: a NT pede a concatenação, e "São Paulo" sozinho é
  // ambíguo entre município e estado. Faltando um dos dois, o código cru continua sendo a verdade.
  return nome && uf ? `${nome} / ${uf}` : null;
}
