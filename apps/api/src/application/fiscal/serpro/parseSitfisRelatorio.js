// Lê o texto do relatório SITFIS e o organiza em seções — para a aba mostrar uma tabela em vez de
// só um PDF embutido.
//
// PRINCÍPIO: ORGANIZAR, NÃO INTERPRETAR.
//
// Já existiu aqui um parser que tentava extrair DÉBITOS COM VALORES. Ele mostrou "R$ 100,00" numa
// empresa que não devia nada: o número veio do `100,00%` de participação no quadro societário. Em
// contexto fiscal, um débito inventado é pior do que nenhuma tabela — e o parser foi removido.
//
// O texto real (conferido em produção) mostra por que aquilo era um erro de premissa: o relatório
// NÃO é uma tabela de valores. É um laudo por órgão:
//
//   _____ Diagnóstico Fiscal na Receita Federal _____
//   Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI) ____CNPJ: …SIMPLES NACIONAL - EM PARCELAMENTO
//   _____ Diagnóstico Fiscal na Procuradoria-Geral da Fazenda Nacional _____
//   Não foram detectadas pendências/exigibilidades suspensas …
//
// Então aqui NÃO se procura valor nenhum. Recorta-se o que o relatório afirma, na ordem em que
// afirma, e devolve-se como linhas. Se um dia aparecer valor explícito e rotulado, ele entra —
// mas nunca por dedução a partir de um número solto.

// Blocos são separados por corridas longas de "_" (o relatório usa isso como régua).
const REGUA = /_{6,}/g;

// Órgãos que emitem diagnóstico. O título vem entre réguas: "___ Diagnóstico Fiscal na X ___".
const ORGAOS = [
  { chave: "RFB", regex: /Diagn[óo]stico\s+Fiscal\s+na\s+Receita\s+Federal/i, nome: "Receita Federal" },
  { chave: "PGFN", regex: /Diagn[óo]stico\s+Fiscal\s+na\s+Procuradoria-?Geral\s+da\s+Fazenda\s+Nacional/i, nome: "Procuradoria-Geral da Fazenda Nacional" },
];

// Frase padrão de "nada consta". Reconhecê-la é o que permite dizer "sem pendências" com segurança,
// em vez de deixar a linha vazia e o contador sem saber se é ausência ou falha de leitura.
const SEM_PENDENCIA = /N[ãa]o\s+foram\s+detectadas\s+pend[êe]ncias/i;

function limpar(txt) {
  return String(txt || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Quebra em linhas úteis: o texto extraído do PDF cola rótulo e valor, e usa \n de forma irregular.
function linhasUteis(bloco) {
  return String(bloco || "")
    .split(/\r?\n/)
    .map(limpar)
    .filter(Boolean)
    // Ruído de paginação e rodapé não é conteúdo do laudo.
    .filter((l) => !/^P[áa]gina:?\s*\d*/i.test(l))
    .filter((l) => !/^\d+\s*\/?\s*\d*$/.test(l))
    .filter((l) => !/^Final do Relat[óo]rio$/i.test(l));
}

/**
 * @param {string} texto  texto extraído do PDF do relatório SITFIS
 * @returns {{
 *   emitidoEm: string|null,
 *   contribuinte: { cnpj: string|null, nome: string|null },
 *   diagnosticos: Array<{ orgao: string, chave: string, semPendencia: boolean,
 *                         itens: Array<{ titulo: string|null, descricao: string }> }>,
 *   naoInterpretado: string[],
 *   temTexto: boolean,
 * }}
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

  // Data/hora de emissão do relatório (aparece no cabeçalho, antes do título).
  const mData = t.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (mData) out.emitidoEm = `${mData[1]} ${mData[2]}`;

  // "48.684.291 - ERISANGELA LACERDA PEREIRA" logo após "CNPJ:" no cabeçalho.
  const mContrib = t.match(/CNPJ:\s*\n?\s*([\d.\-/]{10,})\s*-\s*([^\n]+)/);
  if (mContrib) {
    out.contribuinte.cnpj = limpar(mContrib[1]);
    out.contribuinte.nome = limpar(mContrib[2]);
  }

  // Cada órgão abre um trecho que vai do seu título até o título do próximo órgão (ou o fim).
  const marcos = [];
  for (const org of ORGAOS) {
    const m = t.match(org.regex);
    if (m && m.index != null) marcos.push({ ...org, inicio: m.index, fim: m.index + m[0].length });
  }
  marcos.sort((a, b) => a.inicio - b.inicio);

  for (let i = 0; i < marcos.length; i += 1) {
    const atual = marcos[i];
    const proximo = marcos[i + 1];
    const trecho = t.slice(atual.fim, proximo ? proximo.inicio : t.length);

    const semPendencia = SEM_PENDENCIA.test(trecho);
    const itens = [];

    if (!semPendencia) {
      // Dentro do trecho, as réguas separam "assunto" do "conteúdo": o assunto é o texto que vem
      // ANTES da régua ("Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)") e o conteúdo o
      // que vem depois ("CNPJ: … / SIMPLES NACIONAL - EM PARCELAMENTO").
      const partes = trecho.split(REGUA).map(limpar).filter(Boolean);
      let tituloPendente = null;
      for (const parte of partes) {
        const linhas = linhasUteis(parte);
        if (!linhas.length) continue;
        // Parte curta e sem CNPJ tende a ser o rótulo do assunto seguinte.
        const ehTitulo = linhas.length === 1 && linhas[0].length < 90 && !/CNPJ/i.test(linhas[0]);
        if (ehTitulo) { tituloPendente = linhas[0]; continue; }
        for (const linha of linhas) {
          // O CNPJ vem COLADO no conteúdo — o texto extraído não põe quebra:
          //   "CNPJ: 48.684.291/0001-00SIMPLES NACIONAL - EM PARCELAMENTO"
          // Descartar a linha inteira por começar com "CNPJ:" fazia sumir justamente a pendência.
          // Remove só o prefixo de identificação e mantém o resto.
          const semCnpj = limpar(linha.replace(/^CNPJ:\s*[\d.\-/]+/i, ""));
          if (!semCnpj) continue; // era só o CNPJ, sem conteúdo
          itens.push({ titulo: tituloPendente, descricao: semCnpj });
        }
        tituloPendente = null;
      }
    }

    out.diagnosticos.push({ orgao: atual.nome, chave: atual.chave, semPendencia, itens });
  }

  // Órgão esperado que não apareceu no texto → registra, para a tela poder dizer que o relatório
  // veio incompleto em vez de fingir que está tudo certo.
  for (const org of ORGAOS) {
    if (!out.diagnosticos.some((d) => d.chave === org.chave)) {
      out.naoInterpretado.push(`Seção não encontrada no relatório: ${org.nome}`);
    }
  }

  return out;
}
