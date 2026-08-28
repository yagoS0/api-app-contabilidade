// O MAPEAMENTO DE UM EXTRATO EM EXCEL — qual coluna é a data, qual é o valor, qual é o histórico.
//
// ⚠⚠ POR QUE ISTO NÃO É UM DETECTOR AUTOMÁTICO. O OFX tem formato; o Excel do banco não tem — cada
// banco escreve o cabeçalho como quer, e vários nem têm cabeçalho reconhecível. Adivinhar e
// importar é o caminho curto para um extrato inteiro entrar com data no lugar de valor, ou com o
// sinal invertido. E o destino disto é a fila de conferência do contador: um erro aqui vira
// despesa lançada errada.
//
// Decisão do dono (27/08/2026): **"o contador mapeia as colunas, e o mapeamento fica salvo por
// empresa"**. Então o desenho é:
//
//   1. o sistema PROPÕE (por `HEADER_ALIASES`, o mesmo palpite que o import contábil já usa);
//   2. o contador CONFIRMA uma vez, por empresa + banco;
//   3. os próximos envios daquele banco entram sozinhos.
//
// É O(1) por banco, não por envio. E a proposta **nunca** vale como resposta: sem confirmação, o
// arquivo não vira lançamento.

/** Os três papéis que uma coluna pode ter. ⚠ Lista FECHADA. */
import { lerValorDaPlanilha } from "../../nfse/lote/celulasLote.js";

export const PAPEL = Object.freeze({
  DATA: "data",
  VALOR: "valor",
  HISTORICO: "historico",
  /** ⚠ Opcional, e é o que resolve a metade dos bancos — ver `SINAL`. */
  SINAL: "sinal",
});

export const PAPEIS_OBRIGATORIOS = Object.freeze([PAPEL.DATA, PAPEL.VALOR, PAPEL.HISTORICO]);

/**
 * ⚠⚠ COMO O BANCO DIZ QUE A LINHA É UMA SAÍDA — e são três formas, não uma.
 *
 * Esta é a pergunta que decide se a linha entra na fila de despesa ou fica de fora, e errá-la
 * inverte o extrato inteiro. Os bancos fazem de três jeitos, e nenhum é dedutível do outro:
 *
 *   · `VALOR_NEGATIVO` — a saída vem com sinal negativo na própria coluna de valor;
 *   · `COLUNA_DE_SINAL` — há uma coluna à parte ("D/C", "Tipo", "Débito/Crédito");
 *   · `COLUNAS_SEPARADAS` — entradas numa coluna, saídas noutra.
 *
 * ⚠ A terceira NÃO é suportada nesta versão, e ela sai NOMEADA em vez de ser adivinhada: mapear
 * duas colunas de valor exigiria um segundo `PAPEL` e mudaria a leitura da linha inteira. Recusar
 * com nome é honesto; escolher uma das duas colunas em silêncio importaria metade do extrato.
 */
export const SINAL = Object.freeze({
  VALOR_NEGATIVO: "valor_negativo",
  COLUNA_DE_SINAL: "coluna_de_sinal",
  COLUNAS_SEPARADAS: "colunas_separadas",
});

export const SINAIS_SUPORTADOS = Object.freeze([SINAL.VALOR_NEGATIVO, SINAL.COLUNA_DE_SINAL]);

/**
 * ⚠ O PALPITE INICIAL — os MESMOS apelidos que `application/accounting/excelImport.js` já usa.
 *
 * Duas listas de apelidos para a mesma pergunta divergiriam, e o contador veria o portal propor uma
 * coisa no import do escritório e outra no do cliente, sobre o mesmo arquivo.
 */
export const APELIDOS = Object.freeze({
  [PAPEL.DATA]: ["data", "date", "dt", "dia", "data lancamento", "data do lancamento", "data mov"],
  [PAPEL.HISTORICO]: [
    "descricao", "historico", "description", "memo", "narrative", "lancamento",
    "historico do lancamento", "detalhe", "descricao do lancamento",
  ],
  [PAPEL.VALOR]: ["valor", "value", "amount", "vlr", "preco", "total", "valor r$", "valor lancamento"],
  [PAPEL.SINAL]: ["tipo", "d/c", "dc", "debito/credito", "debito credito", "natureza", "sinal", "d c"],
});

/** ⚠ A MESMA normalização do `excelImport.js` — acento, pontuação e caixa não decidem nada. */
export function normalizarCabecalho(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_/.,;:!?()[\]{}]+/g, " ")
    .trim();
}

/**
 * ⚠⚠ A PROPOSTA — e ela sai marcada como PROPOSTA, nunca como mapeamento.
 *
 * Devolve, para cada papel, o índice da coluna que os apelidos reconheceram (ou `null`). O
 * consumidor precisa saber que isto é um chute: o campo `confirmado` nasce `false` e só uma pessoa
 * o vira. É a mesma forma de `sugerirCategoriaPresumido` — o sistema propõe, nomeia o que
 * derrubaria a proposta, e nada entra em conta sem confirmação.
 *
 * @param {Array<string>} cabecalhos  a linha de cabeçalho, célula a célula
 */
export function proporMapeamento(cabecalhos = []) {
  const celulas = (Array.isArray(cabecalhos) ? cabecalhos : []).map(normalizarCabecalho);
  const colunas = {};
  const ambiguidades = [];

  for (const [papel, apelidos] of Object.entries(APELIDOS)) {
    // ⚠ Casamento EXATO primeiro, depois "começa com". Substring solta faria "data" casar com
    // "atualizado" e "valor" com "valor do saldo anterior".
    const exatos = [];
    for (let i = 0; i < celulas.length; i += 1) {
      if (!celulas[i]) continue;
      if (apelidos.includes(celulas[i])) exatos.push(i);
    }
    const parciais = exatos.length ? [] : celulas
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c && apelidos.some((a) => c.startsWith(a)))
      .map(({ i }) => i);

    const achados = exatos.length ? exatos : parciais;
    // ⚠⚠ DUAS COLUNAS PARA O MESMO PAPEL NÃO ELEGEM A PRIMEIRA — elas viram AMBIGUIDADE nomeada.
    // "Valor" e "Valor R$" na mesma planilha é caso real (saldo × lançamento), e escolher sozinho
    // importaria a coluna errada com aparência de acerto.
    if (achados.length > 1) {
      ambiguidades.push({ papel, colunas: achados });
      colunas[papel] = null;
    } else {
      colunas[papel] = achados.length === 1 ? achados[0] : null;
    }
  }

  const faltando = PAPEIS_OBRIGATORIOS.filter((p) => colunas[p] == null);
  return {
    colunas,
    ambiguidades,
    faltando,
    // ⚠ O sinal proposto: com coluna de sinal reconhecida, é ela; sem, o palpite é valor negativo.
    // ⚠ E ele é PALPITE — um banco que escreva saída como positivo numa planilha sem coluna de
    // sinal importaria tudo invertido. Por isso o contador confirma.
    sinal: colunas[PAPEL.SINAL] != null ? SINAL.COLUNA_DE_SINAL : SINAL.VALOR_NEGATIVO,
    /** ⚠⚠ SEMPRE `false`. Só uma pessoa vira isto — nenhum caminho de código pode. */
    confirmado: false,
    completa: faltando.length === 0 && ambiguidades.length === 0,
  };
}

/**
 * O mapeamento que veio (do banco de dados ou de um formulário) é utilizável?
 *
 * ⚠⚠ `confirmado !== true` RECUSA. É a trava inteira da fase: sem a confirmação de uma pessoa, o
 * arquivo não vira lançamento contábil. `Boolean("false")` é `true`, então a comparação é estrita.
 */
export function validarMapeamento(mapa) {
  const colunas = mapa?.colunas && typeof mapa.colunas === "object" ? mapa.colunas : {};
  const erros = [];

  for (const papel of PAPEIS_OBRIGATORIOS) {
    const i = colunas[papel];
    if (!Number.isInteger(i) || i < 0) erros.push({ papel, motivo: "coluna_nao_indicada" });
  }

  // ⚠ Duas colunas obrigatórias apontando para o MESMO índice é erro de preenchimento, e passaria
  // despercebido: a data viraria o valor e o valor viraria a data, cada linha "funcionando".
  const usados = new Map();
  for (const papel of PAPEIS_OBRIGATORIOS) {
    const i = colunas[papel];
    if (!Number.isInteger(i)) continue;
    if (usados.has(i)) erros.push({ papel, motivo: "coluna_repetida", com: usados.get(i) });
    else usados.set(i, papel);
  }

  const sinal = String(mapa?.sinal || "");
  if (!SINAIS_SUPORTADOS.includes(sinal)) {
    erros.push({
      papel: PAPEL.SINAL,
      motivo: sinal === SINAL.COLUNAS_SEPARADAS ? "sinal_em_colunas_separadas" : "sinal_desconhecido",
    });
  }
  if (sinal === SINAL.COLUNA_DE_SINAL && !Number.isInteger(colunas[PAPEL.SINAL])) {
    erros.push({ papel: PAPEL.SINAL, motivo: "coluna_de_sinal_nao_indicada" });
  }

  if (mapa?.confirmado !== true) erros.push({ papel: null, motivo: "nao_confirmado" });

  return { ok: erros.length === 0, erros };
}

const FRASE_DO_ERRO = Object.freeze({
  coluna_nao_indicada: "não foi indicada qual coluna da planilha tem este dado",
  coluna_repetida: "duas colunas obrigatórias apontam para a MESMA coluna da planilha",
  sinal_desconhecido: "não foi dito como o banco marca as saídas nesta planilha",
  sinal_em_colunas_separadas: "esta planilha usa uma coluna para entradas e outra para saídas, e "
    + "essa forma ainda não é lida aqui — envie o extrato em OFX",
  coluna_de_sinal_nao_indicada: "foi dito que há uma coluna de débito/crédito, mas ela não foi indicada",
  nao_confirmado: "o mapeamento ainda não foi confirmado pelo contador",
});

export const fraseDoErroDeMapeamento = (motivo) => FRASE_DO_ERRO[motivo] || null;

/**
 * ⚠⚠ A LINHA É SAÍDA? — e as três respostas incluem "não sei".
 *
 * Só o DÉBITO entra na fila (é fila de DESPESA — a mesma regra do OFX, e pelo mesmo motivo: a forma
 * do lançamento de ENTRADA não foi medida). Mas "não é saída" e "não deu para ler o sinal" são
 * coisas diferentes: a primeira é um crédito legítimo, contado e nomeado; a segunda é uma linha que
 * ninguém sabe classificar, e tratá-la como crédito a faria sumir em silêncio.
 */
export const LEITURA_DO_SINAL = Object.freeze({
  SAIDA: "saida",
  ENTRADA: "entrada",
  DESCONHECIDO: "desconhecido",
});

const MARCAS_DE_SAIDA = ["d", "db", "deb", "debito", "saida", "pagamento", "-"];
const MARCAS_DE_ENTRADA = ["c", "cr", "cred", "credito", "entrada", "recebimento", "+"];

/**
 * ⚠⚠ CÉLULA DE SINAL NÃO É CABEÇALHO, e usar a mesma normalização apaga a resposta.
 *
 * `normalizarCabecalho` trata `+` e `-` como pontuação e os remove — o que é certo num título de
 * coluna e ERRADO aqui: há banco cuja coluna de débito/crédito contém literalmente `-` e `+`, e a
 * célula inteira viraria string vazia, ou seja "não sei". A linha sumiria da fila de despesa em
 * silêncio, que é exatamente o desfecho que a terceira resposta existe para impedir.
 *
 * ⚠ Pego pelo teste, não pela leitura: as duas funções pareciam intercambiáveis.
 */
function normalizarMarcaDeSinal(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * ⚠⚠ O VALOR DA LINHA — e ele REUSA a gramática do lote, não escreve a segunda.
 *
 * `lerValorDaPlanilha` (`nfse/lote/celulasLote.js`) já resolve a ambiguidade que decide tudo aqui:
 * `1.500` é mil e quinhentos ou um e cinquenta? Ela tem gramática FECHADA, distingue célula
 * numérica de célula de texto, recusa moeda com três casas e nomeia cada recusa. Escrever um
 * segundo parser de dinheiro nesta casa é como o `1.500` já virou `1.5` uma vez.
 *
 * ⚠⚠ O QUE ESTE ACRESCENTA É O SINAL, e é por isso que ele existe: aquela função **recusa valor
 * não positivo** (`NAO_POSITIVO`) — o que é certo numa nota fiscal e errado num extrato, onde o
 * débito É negativo. Aqui o sinal sai PRIMEIRO e o módulo do valor vai para a gramática.
 *
 * ⚠ Só o `-` À FRENTE é reconhecido como negativo. Parênteses contábeis (`(1.234,56)`) e o `-` no
 * FIM existem em alguns formatos e **não** foram medidos em extrato de banco neste projeto —
 * aceitá-los por analogia seria inventar leitura de dinheiro. Eles caem em ilegível, contados e
 * nomeados no relatório, que é o lado seguro: uma linha na fila de pendência, nunca uma despesa
 * com o sinal trocado.
 */
export function lerValorDoExtrato(celula) {
  if (typeof celula === "number") {
    if (!Number.isFinite(celula)) return { ok: false, motivo: "ilegivel", negativo: false };
    const r = lerValorDaPlanilha(Math.abs(celula));
    return r.ok
      ? { ok: true, valor: r.valor, negativo: celula < 0 }
      : { ok: false, motivo: r.motivo, negativo: celula < 0 };
  }

  const original = String(celula ?? "").trim();
  if (!original) return { ok: false, motivo: "ausente", negativo: false };

  // ⚠ O sinal é retirado ANTES da gramática, e o espaço entre ele e o número também: bancos
  // escrevem `- 1.234,56`.
  const negativo = /^-/.test(original);
  const semSinal = negativo ? original.replace(/^-\s*/, "") : original;

  const r = lerValorDaPlanilha(semSinal);
  return r.ok ? { ok: true, valor: r.valor, negativo } : { ok: false, motivo: r.motivo, negativo };
}

export function lerSinalDaLinha({ sinal, valorBruto, celulaDeSinal }) {
  if (sinal === SINAL.COLUNA_DE_SINAL) {
    const t = normalizarMarcaDeSinal(celulaDeSinal);
    if (!t) return LEITURA_DO_SINAL.DESCONHECIDO;
    if (MARCAS_DE_SAIDA.includes(t)) return LEITURA_DO_SINAL.SAIDA;
    if (MARCAS_DE_ENTRADA.includes(t)) return LEITURA_DO_SINAL.ENTRADA;
    // ⚠ Marca fora da lista NÃO vira entrada por descarte — vira "não sei".
    return LEITURA_DO_SINAL.DESCONHECIDO;
  }

  // VALOR_NEGATIVO
  //
  // ⚠⚠ AQUI NÃO SE USA `Number(valorBruto)`, E A DIFERENÇA É A MAIORIA DAS PLANILHAS.
  // `Number("1.234,56")` é **NaN** — ou seja, todo extrato cuja coluna de valor chegou como TEXTO
  // responderia "não sei" em TODA linha, e o arquivo inteiro sumiria da fila em silêncio. É a
  // família do `Number(null) === 0`, com o sinal trocado.
  //
  // ⚠⚠ ZERO NÃO É SAÍDA NEM ENTRADA, e continua não sendo: `lerValorDaPlanilha` recusa não positivo
  // (`NAO_POSITIVO`), e valor ilegível não vira entrada por descarte. Linha de valor zero num
  // extrato é saldo, separador ou erro de leitura; criar uma despesa de R$ 0,00 na fila do contador
  // é ruído que ele tem de resolver.
  const lido = lerValorDoExtrato(valorBruto);
  if (!lido.ok) return LEITURA_DO_SINAL.DESCONHECIDO;
  return lido.negativo ? LEITURA_DO_SINAL.SAIDA : LEITURA_DO_SINAL.ENTRADA;
}

/**
 * ⚠⚠ COMO SE IDENTIFICA "O BANCO" NUM ARQUIVO EXCEL — pela ASSINATURA DO CABEÇALHO.
 *
 * O mapeamento fica salvo "por empresa + banco" (decisão do dono), e aí vem a pergunta que o
 * formato não responde: **qual banco é este?** Uma planilha de extrato não tem código de banco
 * como o OFX tem (`<BANKID>`); ela tem um nome de arquivo que a pessoa renomeia e um cabeçalho.
 *
 * O que dá para OBSERVAR é o cabeçalho: dois extratos do mesmo banco têm o mesmo conjunto de
 * colunas, e de bancos diferentes, não. Então a chave é a assinatura das células de cabeçalho,
 * normalizadas e ORDENADAS.
 *
 * ⚠ ORDENADAS de propósito: o banco pode reordenar colunas entre versões do arquivo, e uma chave
 * sensível à ordem faria o contador remapear a mesma planilha. Os ÍNDICES das colunas continuam
 * sendo lidos do arquivo de cada envio — a chave identifica o FORMATO, não a posição.
 *
 * ⚠⚠ E ISTO NÃO É O NOME DO BANCO. Ela é uma impressão digital, não uma afirmação: o rótulo legível
 * (`Itaú`, `Banco do Brasil`) é o contador que escreve, e ele viaja ao lado. Deduzir o nome do banco
 * a partir do cabeçalho seria inventar, e o nome aparece na tela dele.
 */
export function assinaturaDoCabecalho(cabecalhos = []) {
  const chaves = (Array.isArray(cabecalhos) ? cabecalhos : [])
    .map(normalizarCabecalho)
    .filter(Boolean)
    .sort();
  // ⚠ Cabeçalho vazio NÃO produz assinatura: sem colunas não há formato a reconhecer, e uma chave
  // vazia colaria arquivos ilegíveis de bancos diferentes no mesmo mapeamento.
  if (!chaves.length) return null;
  return chaves.join("|");
}
