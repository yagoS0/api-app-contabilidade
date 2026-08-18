// SUGESTÃO DE DESCRIÇÃO — as descrições que ESTE navegador já usou para emitir, e só elas.
//
// ⚠⚠ MEDIÇÃO QUE MUDA O QUE DÁ PARA FAZER AQUI. O pedido era sugerir a descrição "a partir do
// histórico do mesmo tomador/serviço (as notas que a tela já carregou)". **As notas carregadas não
// têm descrição** — e isso não é um recorte da tela, é do banco:
//   • `PortalInvoice` (o model da lista) **não tem coluna de descrição** — o texto do serviço só
//     existe dentro de `xmlRaw`, no `<xDescServ>`;
//   • `serializeInvoice` (`apps/api/src/routes/portalInvoices.js`) devolve numero, datas, status,
//     total, emitente e tomador. Descrição, nenhuma;
//   • o detalhe (`GET .../invoices/:id`) devolve `items: []` e `taxes: null` — literais, cravados;
//   • `ServiceInvoice` (a tabela da EMISSÃO) também **não tem coluna de descrição**: guarda
//     tomador, valor, alíquota, competência e o XML.
// Ou seja: o histórico do servidor não sabe o que foi descrito. Fabricar uma sugestão a partir do
// que existe (tipo, valor, tomador) seria inventar o texto de um documento fiscal.
//
// ⚠ O QUE SOBRA É HONESTO, E A TELA DIZ EXATAMENTE O QUE É: o que foi emitido **daqui, deste
// navegador**. Não é cadastro, não é o histórico da empresa, não atravessa máquinas nem usuários.
// O rótulo na tela nomeia isso — sugestão com procedência falsa é pior que nenhuma sugestão.
//
// ⚠ SUGESTÃO, NUNCA IMPOSIÇÃO: nada é escrito no campo sem um clique, nada se autosseleciona, e a
// lista some quando a pessoa já digitou algo. Mesma regra do "encontra, nunca escolhe".
//
// ⚠ ESCOPO POR EMPRESA. A chave inclui o `companyId`: descrição de uma empresa não pode ser
// oferecida na nota de outra — é o mesmo cuidado que zera o formulário ao trocar de empresa.

const PREFIXO = "pcw.descricoes";
const LIMITE_GUARDADO = 24;
const LIMITE_SUGERIDO = 3;

function chave(companyId) {
  return `${PREFIXO}.${String(companyId || "")}`;
}

function soDigitos(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

function ler(companyId) {
  try {
    const bruto = window.localStorage.getItem(chave(companyId));
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((i) => i && typeof i.descricao === "string") : [];
  } catch {
    // localStorage bloqueado (modo privado) ou JSON corrompido: sem sugestão, e nada quebra.
    return [];
  }
}

/**
 * Registra o que acabou de ser emitido. Chamada SÓ no sucesso — uma nota que foi recusada não
 * vira sugestão para a próxima.
 */
export function registrarDescricao(companyId, { descricao, tomadorDoc, tomadorNome } = {}) {
  const texto = String(descricao || "").trim();
  if (!companyId || !texto) return;
  const doc = soDigitos(tomadorDoc);
  const item = {
    descricao: texto,
    doc,
    nome: String(tomadorNome || "").trim(),
    em: new Date().toISOString(),
  };
  // Mesma descrição para o mesmo tomador não vira duas linhas: ela sobe para o topo.
  const anterior = ler(companyId).filter(
    (i) => !(i.doc === doc && String(i.descricao).trim() === texto)
  );
  try {
    window.localStorage.setItem(
      chave(companyId),
      JSON.stringify([item, ...anterior].slice(0, LIMITE_GUARDADO))
    );
  } catch {
    // Sem persistência a sugestão simplesmente não existe. Não é motivo para atrapalhar a emissão.
  }
}

/**
 * Apaga o histórico de TODAS as empresas. Chamada no "Sair".
 *
 * ⚠ Não é higiene de cache: é que este portal é usado em computador compartilhado, e a lista guarda
 * nome e CNPJ de tomadores. Sair tem de levar embora o que a sessão trouxe — o mesmo motivo pelo
 * qual `limparSessao` e `salvarEmpresa(null)` já andam juntos ali.
 */
export function esquecerTodasAsDescricoes() {
  try {
    const chaves = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${PREFIXO}.`)) chaves.push(k);
    }
    for (const k of chaves) window.localStorage.removeItem(k);
  } catch {
    // localStorage bloqueado: não havia o que apagar.
  }
}

/**
 * O que oferecer agora.
 *
 * ⚠ O MESMO TOMADOR VEM PRIMEIRO, e essa é a parte útil: quem emite todo mês para o mesmo cliente
 * repete a descrição. Sem tomador identificado ainda, oferece as últimas em geral — e o rótulo de
 * cada linha diz para quem aquela descrição foi usada, senão a sugestão vira um texto sem dono.
 *
 * @returns {{descricao, nome, doc, em, doMesmoTomador}[]}
 */
export function sugerirDescricoes(companyId, { tomadorDoc = "", jaDigitado = "" } = {}) {
  if (String(jaDigitado || "").trim()) return []; // ⚠ não interrompe quem já está escrevendo
  const doc = soDigitos(tomadorDoc);
  const todas = ler(companyId);
  const mesmas = doc ? todas.filter((i) => i.doc === doc) : [];
  const outras = todas.filter((i) => !doc || i.doc !== doc);
  return [...mesmas, ...outras]
    .slice(0, LIMITE_SUGERIDO)
    .map((i) => ({ ...i, doMesmoTomador: Boolean(doc) && i.doc === doc }));
}
