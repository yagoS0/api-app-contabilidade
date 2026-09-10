// Valores desta nota, nunca inferidos do cadastro ou reaproveitados de outra emissão.
export const OPERACAO_VAZIA = {
  vRetIRRF: "", vRetCP: "", obraTipo: "cObra", obraCodigo: "", obraInscricao: "",
  destinatarioDoc: "", destinatarioNome: "",
};

function cpfValido(doc) {
  if (/^(\d)\1+$/.test(doc)) return false;
  for (const tamanho of [9, 10]) {
    const soma = [...doc.slice(0, tamanho)].reduce((acc, d, i) => acc + Number(d) * (tamanho + 1 - i), 0);
    const digito = (soma * 10) % 11;
    if ((digito === 10 ? 0 : digito) !== Number(doc[tamanho])) return false;
  }
  return true;
}

export function conferirDadosDaOperacao(form, valorServicos) {
  const erros = [], payload = {}, retencoes = {};
  const texto = (campo) => String(form[campo] ?? "").trim();
  let totalRetido = 0;
  for (const [campo, rotulo] of [["vRetIRRF", "IRRF"], ["vRetCP", "Contribuição previdenciária"]]) {
    const valor = texto(campo).replace(",", ".");
    if (!valor) continue;
    if (!/^\d+(?:\.\d{1,2})?$/.test(valor) || Number(valor) <= 0 || !(Number(valor) < valorServicos)) {
      erros.push(`${rotulo}: informe um valor positivo, menor que o serviço, com até duas casas decimais.`);
    } else {
      retencoes[campo] = Number(valor).toFixed(2);
      totalRetido += Math.round(Number(valor) * 100);
    }
  }
  totalRetido /= 100;
  if (Object.keys(retencoes).length) payload.retencoesComplementares = retencoes;
  if (totalRetido && totalRetido >= valorServicos) erros.push("A soma das retenções deve ser menor que o valor do serviço.");
  const codigo = texto("obraCodigo"), inscricao = texto("obraInscricao");
  if (codigo || inscricao) {
    const tipo = texto("obraTipo");
    if (!["cObra", "cCIB"].includes(tipo) || !codigo || (tipo === "cCIB" ? codigo.length !== 8 : codigo.length > 30) || inscricao.length > 30) {
      erros.push("Obra: informe CNO/CEI com até 30 caracteres ou CIB com 8; inscrição imobiliária tem até 30 caracteres.");
    } else payload.obra = { [tipo]: codigo, ...(inscricao ? { inscImobFisc: inscricao } : {}) };
  }
  const doc = texto("destinatarioDoc").replace(/[.\-/\s]/g, ""), nome = texto("destinatarioNome");
  if (doc || nome) {
    if (!/^(\d{11}|\d{14})$/.test(doc) || (doc.length === 11 && !cpfValido(doc)) || !nome || nome.length > 150) {
      erros.push("Destinatário: informe CPF válido ou CNPJ com 14 dígitos e nome com até 150 caracteres.");
    } else payload.destinatario = { cnpjCpf: doc, nome };
  }
  if ([codigo, inscricao, nome].some((v) => /[\u0000-\u001f\u007f]/.test(v))) erros.push("Remova os caracteres de controle dos dados da operação.");
  return { ok: erros.length === 0, erros, payload, totalRetido };
}
