// Lê o texto do relatório SITFIS e o transforma nas TABELAS que o PDF mostra.
//
// ── COMO O TEXTO EXTRAÍDO REALMENTE É (conferido em produção, empresa COM pendência) ──
//
// O PDF mostra tabelas alinhadas, mas o texto extraído põe CADA CÉLULA EM UMA LINHA:
//
//   Pendência - Débito (SIEF) ______CNPJ: 52.682.158/0001-92Receita
//   PA/Exerc.
//   Dt. Vcto
//   … (9 linhas de cabeçalho)
//   4406-01 - MAED - PGDAS-D
//   23/02/2026
//   … (9 linhas por registro)
//
// Então a leitura é: contar as colunas pelo cabeçalho e agrupar as linhas de dados de N em N.
//
// ── AS QUATRO ARMADILHAS, todas presentes no texto real ──
//
//  1. O CNPJ vem COLADO na primeira célula do cabeçalho:
//       "…______CNPJ: 52.682.158/0001-92Receita"  →  a coluna é "Receita".
//  2. O CABEÇALHO DA PÁGINA 2 corta a tabela no meio (MINISTÉRIO DA ECONOMIA, data, CNPJ…).
//     Sem removê-lo, essas linhas entram como células e desalinham TUDO a partir dali.
//  3. "Notificação de lançamento: 52682158202601001" vem colado no início do registro seguinte
//     ("…0011099-01 - CP-SEGUR."). É anotação do registro ANTERIOR, e o rabo é a próxima linha.
//  4. UMA CÉLULA PODE VIR PARTIDA EM DUAS LINHAS. O PA trimestral ("2º TRIM/2026") não cabe na
//     largura da coluna em alguns relatórios e a extração devolve "2º" e "TRIM/2026" separados —
//     ver `CELULAS_PARTIDAS`, abaixo.
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
// 46.848.383/0001-53 (24/07/2026) e 55.387.580/0001-03 (06/08/2026), que trazem os dois blocos.
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
  // "52.682.158 - ATIM ENGENHARIA LTDA": o CNPJ + razão social do cabeçalho de página. Precisa sair
  // porque o cabeçalho da página 2 cai DENTRO de um bloco — confirmado nos textos reais de
  // 53.742.042/0001-64, 55.387.580/0001-03 e 61.324.247/0001-58.
  //
  // ⚠ O QUE DECIDE É A CAUDA TER LETRA, e essa exigência conserta uma PERDA DE DADO.
  // Sem ela a regra era "muitos dígitos e pontos, traço, mais qualquer coisa" — a mesma forma do
  // NÚMERO DO PARCELAMENTO, que ela engolia junto. Medido nos textos reais de produção lidos em
  // 10/08/2026: `0211.00012.0042365911.26-69` (61.324.247/0001-58, um parcelamento) e
  // `0211.00012.0056912479.26-88` / `.0117250325.25-54` / `.0134178936.25-20`
  // (55.387.580/0001-03, três). Os quatro sumiam da tela: o bloco do SIEFPAR mostrava
  // "Parcelamento:" sem valor, e saber de QUAL parcelamento eram as parcelas em atraso exigia
  // abrir o PDF. A mesma regra apagava a INSCRIÇÃO em dívida ativa (`70.4.24.435196-96`,
  // 53.742.042/0001-64) — os cinco casos numéricos observados nos 22 relatórios.
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

// ── ARMADILHA 4: CÉLULA PARTIDA EM DUAS LINHAS ──
//
// Uma célula é uma linha — menos quando o texto não cabe na largura da coluna no PDF. Aí a
// extração devolve os dois pedaços em linhas separadas, e aquele registro passa a ter UMA CÉLULA A
// MAIS que os outros. Como o agrupamento é posicional (de N em N), o resto da divisão não fecha e o
// BLOCO INTEIRO é recusado por causa de um registro. Medido em produção (61.324.247/0001-58,
// 10/08/2026): os 4 registros mensais traziam 9 células e os 2 trimestrais 10 — 56 linhas para 9
// colunas, resto 2, bloco inteiro em `naoInterpretado`.
//
// ⚠ O VALOR REMONTADO NÃO É INVENTADO — é o mesmo que o relatório imprime quando NÃO quebra.
// O texto de 46.848.383/0001-53 (24/07/2026) traz exatamente `2º TRIM/2026` numa linha só, no mesmo
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

    // Armadilha 1: "CNPJ: 52.682.158/0001-92Receita" → sobra "Receita".
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
      } else {
        anotacoes.push(limpar(resto));
      }
      continue;
    }

    // Armadilha 2: cabeçalho/rodapé de página no meio da tabela.
    if (ehRuido(l)) continue;
    saida.push(l);
  }
  return { linhas: saida, anotacoes };
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
  if (!colunas.length) return { descricao, colunas: [], registros: [], naoInterpretado: dados };

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
        const titulo = limpar(m[1]);
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
