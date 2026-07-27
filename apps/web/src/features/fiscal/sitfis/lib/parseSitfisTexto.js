// Lê o relatório SITFIS ("Informações de Apoio para Emissão de Certidão") a partir do texto
// extraído do PDF. Calibrado com relatórios REAIS (empresa limpa, com débitos e com dívida ativa).
//
// COMO O TEXTO SAI DO PDF (isto derrubou a 1ª versão deste parser):
//   • O PDF é uma TABELA. Cada CÉLULA vira uma LINHA do texto — inclusive os títulos de coluna.
//     Um registro de débito são 9 linhas seguidas, na ordem das colunas.
//   • Campo rotulado sai como "Rótulo:" numa linha e o VALOR na linha seguinte.
//   • Quebra de página injeta o cabeçalho inteiro do documento NO MEIO de uma tabela.
//   • Nem todo número é dinheiro: o bloco de sócios traz "100,00%" (capital social). Uma
//     varredura genérica por "\d+,\d{2}" lê isso como R$ 100,00 — foi o débito fantasma da v1.
//     Por isso NÃO varremos números soltos: só lemos posição de coluna dentro de uma tabela.

// ── Ruído estrutural: cabeçalho repetido a cada página e rodapé de paginação ──────────────────
const RUIDO = [
  /^MINIST[ÉE]RIO DA ECONOMIA$/i,
  /^Por meio do Integra Contador$/i,
  /^SECRETARIA ESPECIAL DA RECEITA FEDERAL/i,
  /^Autor pedido:/i,
  /^PROCURADORIA-GERAL DA FAZENDA NACIONAL$/i,
  /^INFORMA[ÇC][ÕO]ES DE APOIO PARA EMISS[ÃA]O DE CERTID[ÃA]O$/i,
  /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/,
  /^P[áa]gina:/i,
  /^Final do Relat[óo]rio$/i,
];

/** Remove o cabeçalho/rodapé de página, que aparece no meio das tabelas. */
function limparRuido(linhas) {
  const out = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i];
    if (!l) continue;
    if (RUIDO.some((re) => re.test(l))) {
      // "Página: 1 /" vem seguido do número total numa linha sozinha.
      if (/^P[áa]gina:/i.test(l) && /^\d+$/.test(linhas[i + 1] || "")) i += 1;
      continue;
    }
    // Bloco "CNPJ:" + "52.682.158 - RAZÃO" do cabeçalho de página.
    if (/^CNPJ:$/i.test(l) && /^\d{2}\.\d{3}\.\d{3}\s*-\s*\S/.test(linhas[i + 1] || "")) { i += 1; continue; }
    out.push(l);
  }
  return out;
}

// ── Tabelas conhecidas: título da seção + colunas na ordem em que saem do PDF ─────────────────
// `colunas` é o CONTRATO: o número de colunas define quantas linhas formam um registro.
const TABELAS = [
  {
    id: "debito",
    re: /Pend[êe]ncia\s*-\s*D[ée]bito\s*\(SIEF\)/i,
    titulo: "Débito (SIEF)",
    nivel: "pendencia",
    colunas: ["receita", "periodo", "vencimento", "valorOriginal", "saldoDevedor", "multa", "juros", "saldoConsolidado", "situacao"],
    campoValor: "saldoConsolidado",
  },
  {
    id: "debitoSuspenso",
    re: /D[ée]bito\s+com\s+Exigibilidade\s+Suspensa\s*\(SIEF\)/i,
    titulo: "Débito com exigibilidade suspensa",
    nivel: "suspenso",
    colunas: ["receita", "periodo", "vencimento", "valorOriginal", "saldoDevedor", "situacao"],
    campoValor: "saldoDevedor",
  },
  {
    id: "processo",
    re: /Pend[êe]ncia\s*-\s*Processo\s+Fiscal\s*\(SIEF\)/i,
    titulo: "Processo fiscal",
    nivel: "pendencia",
    colunas: ["processo", "situacao", "localizacao"],
    campoValor: null,
  },
  {
    id: "sida",
    re: /Pend[êe]ncia\s*-\s*Inscri[çc][ãa]o\s*\(SIDA\)/i,
    titulo: "Inscrição em dívida ativa (PGFN)",
    nivel: "pendencia",
    colunas: ["inscricao", "receita", "inscritoEm", "ajuizadoEm", "processo", "tipoDevedor"],
    campoValor: null,
  },
];

const RE_PARCELAMENTO = /Pend[êe]ncia\s*-\s*Parcelamento/i;
const RE_MOEDA = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;

function parseValorBR(txt) {
  if (!RE_MOEDA.test(String(txt || "").trim())) return null;
  const n = Number(String(txt).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Um título de seção encerra a tabela anterior. */
function ehInicioDeSecao(linha) {
  return TABELAS.some((t) => t.re.test(linha))
    || RE_PARCELAMENTO.test(linha)
    || /Diagn[óo]stico\s+Fiscal/i.test(linha)
    || /Certid[ãa]o\s+Emitida/i.test(linha)
    || /S[óo]cios\s+e\s+Administradores/i.test(linha)
    || /Dados\s+Cadastrais/i.test(linha);
}

// Nas tabelas o título vem colado ao separador e ao CNPJ, e a 1ª coluna pode vir grudada:
// "Pendência - Débito (SIEF) ____CNPJ: 52.682.158/0001-92Receita"
// Devolve o que sobra depois do CNPJ (aqui, "Receita") pra não perder o 1º cabeçalho.
function restoAposCnpj(linha) {
  const m = linha.match(/CNPJ:\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(.*)$/);
  return m ? m[1].trim() : "";
}

// Alguns registros vêm precedidos de anotação com a receita GRUDADA no fim:
// "Notificação de lançamento: 526821582026010011099-01 - CP-SEGUR."
// Extrai a receita ("1099-01 - CP-SEGUR.") pra não perder o registro nem contaminar o número.
function receitaColada(linha) {
  const m = linha.match(/(\d{4}-\d{2}\s*-\s*.+)$/);
  return m ? m[1].trim() : null;
}

/**
 * @returns {{
 *   situacaoCadastral, certidaoTipo, certidaoCodigo, certidaoEmissao, certidaoValidade,
 *   diagnosticoRfb, diagnosticoPgfn, parcelasEmAtraso,
 *   tabelas: { id, titulo, nivel, colunas, registros }[],
 *   totalDevido: number,
 * }}
 */
export function parseSitfisTexto(texto) {
  const linhas = limparRuido(String(texto || "").split(/\r?\n/).map((l) => l.trim()));
  const out = {
    situacaoCadastral: null,
    certidaoTipo: null, certidaoCodigo: null, certidaoEmissao: null, certidaoValidade: null,
    diagnosticoRfb: null, diagnosticoPgfn: null,
    parcelasEmAtraso: null,
    tabelas: [],
    totalDevido: 0,
  };

  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i];

    // ── Campos rotulados ────────────────────────────────────────────────────────────────────
    if (out.situacaoCadastral === null && /^Situa[çc][ãa]o:$/i.test(l)) {
      out.situacaoCadastral = (linhas[i + 1] || "").trim() || null;
      continue;
    }
    if (out.certidaoTipo === null) {
      const mCert = l.match(/Certid[ãa]o\s+(Negativa|Positiva(?:\s+com\s+Efeitos\s+de\s+Negativa)?)\s*:\s*([A-Z0-9][A-Z0-9.\-]{6,})/i);
      if (mCert) { out.certidaoTipo = `Certidão ${mCert[1].trim()}`; out.certidaoCodigo = mCert[2].trim(); continue; }
    }
    if (out.certidaoEmissao === null && /^Emiss[ãa]o:$/i.test(l)) {
      const v = (linhas[i + 1] || "").match(/\d{2}\/\d{2}\/\d{4}/);
      if (v) { out.certidaoEmissao = v[0]; continue; }
    }
    if (out.certidaoValidade === null && /^Data\s+de\s+Validade:$/i.test(l)) {
      const v = (linhas[i + 1] || "").match(/\d{2}\/\d{2}\/\d{4}/);
      if (v) { out.certidaoValidade = v[0]; continue; }
    }

    // ── Parcelamento: "Parcelas em atraso" e o número logo abaixo ───────────────────────────
    if (RE_PARCELAMENTO.test(l)) {
      for (let j = i + 1; j < Math.min(i + 8, linhas.length); j += 1) {
        if (/^Parcelas\s+em\s+atraso$/i.test(linhas[j])) {
          const n = (linhas[j + 1] || "").match(/^\d+$/);
          if (n) out.parcelasEmAtraso = Number(n[0]);
          break;
        }
        if (ehInicioDeSecao(linhas[j]) && !RE_PARCELAMENTO.test(linhas[j])) break;
      }
      continue;
    }

    // ── Diagnóstico (a frase vem colada ao separador na mesma linha) ────────────────────────
    // Só quando NÃO há tabela na mesma linha: no PGFN o texto extraído junta o cabeçalho do
    // diagnóstico com o início da tabela ("... Fazenda Nacional ___Pendência - Inscrição (SIDA)
    // ___CNPJ: ...Inscrição"). Tratar como diagnóstico e seguir faria a tabela ser perdida.
    if (/Diagn[óo]stico\s+Fiscal/i.test(l) && !TABELAS.some((t) => t.re.test(l))) {
      const pgfn = /Procuradoria/i.test(l);
      const frase = l.split(/_{3,}/).map((p) => p.trim()).filter(Boolean).pop();
      const texto2 = frase && !/Diagn[óo]stico\s+Fiscal/i.test(frase) ? frase : (linhas[i + 1] || "");
      // Se o que vem depois é outra seção (ex.: começa a tabela de débitos), não há frase.
      if (texto2 && !ehInicioDeSecao(texto2)) {
        if (pgfn) out.diagnosticoPgfn = texto2;
        else out.diagnosticoRfb = texto2;
      }
      continue;
    }

    // ── Tabelas ─────────────────────────────────────────────────────────────────────────────
    const def = TABELAS.find((t) => t.re.test(l));
    if (!def) continue;

    // Cabeçalhos: começam no que sobrou depois do CNPJ na própria linha do título.
    const cabecalhos = [];
    const primeiro = restoAposCnpj(l);
    if (primeiro) cabecalhos.push(primeiro);
    let j = i + 1;
    while (j < linhas.length && cabecalhos.length < def.colunas.length) {
      if (ehInicioDeSecao(linhas[j])) break;
      cabecalhos.push(linhas[j]);
      j += 1;
    }
    if (cabecalhos.length < def.colunas.length) { i = j - 1; continue; }

    // Registros: grupos de N linhas até a próxima seção.
    const registros = [];
    let buffer = [];
    while (j < linhas.length) {
      const atual = linhas[j];
      if (ehInicioDeSecao(atual)) break;

      // Anotação com a receita colada no fim: só a receita interessa, e ela ABRE um registro.
      if (buffer.length === 0 && /Notifica[çc][ãa]o\s+de\s+lan[çc]amento/i.test(atual)) {
        const r = receitaColada(atual);
        if (r) buffer.push(r);
        j += 1;
        continue;
      }

      buffer.push(atual);
      if (buffer.length === def.colunas.length) {
        const reg = {};
        def.colunas.forEach((c, idx) => { reg[c] = buffer[idx]; });
        // Converte os campos monetários — só onde a coluna É monetária.
        for (const campo of ["valorOriginal", "saldoDevedor", "multa", "juros", "saldoConsolidado"]) {
          if (reg[campo] != null) reg[campo] = parseValorBR(reg[campo]);
        }
        registros.push(reg);
        buffer = [];
      }
      j += 1;
    }

    if (registros.length) {
      out.tabelas.push({ id: def.id, titulo: def.titulo, nivel: def.nivel, colunas: def.colunas, registros });
      // Só débito EM ABERTO entra no total devido (suspenso e processo não são exigíveis agora).
      if (def.id === "debito" && def.campoValor) {
        for (const r of registros) {
          const v = r[def.campoValor];
          if (Number.isFinite(v)) out.totalDevido += v;
        }
      }
    }
    i = j - 1;
  }

  out.totalDevido = Math.round(out.totalDevido * 100) / 100;
  return out;
}

export function temResumo(r) {
  return Boolean(r && (r.diagnosticoRfb || r.diagnosticoPgfn || r.certidaoValidade
    || r.situacaoCadastral || (r.tabelas && r.tabelas.length)));
}
