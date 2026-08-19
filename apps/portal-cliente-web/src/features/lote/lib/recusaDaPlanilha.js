// O QUE O SERVIDOR RECUSOU AO LER A PLANILHA — traduzido sem inventar procedimento.
//
// ⚠ **A MENSAGEM DO SERVIDOR VENCE.** Ela já vem escrita por extenso e com os dados do caso (quais
// colunas faltam, qual cabeçalho veio, qual é o teto de linhas) — o texto daqui só entra quando não
// veio nada. Mesma regra de `notas/lib/loteDanfse.js` e de `emitir/lib/desfechoEmissao.js`: código
// que esta tela não conhece **não** ganha um "tente de novo" fabricado.
//
// Os códigos são de `apps/api/src/application/nfse/lote/lerPlanilhaLote.js` (`RECUSA_PLANILHA`),
// `ajustesLote.js` (`RECUSA_AJUSTE`) e da própria rota (`arquivo_ausente`).

export const RECUSA = Object.freeze({
  ARQUIVO_AUSENTE: "arquivo_ausente",
  ILEGIVEL: "planilha_ilegivel",
  SEM_ABA: "planilha_sem_aba",
  SEM_CABECALHO: "planilha_sem_cabecalho",
  COLUNAS_FALTANDO: "planilha_colunas_faltando",
  SEM_LINHAS: "planilha_sem_linhas",
  LINHAS_DEMAIS: "planilha_linhas_demais",
  AJUSTE_FORMA: "ajuste_forma_invalida",
  AJUSTE_LINHA: "ajuste_linha_desconhecida",
  AJUSTE_COLUNA: "ajuste_coluna_desconhecida",
});

const TITULO = Object.freeze({
  [RECUSA.ARQUIVO_AUSENTE]: "Nenhum arquivo foi enviado.",
  [RECUSA.ILEGIVEL]: "Não conseguimos abrir este arquivo.",
  [RECUSA.SEM_ABA]: "A planilha está vazia.",
  [RECUSA.SEM_CABECALHO]: "Não reconhecemos o cabeçalho desta planilha.",
  [RECUSA.COLUNAS_FALTANDO]: "Faltam colunas obrigatórias.",
  [RECUSA.SEM_LINHAS]: "Não há nenhuma linha preenchida.",
  [RECUSA.LINHAS_DEMAIS]: "São linhas demais para um lote só.",
  // ⚠⚠ AS TRÊS ABAIXO NÃO SÃO SOBRE A PLANILHA — são sobre o AJUSTE que a tela mandou. O título
  // precisa dizer isso, e precisa dizer que **nada foi aplicado**: o pior desfecho aqui é a pessoa
  // achar que a correção entrou.
  [RECUSA.AJUSTE_FORMA]: "O ajuste não foi aplicado.",
  [RECUSA.AJUSTE_LINHA]: "O ajuste não foi aplicado: a linha não existe nesta planilha.",
  [RECUSA.AJUSTE_COLUNA]: "O ajuste não foi aplicado: campo desconhecido.",
});

/** `true` quando a recusa é do AJUSTE — a planilha lida continua valendo, e a tela não a descarta. */
export function ehRecusaDeAjuste(codigo) {
  return (
    codigo === RECUSA.AJUSTE_FORMA
    || codigo === RECUSA.AJUSTE_LINHA
    || codigo === RECUSA.AJUSTE_COLUNA
  );
}

/**
 * @returns `{ codigo, titulo, texto, deAjuste }`
 */
export function lerRecusaDaPlanilha(err) {
  const codigo = String(err?.code || "").trim().toLowerCase() || null;
  const doServidor = String(err?.message || "").trim();

  return {
    codigo,
    titulo: TITULO[codigo] || "Não conseguimos ler esta planilha.",
    // ⚠ Sem mensagem do servidor, a frase diz o que se sabe e aponta o caminho que sempre existe —
    // baixar o modelo de novo. Ela nunca afirma o motivo.
    texto:
      doServidor
      || "O servidor não disse o motivo. Baixe o modelo, preencha e envie de volta sem renomear as colunas.",
    deAjuste: ehRecusaDeAjuste(codigo),
  };
}
