import { normalizarE164 } from "../../companies/credentials/lib/contatoWhatsappTela";

// Só o nono dígito de celular brasileiro, mantendo DDI e DDD. Nunca envia para
// o número candidato: POR_SUFIXO é diagnóstico para o contador conferir.
function chaveMovel(numero) {
  if (/^55\d{2}9[6-9]\d{7}$/.test(numero || "")) return numero.slice(0, 4) + numero.slice(5);
  return /^55\d{2}[6-9]\d{7}$/.test(numero || "") ? numero : null;
}
export function onboardingDaConversa(conversa, onboardings) {
  if (conversa?.portalClientId) return { situacao: "CLIENTE", candidatos: [] };
  if (!Array.isArray(onboardings)) return { situacao: "DESCONHECIDO", candidatos: [] };
  const telefone = normalizarE164(`+${String(conversa?.telefoneE164 || "").replace(/\D/g, "")}`);
  if (!telefone) return { situacao: "TELEFONE_INVALIDO", candidatos: [] };
  const candidatos = onboardings.flatMap((o) => {
    const numero = normalizarE164(o.responsavelTelefone);
    const confianca = numero === telefone ? "EXATO"
      : chaveMovel(numero) && chaveMovel(numero) === chaveMovel(telefone) ? "POR_SUFIXO" : null;
    return confianca ? [{ id: o.id, origem: o.origem, status: o.status, confianca }] : [];
  });
  const exatos = candidatos.filter((c) => c.confianca === "EXATO");
  const escolhiveis = exatos.length ? exatos : candidatos;
  return { situacao: escolhiveis.length > 1 ? "AMBIGUO" : escolhiveis.length === 1 ? escolhiveis[0].confianca : "SEM_ONBOARDING", candidatos: escolhiveis };
}
export function dadosDoInteressado(conversa) {
  if (conversa?.portalClientId || !conversa?.telefoneE164) return null;
  const telefone = normalizarE164(`+${String(conversa.telefoneE164).replace(/\D/g, "")}`);
  if (!telefone) return null;
  return { responsavelNome: String(conversa.nomePerfilProvedor || "").trim(), responsavelTelefone: `+${telefone}` };
}
export function fraseDoOnboarding(leitura) {
  if (leitura?.situacao === "CARREGANDO") return "Conferindo onboardings…";
  if (leitura?.situacao === "EXATO") {
    const o = leitura.candidatos[0];
    return `onboarding ${o.origem} · ${o.status} · telefone exato`;
  }
  if (leitura?.situacao === "POR_SUFIXO") return "Possível onboarding — telefone difere pelo nono dígito; confira o cadastro.";
  if (leitura?.situacao === "AMBIGUO") return "Mais de um onboarding corresponde ao telefone — confira as fichas.";
  if (leitura?.situacao === "DESCONHECIDO") return "Não foi possível conferir o onboarding deste número.";
  return null;
}
