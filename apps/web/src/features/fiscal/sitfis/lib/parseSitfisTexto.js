// Lê o texto do relatório SITFIS e extrai as pendências em formato de tabela.
//
// ⚠ O parse é BEST-EFFORT e propositalmente conservador: só reconhece o que dá pra afirmar com
// segurança a partir do texto. O que não for reconhecido NÃO é descartado — a tela sempre oferece
// o relatório completo. Nunca inventamos valor, período ou situação que não estejam escritos.
//
// Calibrado com dois relatórios reais:
//   • débito: seção "Pendência - Débito (SIEF)" com linhas "1099-01 CP-SEGUR. ... PA 02/2026 ...
//     615,18 ... DEVEDOR"
//   • parcelamento: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)" +
//     "SIMPLES NACIONAL - EM PARCELAMENTO"

// Cabeçalhos de seção conhecidos → rótulo amigável e gravidade.
const SECOES = [
  { re: /pend[êe]ncia\s*[-–]\s*d[ée]bito\s*\(?sief\)?/i, titulo: "Débito (SIEF)", nivel: "pendencia" },
  { re: /pend[êe]ncia\s*[-–]\s*(?:parcelamento|parcela)/i, titulo: "Pendência de parcelamento", nivel: "pendencia" },
  { re: /parcelamento\s+com\s+exigibilidade\s+suspensa/i, titulo: "Parcelamento (exigibilidade suspensa)", nivel: "parcelamento" },
  { re: /pend[êe]ncia\s*[-–]\s*omiss[ãa]o/i, titulo: "Omissão de declaração", nivel: "pendencia" },
  { re: /d[íi]vida\s+ativa/i, titulo: "Dívida ativa (PGFN)", nivel: "pendencia" },
  { re: /inscri[çc][ãa]o\s+em\s+d[íi]vida/i, titulo: "Inscrição em dívida ativa", nivel: "pendencia" },
];

// "1.234,56" ou "615,18" → 1234.56 / 615.18
function parseValorBR(txt) {
  if (!txt) return null;
  const n = Number(String(txt).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const RE_VALOR = /\b\d{1,3}(?:\.\d{3})*,\d{2}\b/;
const RE_PA = /\bPA\s*(\d{2}\/\d{4})\b/i;              // período de apuração
const RE_COMPETENCIA = /\b(\d{2}\/\d{4})\b/;            // fallback: qualquer MM/AAAA na linha
const RE_SITUACAO = /\b(DEVEDOR|EM\s+PARCELAMENTO|SUSPENS[OA]|EXIG[ÍI]VEL|EM\s+COBRAN[ÇC]A|NEGOCIAD[OA])\b/i;
// Código de receita no formato "1099-01" / "0561-01"
const RE_CODIGO = /\b(\d{4}-\d{2})\b/;

/**
 * @returns {{ orgao: string|null, secao: string, nivel: string, codigo: string|null,
 *             descricao: string, periodo: string|null, valor: number|null,
 *             situacao: string|null, linha: string }[]}
 */
export function parseSitfisTexto(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const itens = [];
  let secaoAtual = null;
  let orgaoAtual = null;

  for (const linha of linhas) {
    // Órgão (contexto): o relatório separa Receita Federal de PGFN.
    if (/receita\s+federal/i.test(linha) && /diagn[óo]stico/i.test(linha)) { orgaoAtual = "Receita Federal"; continue; }
    if (/procuradoria[-\s]geral\s+da\s+fazenda/i.test(linha)) { orgaoAtual = "PGFN"; continue; }

    const secao = SECOES.find((s) => s.re.test(linha));
    if (secao) { secaoAtual = secao; continue; }

    // Linha de dado: precisa ter valor OU situação reconhecível pra virar item.
    const mValor = linha.match(RE_VALOR);
    const mSituacao = linha.match(RE_SITUACAO);
    if (!mValor && !mSituacao) continue;
    // Ignora linhas de totalização (não são pendências individuais).
    if (/^total/i.test(linha)) continue;

    const mPa = linha.match(RE_PA) || linha.match(RE_COMPETENCIA);
    const mCodigo = linha.match(RE_CODIGO);
    // Descrição = a linha sem os pedaços já extraídos, para não repetir informação.
    const descricao = linha
      .replace(RE_VALOR, "").replace(RE_PA, "").replace(RE_SITUACAO, "").replace(RE_CODIGO, "")
      .replace(/\s{2,}/g, " ").replace(/^[\s.,;-]+|[\s.,;-]+$/g, "");

    itens.push({
      orgao: orgaoAtual,
      secao: secaoAtual?.titulo || "Outros",
      nivel: secaoAtual?.nivel || "info",
      codigo: mCodigo ? mCodigo[1] : null,
      descricao: descricao || linha,
      periodo: mPa ? mPa[1] : null,
      valor: mValor ? parseValorBR(mValor[0]) : null,
      situacao: mSituacao ? mSituacao[0].toUpperCase().replace(/\s+/g, " ") : null,
      linha,
    });
  }

  return itens;
}

/** Soma dos valores reconhecidos — só das linhas classificadas como pendência. */
export function totalPendencias(itens) {
  return (itens || [])
    .filter((i) => i.nivel === "pendencia" && Number.isFinite(i.valor))
    .reduce((s, i) => s + i.valor, 0);
}
