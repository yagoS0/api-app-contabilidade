// Preferência local de inserção, não recibo de envio. Nunca armazena textos ou destinatários.
const PREFIXO = "altan:mensagens-rapidas:uso:v1:";
const identificador = v => typeof v === "string" && /^[a-zA-Z0-9:_-]{1,150}$/.test(v);
export function lerUsosMensagens(usuarioId, storage) {
  if (!identificador(usuarioId)) return {};
  try {
    const dados = JSON.parse((storage || globalThis.localStorage).getItem(PREFIXO + usuarioId) || "{}");
    if (!dados || Array.isArray(dados) || typeof dados !== "object") return {};
    return Object.fromEntries(Object.entries(dados).filter(([id, n]) => identificador(id) && Number.isSafeInteger(n) && n > 0).slice(0, 300));
  } catch { return {}; }
}
export function registrarUsoMensagem(usuarioId, id, anteriores = {}, storage) {
  if (!identificador(id)) return anteriores;
  const persistidos = identificador(usuarioId) ? lerUsosMensagens(usuarioId, storage) : {};
  const usos = { ...persistidos };
  // Outra aba pode ter incrementado; uma quota de storage pode ter impedido a
  // persistência. Conservar o maior contador conhecido sem somá-lo duas vezes.
  for (const [chave, n] of Object.entries(anteriores)) if (identificador(chave) && Number.isSafeInteger(n) && n > 0) usos[chave] = Math.max(usos[chave] || 0, n);
  usos[id] = Math.min(1000000, (usos[id] || 0) + 1);
  const limitados = Object.fromEntries(Object.entries(usos).sort((a,b) => b[1] - a[1]).slice(0, 300));
  if (identificador(usuarioId)) { try { (storage || globalThis.localStorage).setItem(PREFIXO + usuarioId, JSON.stringify(limitados)); } catch { /* Bloqueio de storage não impede preparar a mensagem. */ } }
  return limitados;
}
export const normalizarBuscaMensagem = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const descricoes = {
  cnpj: "Pedir o CNPJ para conferir os dados públicos da empresa.",
  autorizacao: "Explicar como autorizar o escritório a consultar a situação fiscal.",
  "autorizacao-acesso": "Ensinar a criar a procuração para o escritório consultar a situação fiscal.",
  "assinatura-govbr": "Ensinar a assinar um documento pelo gov.br.",
};
export function descricaoMensagem(r) {
  return String(r.dados?.descricao || descricoes[r.chave] || (r.tipo === "ORIENTACAO" ? "Texto pronto para orientar o cliente. Abra a prévia para conferir quando usar." : r.tipo === "CONTRATO" ? "Modelo usado para preparar o contrato de prestação de serviços." : r.tipo === "CATALOGO" ? "Regras e valores usados no cálculo das propostas." : "Dados do escritório usados nas mensagens e propostas.")).trim();
}
export function ultimasOrientacoes(recursos) {
  return [...new Map(recursos.filter(r => r.tipo === "ORIENTACAO" && r.aprovadoEm).sort((a,b) => a.versao - b.versao).map(r => [r.chave, r])).values()];
}
