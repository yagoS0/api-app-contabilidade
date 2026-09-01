// `Company.atividades` — PRESERVAR a descrição que já está gravada ao salvar o cadastro.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O DEFEITO, MEDIDO EM PRODUÇÃO (30/08/2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `routes/firm/index.js` e `CompanyProvisioningService` gravavam
// `atividades: [cnaePrincipal, ...cnaesSecundarios]` — **códigos nus**. Como `cnaesSecundarios`
// só guarda dígitos (`realApi.js` faz `.replace(/\D+/g,"")` no caminho), **todo "Salvar
// alterações" apagava o texto** das linhas que tinham descrição.
//
// Medido: **12 de 34 empresas** têm ao menos uma linha descrita — 12 linhas com texto contra 65
// nuas. Exemplos reais: `"46.19-2-00 - Representantes comerciais e agentes do comércio de
// mercadorias em geral não especializado"`, `"70.20-4-00 - Atividades de consultoria em gestão
// empresarial…"`.
//
// ⚠⚠ E o dado apagado aqui REAPARECE COMO NOTA FISCAL SEM DESCRIÇÃO. `Company.atividades` é a
// ÚNICA fonte de texto de atividade da carteira, e `features/notas/lib/descricaoSugerida.js` é o
// único consumidor — o texto que ele devolve vira o **`xDescServ` da DPS**, que o tomador lê.
// Perder aqui é perder na nota do cliente do cliente, dias depois, sem ninguém ligar as pontas.
//
// ⚠ A REGRA É PURA e mora sozinha: nada de Prisma, nada de rede. Quem lê o banco é a rota.

// ⚠⚠ REUSA `normalizarCnae` DE `apuracao/v2/CnaesDaEmpresaService.js`, NÃO reescreve.
// Aquele módulo já trata os DOIS formatos gravados em produção (dígitos crus e
// `"82.19-9-99 - Preparação de documentos…"`) e o comentário dele documenta os dois. Um segundo
// normalizador divergiria na primeira correção e esta função passaria a "não achar" texto que
// existe — apagando exatamente o que ela foi escrita para preservar.
import { normalizarCnae } from "../notas/apuracao/v2/CnaesDaEmpresaService.js";

/**
 * Junta os códigos que o cadastro está salvando com as linhas que JÁ existem, preservando a
 * descrição de cada código que continua na lista.
 *
 * @param {string[]} atividadesAtuais  o que está gravado em `Company.atividades` hoje
 * @param {string[]} codigos           `[cnaePrincipal, ...cnaesSecundarios]` do payload normalizado
 * @param {{descritas?: string[]}} opcoes  linhas `"código - descrição"` que a CONSULTA ao CNPJ
 *   acabou de trazer. ⚠ ELAS VENCEM o que está gravado: são a fonte oficial e são mais novas.
 *   Ausentes, o comportamento é exatamente o de antes.
 * @returns {string[]} uma linha por código, na ordem dos `codigos`
 */
export function mesclarAtividades(atividadesAtuais, codigos, opcoes = {}) {
  const atuais = Array.isArray(atividadesAtuais) ? atividadesAtuais : [];
  const entram = Array.isArray(codigos) ? codigos : [];

  // ⚠ O índice é por CÓDIGO NORMALIZADO (7 dígitos), não pela string inteira: é justamente porque
  //   as duas formas não são iguais como texto que o casamento precisa existir.
  const descritaPorCodigo = new Map();
  for (const linha of atuais) {
    const chave = normalizarCnae(linha);
    if (!chave) continue;
    // ⚠ Só entra no índice a linha que TEM texto. Linha nua indexada sobrescreveria a descrita
    //   quando o mesmo código aparecesse duas vezes, e a preservação viraria loteria de ordem.
    if (!temDescricao(linha)) continue;
    if (!descritaPorCodigo.has(chave)) descritaPorCodigo.set(chave, String(linha));
  }

  // ⚠ A CONSULTA POR CIMA DO GRAVADO. Ela roda só na criação e quando o CNPJ é digitado; quando
  //   roda, o texto dela é o oficial do dia. Sem esta camada, uma empresa cujo CNAE mudou de nome
  //   na Receita ficaria com a descrição antiga para sempre.
  for (const linha of Array.isArray(opcoes?.descritas) ? opcoes.descritas : []) {
    const chave = normalizarCnae(linha);
    if (!chave || !temDescricao(linha)) continue;
    descritaPorCodigo.set(chave, String(linha));
  }

  const saida = [];
  const jaPostos = new Set();
  for (const codigo of entram) {
    const cru = String(codigo || "").trim();
    if (!cru) continue;
    const chave = normalizarCnae(cru);
    // ⚠ Código que não normaliza (menos de 7 dígitos) entra CRU, do jeito que veio. Descartá-lo
    //   apagaria do cadastro um valor que o contador digitou — e a forma é conferida pelo
    //   validador, não aqui.
    const linha = chave && descritaPorCodigo.has(chave) ? descritaPorCodigo.get(chave) : cru;
    const identidade = chave || cru;
    if (jaPostos.has(identidade)) continue;
    jaPostos.add(identidade);
    saida.push(linha);
  }
  return saida;
}

/**
 * A linha tem descrição, ou é só o código?
 *
 * ⚠ O critério é LETRA depois do código, e é o mesmo que `descricaoSugerida.js` já aplica:
 * `"4619200"` e `"46.19-2-00"` são código; `"46.19-2-00 - Representantes…"` é código + texto.
 * ⚠⚠ **CÓDIGO NU NÃO VIRA TEXTO** — não existe tabela CNAE→descrição neste repositório que
 * cubra a carteira (`CnaeAnexo` tem ~10% da CNAE 2.3), e completar a partir dela poria no
 * cadastro uma descrição que ninguém conferiu.
 */
export function temDescricao(linha) {
  return /\p{L}/u.test(String(linha || "").replace(/^[\d.\-/\s]+/u, ""));
}
