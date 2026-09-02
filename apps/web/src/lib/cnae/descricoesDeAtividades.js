// A DESCRIÇÃO DO CNAE QUE JÁ ESTÁ GRAVADA — leitura, nunca invenção.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O DEFEITO (relatado pelo dono, 30/08/2026: *"o CNAE só é salvo com número, sem descrição"*)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// A consulta ao CNPJ devolve `cnae_fiscal_descricao` e `cnaes_secundarios[].descricao`. O
// formulário lia as duas, jogava num `useState` e **nunca as enviava** — a descrição vivia só
// enquanto a tela estava aberta.
//
// ⚠⚠ E na EDIÇÃO ela nunca aparecia: `handleCnpjBlur` não roda com `cnpjReadOnly`, então o mapa
// nascia VAZIO e a legenda mostrava só o número — inclusive nas **12 de 34 empresas** que TÊM o
// texto gravado em `Company.atividades` (medido em produção).
//
// Esta lib lê o que já está no banco. A gravação do que a consulta traz é outra metade, no
// `realApi`/rota.
//
// ⚠⚠ **CÓDIGO NU NÃO VIRA TEXTO.** Não existe tabela CNAE→descrição neste repositório que cubra a
// carteira: `CnaeAnexo` tem ~10% da CNAE 2.3, e completar a partir dela poria no cadastro uma
// descrição que ninguém conferiu — que sai IMPRESSA como `xDescServ` na nota do cliente. A mesma
// disciplina que `features/notas/lib/descricaoSugerida.js` já declara.

/**
 * O código de 7 dígitos de uma linha de atividade.
 *
 * ⚠ Os 7 PRIMEIROS dígitos são sempre o código, mesmo quando a descrição traz números depois
 * ("46.19-2-00 - Representantes… de mercadorias em geral"). É a mesma leitura que
 * `normalizarCnae` faz no backend (`apuracao/v2/CnaesDaEmpresaService.js`) — e ela precisa
 * continuar batendo: divergindo, este mapa deixa de achar texto que existe, e a legenda volta a
 * mostrar número nu sem ninguém entender por quê.
 */
export function normalizarCnae(valor) {
  const digitos = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  return digitos.length === 7 ? digitos : null;
}

/** A linha tem texto depois do código? (`"4619200"` não; `"46.19-2-00 - Representantes"` sim) */
export function temDescricao(linha) {
  return /\p{L}/u.test(String(linha || "").replace(/^[\d.\-/\s]+/u, ""));
}

/**
 * O texto, sem o código na frente. `"46.19-2-00 - Representantes…"` → `"Representantes…"`.
 *
 * ⚠ Devolve `null` — nunca `""` — quando não há texto. String vazia entraria no `Map` e a legenda
 * renderizaria um traço vazio ao lado do número, que se lê como "descrição em branco" em vez de
 * "sem descrição".
 */
export function descricaoDaLinha(linha) {
  if (!temDescricao(linha)) return null;
  const texto = String(linha).replace(/^[\d.\-/\s]+/u, "").replace(/^[-–—\s]+/u, "").trim();
  return texto || null;
}

/**
 * `Map(7 dígitos → descrição)` a partir do que está gravado em `Company.atividades`.
 *
 * @param {string[]} atividades  as linhas gravadas, nas duas formas de produção
 */
export function descricoesGravadas(atividades) {
  const mapa = new Map();
  for (const linha of Array.isArray(atividades) ? atividades : []) {
    const chave = normalizarCnae(linha);
    if (!chave || mapa.has(chave)) continue;
    const texto = descricaoDaLinha(linha);
    // ⚠ Só entra quem TEM texto. Uma chave com valor nulo faria a legenda achar que consultou e
    //   não achou, quando o certo é "esta linha nunca teve descrição".
    if (texto) mapa.set(chave, texto);
  }
  return mapa;
}

/**
 * Funde o que está gravado com o que a consulta ao CNPJ trouxe.
 *
 * ⚠ A CONSULTA VENCE: ela é a fonte oficial e é mais nova que o que estava no banco. O gravado é
 * o piso — ele existe para a legenda não ficar muda na EDIÇÃO, onde a consulta não roda.
 */
export function fundirDescricoes(gravadas, daConsulta) {
  const saida = new Map(gravadas instanceof Map ? gravadas : []);
  for (const [k, v] of daConsulta instanceof Map ? daConsulta : []) {
    if (v) saida.set(k, v);
  }
  return saida;
}
