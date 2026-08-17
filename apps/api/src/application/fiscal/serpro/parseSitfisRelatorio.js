// Lê o texto do relatório SITFIS e o transforma nas TABELAS que o PDF mostra.
//
// ⚠ Os CNPJs, razões sociais, números de parcelamento e inscrições citados nos comentários deste
// arquivo (e nas fixtures de `__tests__/parseSitfisRelatorio.test.js`) são ANONIMIZADOS: formato,
// pontuação e comprimento idênticos aos reais, dígitos fabricados. As observações são de produção;
// só os identificadores foram trocados, porque fixture entra no histórico do git para sempre.
// NÃO traga os identificadores reais de volta.
//
// ── COMO O TEXTO EXTRAÍDO REALMENTE É (conferido em produção, empresa COM pendência) ──
//
// O PDF mostra tabelas alinhadas, mas o texto extraído põe CADA CÉLULA EM UMA LINHA:
//
//   Pendência - Débito (SIEF) ______CNPJ: 60.666.777/0001-92Receita
//   PA/Exerc.
//   Dt. Vcto
//   … (9 linhas de cabeçalho)
//   4406-01 - MAED - PGDAS-D
//   23/02/2026
//   … (9 linhas por registro)
//
// Então a leitura é: contar as colunas pelo cabeçalho e agrupar as linhas de dados de N em N.
//
// ⚠ SÃO DUAS FORMAS DE BLOCO, NÃO UMA. A de cima é "cabeçalho e dados". A do PARCELAMENTO
// (SIEFPAR) é "rótulo e valor" — `Parcelamento:` numa linha, o número na seguinte. Ela tem leitura
// própria (`montarTabelaDePares`), que só é tentada quando NENHUM cabeçalho foi reconhecido; ver o
// bloco de comentário logo acima dela.
//
// ── AS SEIS ARMADILHAS, todas presentes no texto real ──
//
//  1. O CNPJ vem COLADO na primeira célula do cabeçalho:
//       "…______CNPJ: 60.666.777/0001-92Receita"  →  a coluna é "Receita".
//  2. O CABEÇALHO DA PÁGINA 2 corta a tabela no meio (MINISTÉRIO DA ECONOMIA, data, CNPJ…).
//     Sem removê-lo, essas linhas entram como células e desalinham TUDO a partir dali.
//  3. "Notificação de lançamento: 60666777202601001" vem colado no início do registro seguinte
//     ("…0011099-01 - CP-SEGUR."). É anotação do registro ANTERIOR, e o rabo é a próxima linha.
//  4. UMA CÉLULA PODE VIR PARTIDA EM DUAS LINHAS. O PA trimestral ("2º TRIM/2026") não cabe na
//     largura da coluna em alguns relatórios e a extração devolve "2º" e "TRIM/2026" separados —
//     ver `CELULAS_PARTIDAS`, abaixo.
//  5. NEM TODA RECEITA TEM CÓDIGO. O débito do Simples imprime só "SIMPLES NAC.", e aí a célula
//     colada na anotação não pode ser achada pelo código — ver `ANOTACAO_COM_CELULA_SEPARADA`.
//  6. QUANDO O REGISTRO ANOTADO É O ÚLTIMO DO BLOCO, o que vem colado na anotação é o TÍTULO DO
//     BLOCO SEGUINTE — ver `ANOTACAO_COLADA_NO_TITULO`.
//
// ⚠ 5 e 6 saem da MESMA linha do relatório (a anotação de lançamento) e foram medidas em produção
// em 17/08/2026, nos 22 relatórios guardados: das 6 anotações existentes, 2 caíam no caso 3 (que já
// funcionava), 1 no caso 5 e 2 no caso 6.
//
// ── POR QUE A CONTAGEM É A VALIDAÇÃO ──
//
// Se as linhas de dados não forem múltiplo exato do número de colunas, alguma armadilha escapou —
// e aí o bloco NÃO vira tabela: vai como "não interpretado", com as linhas cruas visíveis. É o que
// impede o retorno do defeito antigo, quando o parser exibia número em coluna errada (chegou a
// mostrar "R$ 100,00" de débito lendo o 100,00% de participação societária).

const REGUA = /_{6,}/g;

const ORGAOS = [
  { chave: "RFB", regex: /Diagn[óo]stico\s+Fiscal\s+na\s+Receita\s+Federal/i, nome: "Receita Federal" },
  { chave: "PGFN", regex: /Diagn[óo]stico\s+Fiscal\s+na\s+Procuradoria-?Geral\s+da\s+Fazenda\s+Nacional/i, nome: "Procuradoria-Geral da Fazenda Nacional" },
];

const SEM_PENDENCIA = /N[ãa]o\s+foram\s+detectadas\s+pend[êe]ncias/i;

// Cabeçalhos que o relatório usa. Lista FECHADA de propósito: é ela que separa cabeçalho de dado.
// Coluna desconhecida faz o bloco cair em "não interpretado" em vez de virar tabela torta.
//
// ⚠ O MESMO CABEÇALHO APARECE COM E SEM ESPAÇO, e a variante é do BLOCO, não do relatório.
// "Pendência - Débito (SIEF)" imprime `Vl. Original` / `Sdo. Devedor`; "Débito com Exigibilidade
// Suspensa (SIEF)" imprime `Vl.Original` / `Sdo.Devedor`, colados. Confirmado nos textos reais de
// 20.222.333/0001-53 (24/07/2026) e 30.333.444/0001-03 (06/08/2026), que trazem os dois blocos.
// Sem as duas variantes, a varredura do cabeçalho PARAVA em "Dt. Vcto": o bloco suspenso virava uma
// tabela de TRÊS colunas, o resto do cabeçalho entrava como registro e os valores caíam na coluna
// errada — "30,65" debaixo de "Receita". Como 27 linhas dividem por 3 sem sobra, a contagem fechava
// e a rede não pegava. É o defeito antigo, vivo em produção, e o conserto é reconhecer o nome real
// da coluna — nunca afrouxar a divisão.
const COLUNAS_CONHECIDAS = new Set([
  "Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor",
  "Vl.Original", "Sdo.Devedor",
  "Multa", "Juros", "Sdo. Dev. Cons.", "Situação",
  "Processo", "Localização",
  "Parcelas em atraso",
  "Inscrição", "Devedor", "Valor", "Tipo", "Data",
]);

// Ruído de cabeçalho/rodapé de página — some no meio das tabelas e precisa sair antes de agrupar.
const RUIDO = [
  /^MINIST[ÉE]RIO DA ECONOMIA$/i,
  /^Por meio do Integra Contador$/i,
  /^SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL$/i,
  /^PROCURADORIA-GERAL DA FAZENDA NACIONAL$/i,
  /^Autor pedido:/i,
  /^INFORMA[ÇC][ÕO]ES DE APOIO PARA EMISS[ÃA]O DE CERTID[ÃA]O$/i,
  /^CNPJ:?$/i,
  /^P[áa]gina:?\s*\d*\s*\/?\s*$/i,
  /^_+$/,                                        // régua solta: separador, nunca célula
  /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/,   // carimbo de emissão repetido por página
  // "60.666.777 - BETA TECNOLOGIA LTDA": o CNPJ + razão social do cabeçalho de página. Precisa sair
  // porque o cabeçalho da página 2 cai DENTRO de um bloco — confirmado nos textos reais de
  // 40.444.555/0001-64, 30.333.444/0001-03 e 10.111.222/0001-58.
  //
  // ⚠ O QUE DECIDE É A CAUDA TER LETRA, e essa exigência conserta uma PERDA DE DADO.
  // Sem ela a regra era "muitos dígitos e pontos, traço, mais qualquer coisa" — a mesma forma do
  // NÚMERO DO PARCELAMENTO, que ela engolia junto. Medido nos textos reais de produção lidos em
  // 10/08/2026: `0211.00012.0011122233.26-69` (10.111.222/0001-58, um parcelamento) e
  // `0211.00012.0044455566.26-88` / `.0077788899.25-54` / `.0012233445.25-20`
  // (30.333.444/0001-03, três). Os quatro sumiam da tela: o bloco do SIEFPAR mostrava
  // "Parcelamento:" sem valor, e saber de QUAL parcelamento eram as parcelas em atraso exigia
  // abrir o PDF. A mesma regra apagava a INSCRIÇÃO em dívida ativa (`70.4.24.100200-96`,
  // 40.444.555/0001-64) — os cinco casos numéricos observados nos 22 relatórios.
  //
  // ⚠ CONTINUA SENDO REGRA DE DESCARTE, e a exigência da letra é a formulação mais ESTREITA que
  // cobre o ruído observado: nos 22 relatórios, toda linha que precisa sair tem nome depois do
  // traço (razão social no cabeçalho, nome do responsável nos dados cadastrais). Trocar isto por
  // "cauda numérica" invertido — descartar por formato do número — deixaria lixo virar dado.
  /^[\d.]{10,}\s*-\s*.*\p{L}/u,
  /^Final do Relat[óo]rio$/i,
];

const limpar = (t) => String(t || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
const ehRuido = (l) => RUIDO.some((r) => r.test(l));

// "1099-01 - CP-SEGUR." — código de receita, usado para achar onde a anotação termina.
const INICIO_REGISTRO = /(\d{4}-\d{2}\s*-\s*\D.*)$/;

// ── ARMADILHA 5: NEM TODA RECEITA TEM CÓDIGO, e a anotação engolia a célula sem ele ──
//
// A armadilha 3 acha onde a anotação termina procurando o código de receita do registro seguinte
// (`INICIO_REGISTRO`). Mas a coluna "Receita" nem sempre traz código: o débito do Simples imprime
// só **"SIMPLES NAC."**. Nesse caso a linha vem
//
//   "Notificação de lançamento: 50000111222333          SIMPLES NAC."
//
// e o `INICIO_REGISTRO` não casa — então a linha INTEIRA virava anotação e a célula "SIMPLES NAC."
// do registro seguinte **sumia**. Medido em produção (17/08/2026): o bloco "Pendência - Débito
// (SIEF)" ficava com 17 linhas para 9 colunas, resto 8, e o bloco INTEIRO caía em `naoInterpretado`
// — o contador via 17 linhas cruas no lugar da tabela de pendências.
//
// ⚠ "SIMPLES NAC." NÃO É INVENTADO: é o valor que a coluna "Receita" imprime, e ele aparece assim
// em 7 outras empresas dos mesmos 22 relatórios, onde a linha não vem colada na anotação.
//
// ⚠ O QUE SEPARA OS DOIS CASOS É O ESPAÇO EM BRANCO, e é por isso que esta regra é a mais estreita
// possível. Quando o registro seguinte tem código, ele vem **colado** no número da notificação
// ("…202601001" + "1099-01 - CP-SEGUR.") e não há onde cortar sem reconhecer o código — que é
// exatamente o que a armadilha 3 faz. Quando não tem código, o relatório **separa** os dois com
// espaços. Então: número da notificação = a corrida de dígitos; havendo espaço depois dela, o que
// sobra é a próxima célula. Sem espaço, esta regra não faz nada e a armadilha 3 continua mandando.
//
// ⚠ A REDE DA CONTAGEM CONTINUA VALENDO. Se esta leitura estiver errada, o bloco ganha uma célula a
// mais, a divisão deixa de fechar e ele cai em `naoInterpretado` — que é o modo de falhar seguro.
const ANOTACAO_COM_CELULA_SEPARADA = /^(\d+)\s+(\S.*)$/;

// ── ARMADILHA 6: A ANOTAÇÃO COLADA NO TÍTULO DO BLOCO SEGUINTE ──
//
// Quando o registro anotado é o ÚLTIMO do bloco, o que vem colado na anotação não é o registro
// seguinte — é o **título do próximo bloco**:
//
//   "Notificação de lançamento: 8790111222333Débito com Exigibilidade Suspensa (SIEF) ______…"
//
// A separação em blocos acontece ANTES da normalização de linhas (o marcador é "título + régua na
// mesma linha"), então esse prefixo entrava no TÍTULO. Medido em produção (17/08/2026): duas
// empresas exibiam o bloco com o título "Notificação de lançamento: 8790111222333Débito com
// Exigibilidade Suspensa (SIEF)" — o PDF imprime "Débito com Exigibilidade Suspensa (SIEF)" —, e o
// número da notificação, que é do bloco ANTERIOR, sumia das anotações dele.
//
// Só se aplica a título que COMEÇA com o rótulo literal da notificação; qualquer outro passa
// intacto. O número volta para o bloco anterior, que é de onde ele veio.
const ANOTACAO_COLADA_NO_TITULO = /^Notifica[çc][ãa]o de lan[çc]amento:\s*(\d+)\s*(.*)$/i;

// ── ARMADILHA 4: CÉLULA PARTIDA EM DUAS LINHAS ──
//
// Uma célula é uma linha — menos quando o texto não cabe na largura da coluna no PDF. Aí a
// extração devolve os dois pedaços em linhas separadas, e aquele registro passa a ter UMA CÉLULA A
// MAIS que os outros. Como o agrupamento é posicional (de N em N), o resto da divisão não fecha e o
// BLOCO INTEIRO é recusado por causa de um registro. Medido em produção (10.111.222/0001-58,
// 10/08/2026): os 4 registros mensais traziam 9 células e os 2 trimestrais 10 — 56 linhas para 9
// colunas, resto 2, bloco inteiro em `naoInterpretado`.
//
// ⚠ O VALOR REMONTADO NÃO É INVENTADO — é o mesmo que o relatório imprime quando NÃO quebra.
// O texto de 20.222.333/0001-53 (24/07/2026) traz exatamente `2º TRIM/2026` numa linha só, no mesmo
// campo. A regra faz as duas formas convergirem para a que já existe; não cria coluna, não cria
// conteúdo, não muda a contagem de colunas.
//
// ⚠ LISTA FECHADA, pelo mesmo motivo de `COLUNAS_CONHECIDAS`: só funde o par de formatos que já foi
// visto no relatório real, e só quando os DOIS pedaços aparecem, NESSA ordem, um colado no outro.
// Metade do par não funde nada. Quebra de formato desconhecido continua desalinhando a contagem —
// e é isso que se quer: o bloco cai em `naoInterpretado` com as linhas cruas, em vez de virar uma
// tabela com valor em coluna errada.
const CELULAS_PARTIDAS = [
  {
    // "2º" + "TRIM/2026" → "2º TRIM/2026" (PA/Exerc. de tributo trimestral: IRPJ, CSLL).
    // `[ºo°]`: o indicador ordinal masculino (U+00BA) e o sinal de grau (U+00B0) são glifos
    // parecidos e a extração de PDF troca um pelo outro; "o" cobre o caso sem acentuação.
    nome: "PA/Exerc. trimestral",
    inicio: /^[1-4][ºo°]$/,
    continuacao: /^TRIM\/\d{4}$/,
  },
];

/**
 * Remonta as células que a extração partiu em duas linhas (armadilha 4).
 * Só junta o par completo e adjacente descrito em `CELULAS_PARTIDAS`; qualquer outra coisa passa
 * intacta. Nada é descartado — o pior caso é a contagem continuar não fechando.
 */
export function fundirCelulasPartidas(linhas) {
  const saida = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const regra = CELULAS_PARTIDAS.find(
      (r) => r.inicio.test(linhas[i]) && i + 1 < linhas.length && r.continuacao.test(linhas[i + 1]),
    );
    if (regra) {
      saida.push(`${linhas[i]} ${linhas[i + 1]}`);
      i += 1;
      continue;
    }
    saida.push(linhas[i]);
  }
  return saida;
}

/**
 * Normaliza as linhas de um bloco: tira ruído de página, separa o CNPJ colado e desgruda a
 * anotação de lançamento do registro seguinte.
 */
function linhasDoBloco(bruto) {
  const saida = [];
  const anotacoes = [];
  // O número da página vem numa linha própria, LOGO APÓS "Página: N /". Descartar todo número
  // solto seria pior do que o problema: comia o "4" de "Parcelas em atraso", que é dado real.
  // Por isso o descarte é posicional, não por formato.
  let aguardaNumeroDePagina = false;
  for (const raw of String(bruto || "").split(/\r?\n/)) {
    const l0 = limpar(raw);
    if (!l0) continue;
    if (aguardaNumeroDePagina) {
      aguardaNumeroDePagina = false;
      if (/^\d{1,3}$/.test(l0)) continue;
    }
    if (/^P[áa]gina:?\s*\d*\s*\/?\s*$/i.test(l0)) { aguardaNumeroDePagina = true; continue; }
    let l = l0;

    // Armadilha 1: "CNPJ: 60.666.777/0001-92Receita" → sobra "Receita".
    l = limpar(l.replace(/^CNPJ:\s*[\d.\-/]+/i, ""));
    if (!l) continue;

    // Armadilha 3: a anotação carrega o começo do próximo registro grudado.
    const mAnot = l.match(/^Notifica[çc][ãa]o de lan[çc]amento:\s*(.*)$/i);
    if (mAnot) {
      const resto = mAnot[1] || "";
      const mProx = resto.match(INICIO_REGISTRO);
      if (mProx) {
        anotacoes.push(limpar(resto.slice(0, mProx.index)));
        saida.push(limpar(mProx[1]));   // devolve o registro seguinte à fila
        continue;
      }
      // Armadilha 5: a próxima célula não tem código de receita ("SIMPLES NAC."), e por isso vem
      // SEPARADA do número da notificação por espaço em vez de colada nele.
      const mSep = resto.match(ANOTACAO_COM_CELULA_SEPARADA);
      if (mSep) {
        anotacoes.push(limpar(mSep[1]));
        saida.push(limpar(mSep[2]));    // devolve a célula seguinte à fila
        continue;
      }
      anotacoes.push(limpar(resto));
      continue;
    }

    // Armadilha 2: cabeçalho/rodapé de página no meio da tabela.
    if (ehRuido(l)) continue;
    saida.push(l);
  }
  return { linhas: saida, anotacoes };
}

// ── O BLOCO DO PARCELAMENTO (SIEFPAR): RÓTULO E VALOR, NÃO CABEÇALHO E DADOS ────────────────────
//
// ⚠ TABULAR ESTE BLOCO É DECISÃO DO DONO, TOMADA EM 17/08/2026. Antes disso o bloco saía inteiro
// em `descricao` — o rótulo numa linha, o valor na seguinte, sete linhas âmbar empilhadas para o
// que o PDF imprime como UMA linha horizontal:
//
//   Parcelamento: 0211.00012.0011122233.26-69   Parcelas em Atraso: 3   Valor em Atraso: 1.585,74
//   Parcelamento Simplificado
//
// ⚠ LISTA FECHADA, pelo mesmo motivo de `COLUNAS_CONHECIDAS` e de `CELULAS_PARTIDAS`: são os
// QUATRO rótulos que aparecem nos 22 relatórios reais guardados (dois blocos SIEFPAR, um com um
// parcelamento e outro com três). Rótulo novo NÃO vira coluna — ele fica de fora do par, o bloco
// deixa de fechar e cai no aviso, que é o modo de falhar seguro.
const ROTULOS_SIEFPAR = [
  "Parcelamento:",
  "Parcelas em Atraso:",
  "Valor em Atraso:",
  "Valor Suspenso:",
];

// ⚠ O CASO QUE DECIDE O DESENHO É O RÓTULO COLADO, e ele só aparece com 2+ parcelamentos.
// O relatório NÃO separa um parcelamento do outro: a modalidade do anterior vem grudada no rótulo
// do seguinte — `"Parcelamento SimplificadoParcelamento:"` (texto real de 30.333.444/0001-03, três
// parcelamentos). Tratar só o caso simples deixaria esse bloco quebrado exatamente como está hoje.
//
// ⚠ O CORTE É NO RÓTULO INTEIRO, nunca por proximidade ou por formato: a linha só é partida quando
// TERMINA com um dos rótulos da lista fechada e sobra alguma coisa antes dele. Mesma disciplina das
// armadilhas 1 e 6 (o CNPJ colado na célula, a anotação colada no título). Um corte por linha —
// é a forma observada, e mais que isso seria regra sem caso.
function separarRotuloColado(linha) {
  const rotulo = ROTULOS_SIEFPAR
    .filter((r) => linha.length > r.length && linha.endsWith(r))
    .sort((a, b) => b.length - a.length)[0];
  if (!rotulo) return [linha];
  return [limpar(linha.slice(0, linha.length - rotulo.length)), rotulo];
}

/**
 * Lê o bloco rótulo/valor do SIEFPAR e devolve a tabela — ou `null`, e aí o bloco fica como estava.
 *
 * ⚠ NÃO INVENTA PAR. Um rótulo só se emparelha com a linha SEGUINTE, e só quando ela não é outro
 * rótulo. Rótulo sem valor e linha sem rótulo (a modalidade "Parcelamento Simplificado", que o
 * relatório imprime solta) ficam FORA da tabela e voltam em `naoInterpretado`, com o aviso — nunca
 * casados com o vizinho por proximidade. Casar por proximidade é o defeito antigo deste parser, o
 * que mostrava "R$ 100,00" de débito lendo o "100,00%" do quadro societário.
 *
 * ⚠ A PROTEÇÃO DA CONTAGEM NÃO FOI AFROUXADA, só mudou de forma: onde a tabela de colunas exige
 * `dados % colunas === 0`, aqui se exige que TODOS os registros tenham exatamente os mesmos
 * rótulos, na mesma ordem. Um parcelamento com um campo a mais (ou a menos) que os outros derruba
 * o bloco inteiro para o estado anterior, com as linhas cruas visíveis.
 */
export function montarTabelaDePares(linhas) {
  const norm = linhas.flatMap(separarRotuloColado).filter(Boolean);
  const ehRotulo = (l) => ROTULOS_SIEFPAR.includes(l);
  if (!norm.some(ehRotulo)) return null;

  const soltas = [];
  const pares = [];
  for (let i = 0; i < norm.length; i += 1) {
    const valor = norm[i + 1];
    if (!ehRotulo(norm[i]) || valor === undefined || ehRotulo(valor)) { soltas.push(norm[i]); continue; }
    pares.push([norm[i].replace(/:$/, ""), valor]);
    i += 1;
  }
  if (!pares.length) return null;

  // Rótulo que se repete abre um registro NOVO: é o que separa os três parcelamentos, já que o
  // relatório não traz separador nenhum entre eles.
  const registros = [];
  for (const [rotulo, valor] of pares) {
    let atual = registros[registros.length - 1];
    if (!atual || rotulo in atual) { atual = {}; registros.push(atual); }
    atual[rotulo] = valor;
  }

  const colunas = Object.keys(registros[0]);
  const mesmaForma = (r) => {
    const k = Object.keys(r);
    return k.length === colunas.length && k.every((c, idx) => c === colunas[idx]);
  };
  if (!registros.every(mesmaForma)) return null;

  return { descricao: [], colunas, registros, naoInterpretado: soltas };
}

/** Monta uma tabela a partir das linhas já normalizadas. */
function montarTabela(linhas) {
  // Antes do cabeçalho pode vir uma descrição livre ("SIMPLES NACIONAL - EM PARCELAMENTO").
  let i = 0;
  const descricao = [];
  while (i < linhas.length && !COLUNAS_CONHECIDAS.has(linhas[i])) { descricao.push(linhas[i]); i += 1; }

  const colunas = [];
  while (i < linhas.length && COLUNAS_CONHECIDAS.has(linhas[i])) { colunas.push(linhas[i]); i += 1; }

  // A fusão vale só para as CÉLULAS DE DADO. Cabeçalho e descrição ficam de fora de propósito:
  // quem decide o que é coluna é `COLUNAS_CONHECIDAS`, e remontar linha antes disso mudaria a
  // fronteira entre cabeçalho e dado.
  const dados = fundirCelulasPartidas(linhas.slice(i));
  if (!colunas.length) {
    // ⚠ A LEITURA POR PARES SÓ ENTRA AQUI, e isso é o que garante que nenhum bloco que já virava
    // tabela possa mudar: quando o cabeçalho foi reconhecido, este ramo nem é alcançado.
    const pares = montarTabelaDePares(descricao);
    if (pares) return pares;
    return { descricao, colunas: [], registros: [], naoInterpretado: dados };
  }

  // A VALIDAÇÃO: dados têm que fechar em múltiplo exato das colunas.
  if (dados.length % colunas.length !== 0) {
    return { descricao, colunas, registros: [], naoInterpretado: dados };
  }

  const registros = [];
  for (let k = 0; k < dados.length; k += colunas.length) {
    const celulas = dados.slice(k, k + colunas.length);
    registros.push(Object.fromEntries(colunas.map((c, idx) => [c, celulas[idx]])));
  }
  return { descricao, colunas, registros, naoInterpretado: [] };
}

/**
 * @param {string} texto  texto extraído do PDF do relatório SITFIS
 */
export function parseSitfisRelatorio(texto) {
  const t = String(texto || "");
  const out = {
    emitidoEm: null,
    contribuinte: { cnpj: null, nome: null },
    diagnosticos: [],
    naoInterpretado: [],
    temTexto: Boolean(t.trim()),
  };
  if (!out.temTexto) return out;

  const mData = t.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (mData) out.emitidoEm = `${mData[1]} ${mData[2]}`;

  const mContrib = t.match(/CNPJ:\s*\n\s*([\d.\-/]{10,})\s*-\s*([^\n]+)/);
  if (mContrib) {
    out.contribuinte.cnpj = limpar(mContrib[1]);
    out.contribuinte.nome = limpar(mContrib[2]);
  }

  const marcos = [];
  for (const org of ORGAOS) {
    const m = t.match(org.regex);
    if (m && m.index != null) marcos.push({ ...org, inicio: m.index, fim: m.index + m[0].length });
  }
  marcos.sort((a, b) => a.inicio - b.inicio);

  for (let i = 0; i < marcos.length; i += 1) {
    const atual = marcos[i];
    const trecho = t.slice(atual.fim, marcos[i + 1] ? marcos[i + 1].inicio : t.length);
    const semPendencia = SEM_PENDENCIA.test(trecho);
    const blocos = [];

    if (!semPendencia) {
      // Um bloco é sempre "<título> ______". Nem todo bloco começa com "Pendência -": empresa só
      // com parcelamento traz "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI) ______".
      // Por isso o marcador é a RÉGUA precedida de texto, não uma palavra específica.
      // `[ \t]*` e NÃO `\s*`: o título tem que estar na MESMA LINHA da régua. Com `\s*` a régua
      // que fecha a seção (numa linha só) engolia a linha anterior como se fosse título — e o
      // conteúdo do bloco de verdade virava vazio.
      // A régua que ABRE a próxima seção fica dentro deste trecho e, em alguns relatórios, na
      // MESMA linha do último conteúdo ("…EM PARCELAMENTO______ Diagnóstico Fiscal na PGFN").
      // Sem aparar, ela vira um marcador falso cujo "título" é o conteúdo real — e o bloco de
      // verdade fica vazio.
      const corpoSecao = trecho.replace(/[ \t]*_{6,}[ \t]*$/, "");
      const marcadores = [...corpoSecao.matchAll(/([^\n_]{3,120}?)[ \t]*_{6,}/g)];
      for (let b = 0; b < marcadores.length; b += 1) {
        const m = marcadores[b];
        let titulo = limpar(m[1]);
        // Armadilha 6: a anotação do último registro do bloco ANTERIOR vem colada neste título.
        // O número volta para o bloco de onde veio; o título fica como o PDF o imprime.
        const mColado = titulo.match(ANOTACAO_COLADA_NO_TITULO);
        if (mColado) {
          const anterior = blocos[blocos.length - 1];
          if (anterior) anterior.anotacoes.push(mColado[1]);
          titulo = limpar(mColado[2]);
        }
        const inicio = m.index + m[0].length;
        const fim = marcadores[b + 1] ? marcadores[b + 1].index : corpoSecao.length;
        const { linhas, anotacoes } = linhasDoBloco(corpoSecao.slice(inicio, fim));
        if (!linhas.length && !anotacoes.length) continue;
        blocos.push({ titulo: titulo || null, anotacoes, ...montarTabela(linhas) });
      }
    }

    out.diagnosticos.push({ orgao: atual.nome, chave: atual.chave, semPendencia, blocos });
  }

  for (const org of ORGAOS) {
    if (!out.diagnosticos.some((d) => d.chave === org.chave)) {
      out.naoInterpretado.push(`Seção não encontrada no relatório: ${org.nome}`);
    }
  }

  return out;
}
