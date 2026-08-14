// DESCRIÇÕES DOS CÓDIGOS DO DANFSe — DELIBERADAMENTE VAZIO.
//
// Em doze campos a NT 008 manda "utilizar a descrição das opções previstas no leiaute"
// (`tpEmit`, `cStat`, `finNFSe`, `opSimpNac`, `regApTribSN`, `tribISSQN`, `tpRetISSQN`,
// `regEspTrib`, `tpImunidade`, `tpSusp`, `tpBM`, `tpRetPisCofins`).
//
// ⚠ O LEIAUTE NÃO ESTÁ NO REPOSITÓRIO. Não há um único `.xsd` na árvore — a mesma ausência já
// registrada em `dpsCodigos.js`, que por isso RECUSA em vez de chutar. A NT dá apenas *exemplos*
// de descrição ("Ex.: Prestador", "Ex.: Não Optante", "Ex.: Operação Tributável") e **não diz a
// qual número cada exemplo corresponde**. Ela chega a listar as duas descrições de `tpSusp`
// ("Exigibilidade Suspensa por Decisão Judicial" e "por Processo Administrativo") sem dizer qual é
// 1 e qual é 2.
//
// Montar o mapa por analogia com a NF-e, ou lendo blog de fornecedor, seria inventar tabela de
// código fiscal impressa num documento fiscal — regra 1 do projeto, e o oposto do art. 13.
//
// ─── O QUE O GERADOR FAZ ENQUANTO ISSO ───────────────────────────────────────────────────────
//
// Imprime **o código cru, exatamente como está no XML**. Isso é conteúdo do arquivo, portanto
// conforme o art. 13 ("não poderá conter informações que não existam no arquivo XML") — o que não
// se cumpre é a regra de APRESENTAÇÃO da NT, e essa não conformidade sai nomeada em
// `conformidade.descricoesPendentes`, campo a campo, nunca silenciada.
//
// ─── COMO SE FECHA ESTE BURACO ───────────────────────────────────────────────────────────────
//
// Versionando o Anexo I do leiaute da NFS-e (tabelas de domínio) em `docs/leiaute-nfse/` e
// preenchendo as tabelas abaixo com a citação da página. Uma entrada por código, nunca um bloco
// inteiro de uma vez.

/**
 * Mapa `tag do XML` → (`código` → `descrição oficial`).
 *
 * ⚠ Cada entrada acrescentada aqui PRECISA vir com a fonte no comentário, no padrão de
 * `dpsCodigos.js`. Entrada sem fonte é o defeito que este arquivo existe para impedir.
 */
export const DESCRICOES = Object.freeze({
  tpEmit: Object.freeze({}),
  cStat: Object.freeze({}),
  finNFSe: Object.freeze({}),
  opSimpNac: Object.freeze({}),
  regApTribSN: Object.freeze({}),
  tribISSQN: Object.freeze({}),
  tpRetISSQN: Object.freeze({}),
  regEspTrib: Object.freeze({}),
  tpImunidade: Object.freeze({}),
  tpSusp: Object.freeze({}),
  tpBM: Object.freeze({}),
  tpRetPisCofins: Object.freeze({}),
});

/**
 * Resolve a descrição de um código.
 *
 * @returns {{resolvido: boolean, texto: string|null, motivo?: string}}
 *   `resolvido: false` NÃO é erro — é a resposta honesta enquanto o leiaute não estiver no repo.
 *   `texto` devolve o código cru para que o campo não fique vazio (nota 12 pede traço só para
 *   campo SEM informação; aqui a informação existe, o que falta é a tradução dela).
 */
export function descreverCodigo(tag, codigo) {
  const valor = codigo == null ? "" : String(codigo).trim();
  if (!valor) return { resolvido: false, texto: null, motivo: "campo ausente no XML" };

  const tabela = DESCRICOES[tag];
  if (!tabela) {
    return { resolvido: true, texto: valor };
  }

  const descricao = tabela[valor];
  if (descricao) return { resolvido: true, texto: descricao };

  return {
    resolvido: false,
    texto: valor,
    motivo:
      `A NT 008 manda imprimir a descrição de "${tag}", mas as descrições vivem no leiaute da ` +
      `NFS-e, que não está versionado neste repositório. Imprimindo o código cru (${valor}).`,
  };
}

/** Tags que a NT manda descrever — usada pelo gerador para montar o relatório de conformidade. */
export const TAGS_CODIFICADAS = Object.freeze(Object.keys(DESCRICOES));
