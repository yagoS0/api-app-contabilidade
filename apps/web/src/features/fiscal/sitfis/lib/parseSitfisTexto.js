// Extrai os campos ROTULADOS do relatório SITFIS ("Informações de Apoio para Emissão de Certidão").
//
// Calibrado com o texto REAL extraído do PDF (pdf-parse). Duas características do formato que
// derrubaram a primeira tentativa de parse:
//
//   1. O PDF é uma TABELA: o texto sai como "Rótulo:" numa linha e o VALOR na linha seguinte.
//      Ex.:  "Situação: \nATIVA"   ·   "Data de Validade: \n19/07/2026"
//   2. Há números que NÃO são valores fiscais. O bloco de sócios traz "100,00%" (capital social),
//      que uma varredura genérica por "\d+,\d{2}" lê como R$ 100,00 — foi exatamente o débito
//      fantasma que apareceu na tela.
//
// Por isso aqui só lemos campos com RÓTULO EXPLÍCITO. Nada de varrer números soltos.
// ⚠ Débitos/pendências NÃO são tabelados: o bloco de pendências ainda não foi visto num relatório
// real, e inventar estrutura em cima disso é o que gerou dado falso antes.

/** Valor que vem na MESMA linha do rótulo ("Emissão: 20/01/2026") ou na linha seguinte. */
function valorDoRotulo(linhas, i, rotuloRe) {
  const linha = linhas[i];
  const resto = linha.replace(rotuloRe, "").trim();
  if (resto) return resto;
  // Rótulo sozinho → o valor caiu na próxima linha não-vazia.
  for (let j = i + 1; j < Math.min(i + 3, linhas.length); j += 1) {
    if (linhas[j]) return linhas[j].trim();
  }
  return null;
}

const RE_DATA = /\b\d{2}\/\d{2}\/\d{4}\b/;

/**
 * @returns {{
 *   situacaoCadastral: string|null,
 *   certidaoTipo: string|null, certidaoCodigo: string|null,
 *   certidaoEmissao: string|null, certidaoValidade: string|null,
 *   diagnostico: string|null, semPendencias: boolean|null,
 * }}
 */
export function parseSitfisTexto(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map((l) => l.trim());
  const out = {
    situacaoCadastral: null,
    certidaoTipo: null, certidaoCodigo: null,
    certidaoEmissao: null, certidaoValidade: null,
    diagnostico: null, semPendencias: null,
  };

  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i];
    if (!l) continue;

    // "Situação:" aparece nos Dados Cadastrais (ATIVA/BAIXADA/...). O bloco de sócios também tem
    // "Situação Cadastral" — por isso exigimos o rótulo exato "Situação:".
    if (out.situacaoCadastral === null && /^situa[çc][ãa]o:\s*$/i.test(l.replace(/\s+$/, "")) ) {
      out.situacaoCadastral = valorDoRotulo(linhas, i, /^situa[çc][ãa]o:/i);
      continue;
    }

    // "Certidão Positiva com Efeitos de Negativa:  5B06.5FE3.C228.EAF1"
    // NÃO ancorar em ^: no texto extraído essa parte vem colada ao separador e ao CNPJ, tipo
    // "Certidão Emitida ____CNPJ: 24.352.609/0001-98Certidão Positiva com Efeitos de Negativa: ..."
    if (out.certidaoTipo === null) {
      const mCert = l.match(/Certid[ãa]o\s+(Negativa|Positiva(?:\s+com\s+Efeitos\s+de\s+Negativa)?)\s*:\s*([A-Z0-9][A-Z0-9.\-]{6,})/i);
      if (mCert) {
        out.certidaoTipo = `Certidão ${mCert[1].trim()}`;
        out.certidaoCodigo = mCert[2].trim();
        continue;
      }
    }

    if (out.certidaoEmissao === null && /^emiss[ãa]o:/i.test(l)) {
      const v = valorDoRotulo(linhas, i, /^emiss[ãa]o:/i);
      if (v && RE_DATA.test(v)) out.certidaoEmissao = v.match(RE_DATA)[0];
      continue;
    }
    if (out.certidaoValidade === null && /^data\s+de\s+validade:/i.test(l)) {
      const v = valorDoRotulo(linhas, i, /^data\s+de\s+validade:/i);
      if (v && RE_DATA.test(v)) out.certidaoValidade = v.match(RE_DATA)[0];
      continue;
    }

    // O diagnóstico vem logo após o cabeçalho "___ Diagnóstico Fiscal ... ___", às vezes colado
    // na MESMA linha (o texto extraído junta o separador com a frase).
    if (/Diagn[óo]stico\s+Fiscal/i.test(l)) {
      const depoisDoCabecalho = l.split(/_{3,}/).map((p) => p.trim()).filter(Boolean).pop();
      let frase = depoisDoCabecalho && !/Diagn[óo]stico\s+Fiscal/i.test(depoisDoCabecalho)
        ? depoisDoCabecalho
        : null;
      if (!frase) {
        for (let j = i + 1; j < Math.min(i + 4, linhas.length); j += 1) {
          if (linhas[j] && !/^_+$/.test(linhas[j])) { frase = linhas[j]; break; }
        }
      }
      if (frase) {
        out.diagnostico = frase.replace(/_{3,}/g, "").trim();
        out.semPendencias = /n[ãa]o\s+foram\s+detectad|nada\s+consta|n[ãa]o\s+h[áa]\s+pend/i.test(out.diagnostico);
      }
    }
  }

  return out;
}

/** true quando há ao menos um campo reconhecido (senão a tela mostra só o texto). */
export function temResumo(resumo) {
  return Boolean(resumo && (resumo.diagnostico || resumo.certidaoValidade || resumo.situacaoCadastral));
}
