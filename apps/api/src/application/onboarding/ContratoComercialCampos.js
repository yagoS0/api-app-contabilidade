import { CAMPOS_CONTRATO, VARIAVEIS_CONTRATO_PROTEGIDAS, camposDoContrato, sugerirVariaveisContrato, variaveisDoModelo, problemasDosCamposContrato } from "../../../../../packages/shared/src/onboarding/contratoComercialCampos.js";

const erro = mensagem => Object.assign(new Error(mensagem), { code: "contrato_incompleto", status: 409 });
export function prepararCamposContrato(contexto) {
  const { modelo = {}, proposta = {} } = contexto;
  const opcao = proposta.snapshot?.opcoes?.find(o => o.chave === proposta.opcaoAceita);
  if (!opcao || proposta.status !== "ACEITA") throw erro("Selecione uma proposta com opção aceita.");
  if (variaveisDoModelo(modelo.texto).some(k => !CAMPOS_CONTRATO.some(c => c.chave === k))) throw erro("O modelo usa campos desconhecidos. Revise a versão na biblioteca.");
  const dados = sugerirVariaveisContrato(contexto);
  const campos = camposDoContrato(contexto);
  const problemas = problemasDosCamposContrato(campos, dados);
  if (problemas.length) throw erro(problemas.map(p => p.mensagem).join(" "));
  for (const c of campos) {
    if (c.documento) dados[c.chave] = String(dados[c.chave]).replace(/\D/g, "");
    if (c.tipo === "date") dados[c.chave] = String(dados[c.chave]).split("-").reverse().join("/");
  }
  return dados;
}
export function validarPadroesContrato(modelo) {
  const padroes = modelo.dados?.camposPadrao;
  if (padroes == null) return true;
  if (!padroes || typeof padroes !== "object" || Array.isArray(padroes)) return false;
  if (Object.values(padroes).some(v => !["string", "number"].includes(typeof v))) return false;
  const campos = CAMPOS_CONTRATO.filter(c => Object.hasOwn(padroes, c.chave));
  if (Object.keys(padroes).some(k => !campos.some(c => c.chave === k) || VARIAVEIS_CONTRATO_PROTEGIDAS.includes(k))) return false;
  // Campos ainda vazios são permitidos no modelo e exigidos no formulário de cada contrato.
  return !problemasDosCamposContrato(campos.filter(c => padroes[c.chave] !== ""), padroes).length;
}
