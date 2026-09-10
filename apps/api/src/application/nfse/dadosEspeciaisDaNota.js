import { cpfTemDvValido } from "../../utils/cpf.js";

const OBRIGAM_OBRA = new Set(["070201", "070202", "070401", "070501", "070502", "070601", "070602", "070701", "070801", "071701", "071901", "141403", "141404"]);
const texto = (v) => typeof v === "string" ? v.trim() : "";
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function objeto(v, nome, chaves) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some((k) => !chaves.includes(k))) throw new Error(`${nome}: campos inválidos.`);
  if (Object.values(v).some((val) => typeof val !== "string" || /[\u0000-\u001f\u007f]/.test(val))) throw new Error(`${nome}: informe texto sem caracteres de controle.`);
}

export function normalizarObra(v) {
  if (v == null) return null;
  objeto(v, "Obra", ["cObra", "cCIB", "inscImobFisc"]);
  const r = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, texto(val)]).filter(([, val]) => val));
  if (Boolean(r.cObra) === Boolean(r.cCIB)) throw new Error("Obra: informe CNO/CEI ou CIB, exclusivamente um identificador.");
  if ((r.cObra && r.cObra.length > 30) || (r.cCIB && r.cCIB.length !== 8) || (r.inscImobFisc && r.inscImobFisc.length > 30)) throw new Error("Obra: CNO/CEI e inscrição têm até 30 caracteres; CIB tem 8 caracteres.");
  return r;
}

export function normalizarDestinatario(v) {
  if (v == null) return null;
  objeto(v, "Destinatário", ["cnpjCpf", "nome"]);
  const doc = texto(v.cnpjCpf).replace(/[.\-/\s]/g, "");
  if (!/^(\d{11}|\d{14})$/.test(doc) || (doc.length === 11 && !cpfTemDvValido(doc))) throw new Error("Destinatário: informe CPF válido ou CNPJ com 14 dígitos.");
  const nome = texto(v.nome);
  if (!nome || nome.length > 150) throw new Error("Destinatário: nome obrigatório, com até 150 caracteres.");
  return { cnpjCpf: doc, nome };
}

export function xmlDadosEspeciais({ obra, destinatario }, { cTribNac, ibscbsInformado }) {
  try {
    const o = normalizarObra(obra), d = normalizarDestinatario(destinatario);
    if (OBRIGAM_OBRA.has(cTribNac) && !o) throw new Error("Informe os dados da obra para este serviço (E0370).");
    if (d && !ibscbsInformado) throw new Error("Destinatário diferente do tomador exige IBS/CBS configurado e ativo.");
    return {
      obra: o ? `<obra>${o.inscImobFisc ? `<inscImobFisc>${esc(o.inscImobFisc)}</inscImobFisc>` : ""}${o.cObra ? `<cObra>${esc(o.cObra)}</cObra>` : `<cCIB>${esc(o.cCIB)}</cCIB>`}</obra>` : "",
      indDest: d ? "1" : "0",
      destinatario: d ? `<dest><${d.cnpjCpf.length === 11 ? "CPF" : "CNPJ"}>${d.cnpjCpf}</${d.cnpjCpf.length === 11 ? "CPF" : "CNPJ"}><xNome>${esc(d.nome)}</xNome></dest>` : "",
    };
  } catch (err) { throw Object.assign(err, { code: "NFSE_DADOS_ESPECIAIS_INVALIDOS" }); }
}
