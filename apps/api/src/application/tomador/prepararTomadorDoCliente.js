// Preparação compartilhável pelo chat guiado e pelas ferramentas: nenhuma emissão ou escrita.
// A revisão vence a memória da MESMA empresa, depois CNPJ e CEP completam somente lacunas.
import { buscarTomadoresEmitidos } from "../nfse/tomadorEmitido.js";
import { consultarCnpj } from "./consultaCnpj.js";
import { consultarCep } from "./consultarCep.js";
import { camposDeEnderecoDaReceita, CAMPOS_ENDERECO_EXIGIDOS } from "./consultaTomador.js";
import { municipiosIbgeOuNulo } from "../nfse/lote/municipiosIbge.js";
import { cpfTemDvValido } from "../../utils/cpf.js";

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const preenchidos = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v).trim()]));
const completo = (e) => CAMPOS_ENDERECO_EXIGIDOS.every(([k]) => e?.[k]);
// Aceitar a pontuação habitual não autoriza apagar letras para fabricar um CEP válido.
const normalizarCep = (v) => /^\d{5}-?\d{3}$/.test(String(v ?? "").trim()) ? String(v).trim().replace("-", "") : String(v ?? "").trim();
export const enderecoDaMemoria = (t) => preenchidos({ cMun: t?.cMun, CEP: normalizarCep(t?.cep), xLgr: t?.xLgr, nro: t?.nro, xCpl: t?.xCpl, xBairro: t?.xBairro });

export async function prepararTomadorDoCliente(input, deps) {
  const { prisma, resolveLegacyCompanyId, log } = deps;
  const doc = digitos(input.tomadorDoc);
  if (![11, 14].includes(doc.length) || (doc.length === 11 && !cpfTemDvValido(doc))) {
    return { ok: false, motivo: "tomador_documento_invalido", mensagem: "Confira o CPF/CNPJ do tomador.", campos: ["tomadorDoc"] };
  }
  const companyId = await resolveLegacyCompanyId(input.portalClientId);
  const memoria = await (deps.buscarTomadoresEmitidos || buscarTomadoresEmitidos)({ prisma, companyId, documentos: [doc], log });
  const salvo = memoria.tomadores.get(doc);
  const manual = preenchidos(input.endereco);
  if (manual.CEP) manual.CEP = normalizarCep(manual.CEP);
  const origens = {};
  const endereco = {};
  const incluirEndereco = (valores, fonte, sobrescrever = false) => {
    for (const [campo, valor] of Object.entries(preenchidos(valores))) {
      if (!sobrescrever && endereco[campo]) continue;
      endereco[campo] = valor;
      origens[`endereco.${campo}`] = fonte;
    }
  };
  // CEP novo ou ausente na memória não prova que a rua/número antigos pertençam ao CEP manual.
  if (!manual.CEP || manual.CEP === normalizarCep(salvo?.cep)) incluirEndereco(enderecoDaMemoria(salvo), "memoria");
  incluirEndereco(manual, "manual", true);
  const escolher = (campo, revisado, memorizado) => {
    const revisao = String(revisado ?? "").trim();
    const memoria = String(memorizado ?? "").trim();
    if (revisao) { origens[campo] = "manual"; return revisao; }
    if (memoria) { origens[campo] = "memoria"; return memoria; }
    return null;
  };
  const tomador = { cnpjCpf: doc, nome: escolher("tomadorNome", input.tomadorNome, salvo?.nome), email: escolher("tomadorEmail", input.tomadorEmail, salvo?.email) };
  const completarEnderecoConsultado = (dados, fonte) => {
    const recebido = preenchidos(dados);
    if (recebido.CEP) recebido.CEP = normalizarCep(recebido.CEP);
    // O endereço selecionado tem prioridade como um conjunto: não misturar rua de outro CEP.
    if (endereco.CEP && endereco.CEP !== recebido.CEP) return;
    if (!endereco.CEP && recebido.CEP) {
      // Sem CEP anterior, também não há prova de que o número/complemento salvos sirvam aqui.
      // Preservar somente campos que o cliente forneceu explicitamente nesta preparação.
      for (const campo of Object.keys(endereco)) {
        if (origens[`endereco.${campo}`] !== "memoria") continue;
        delete endereco[campo];
        delete origens[`endereco.${campo}`];
      }
    }
    incluirEndereco(recebido, fonte);
  };
  const avisos = [];
  if (memoria.motivo) avisos.push("A memória de tomadores está indisponível; a preparação segue com os dados informados ou consultados.");
  let municipios;
  let municipiosCarregados = false;
  const municipiosOficiais = async () => {
    if (!municipiosCarregados) { municipios = await (deps.municipiosIbgeOuNulo || municipiosIbgeOuNulo)({ log }); municipiosCarregados = true; }
    return municipios;
  };
  if (doc.length === 14 && (!tomador.nome || (!completo(endereco) && !manual.CEP))) {
    const consulta = await (deps.consultarCnpj || consultarCnpj)(doc, { municipios: await municipiosOficiais(), log });
    if (consulta.ok) {
      for (const [campo, chave] of [["nome", "tomadorNome"], ["email", "tomadorEmail"]]) {
        if (!tomador[campo] && consulta.tomador?.[campo]) { tomador[campo] = consulta.tomador[campo]; origens[chave] = "cnpj"; }
      }
      const recebido = consulta.tomador?.endereco || camposDeEnderecoDaReceita(consulta.bruto, { municipios });
      completarEnderecoConsultado(recebido, "cnpj");
      if (consulta.tomador?.avisoSituacao) avisos.push(consulta.tomador.avisoSituacao);
    } else avisos.push("A consulta do CNPJ não retornou os dados; é possível completar o que falta por aqui.");
  }
  if (/^\d{8}$/.test(endereco.CEP || "") && (!endereco.cMun || !endereco.xLgr || !endereco.xBairro)) {
    const consulta = await (deps.consultarCep || consultarCep)(endereco.CEP, { municipios: await municipiosOficiais(), log });
    if (consulta.ok) completarEnderecoConsultado(consulta.endereco, "cep");
    else avisos.push("A consulta do CEP não retornou o endereço; é possível informar os campos que faltam.");
  }
  tomador.endereco = endereco;
  const campos = [!tomador.nome && "tomadorNome", ...CAMPOS_ENDERECO_EXIGIDOS.filter(([k]) => !endereco[k]).map(([k]) => `endereco.${k}`)].filter(Boolean);
  if (endereco.CEP && !/^\d{8}$/.test(endereco.CEP) && !campos.includes("endereco.CEP")) campos.push("endereco.CEP");
  if (endereco.cMun && !/^\d{7}$/.test(endereco.cMun) && !campos.includes("endereco.cMun")) campos.push("endereco.cMun");
  const rotulos = { tomadorNome: "nome do tomador", ...Object.fromEntries(CAMPOS_ENDERECO_EXIGIDOS.map(([k, v]) => [`endereco.${k}`, v])) };
  const usadas = new Set(Object.values(origens));
  const fontes = { memoria: usadas.has("memoria"), cnpj: usadas.has("cnpj"), cep: usadas.has("cep") };
  // Primeiro CEP e número; não transformar uma consulta indisponível num pedido de código IBGE.
  const camposParaPerguntar = campos.includes("endereco.CEP")
    ? campos.filter(k => ["tomadorNome", "endereco.CEP", "endereco.nro"].includes(k)) : campos.filter(k => k !== "endereco.cMun");
  const encaminharEscritorio = campos.includes("endereco.cMun") && !campos.includes("endereco.CEP");
  const mensagem = encaminharEscritorio
    ? "Não consegui conferir o município pelo CEP. O escritório precisa completar essa conferência; não peça código IBGE ao cliente."
    : `Para completar o tomador, peça somente: ${camposParaPerguntar.map(k => rotulos[k]).join(", ")}. ${campos.includes("endereco.CEP") ? "Com o CEP, o sistema tentará completar rua, bairro e município." : ""}`.trim();
  return { ok: campos.length === 0, ...(campos.length ? { motivo: "DADOS_TOMADOR_PENDENTES", mensagem, camposParaPerguntar, encaminharEscritorio } : {}), tomador, campos, fontes, origens, avisos };
}
