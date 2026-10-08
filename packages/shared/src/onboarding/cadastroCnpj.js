import { normalizarDocumento } from "../documentosFiscais.js";

// Dados enviados pelo navegador são cadastrais declarados, nunca prova de consulta do servidor.
export function normalizarCadastroCnpj(cadastro, cnpj) {
  if (!cadastro || cadastro.fonte !== "BRASIL_API" || !cnpj || cadastro.cnpj !== normalizarDocumento(cnpj) || !cadastro.empresa || !Number.isFinite(Date.parse(cadastro.consultadoEm))) return null;
  const texto = valor => typeof valor === "string" || typeof valor === "number" ? String(valor).slice(0, 500) : "";
  const empresa = {};
  for (const campo of ["razaoSocial", "nomeFantasia", "telefone", "cnaePrincipal", "naturezaJuridica", "porte", "dataAbertura", "municipio", "uf"]) empresa[campo] = texto(cadastro.empresa[campo]);
  empresa.cnaesSecundarios = Array.isArray(cadastro.empresa.cnaesSecundarios) ? cadastro.empresa.cnaesSecundarios.slice(0, 100).map(texto) : [];
  empresa.capitalSocial = typeof cadastro.empresa.capitalSocial === "number" && Number.isFinite(cadastro.empresa.capitalSocial) ? cadastro.empresa.capitalSocial : null;
  empresa.endereco = {};
  for (const campo of ["rua", "numero", "complemento", "bairro", "cidade", "uf", "cep"]) empresa.endereco[campo] = texto(cadastro.empresa.endereco?.[campo]);
  return { cnpj: cadastro.cnpj, fonte: "BRASIL_API", consultadoEm: new Date(cadastro.consultadoEm).toISOString(), empresa, situacao: { texto: texto(cadastro.situacao?.texto), ativa: cadastro.situacao?.ativa === true, motivo: texto(cadastro.situacao?.motivo), data: texto(cadastro.situacao?.data) } };
}
