import { dadosDoInteressado, onboardingDaConversa, fraseDoOnboarding } from "../onboardingDaConversa";
const conversa = { telefoneE164: "5511977776666", portalClientId: null, nomePerfilProvedor: "Carlos" };
const ficha = { id: "o1", responsavelTelefone: "+55 (11) 97777-6666", origem: "ABERTURA", status: "RASCUNHO" };
test("o nome do perfil nunca é usado para casar; telefone vai em E164", () => {
  expect(dadosDoInteressado(conversa)).toEqual({ responsavelNome: "Carlos", responsavelTelefone: "+5511977776666" });
  expect(onboardingDaConversa(conversa, [{ ...ficha, responsavelNome: "Carlos", responsavelTelefone: "21999998888" }]).situacao).toBe("SEM_ONBOARDING");
});
test("correspondência exata traz origem e estado verdadeiros", () => {
  const r = onboardingDaConversa(conversa, [ficha]);
  expect(r.situacao).toBe("EXATO"); expect(r.candidatos[0].id).toBe("o1");
  expect(fraseDoOnboarding(r)).toContain("ABERTURA · RASCUNHO");
});
test("nono dígito é só possibilidade, outro DDD e fixo não casam", () => {
  expect(onboardingDaConversa(conversa, [{ ...ficha, responsavelTelefone: "1177776666" }]).situacao).toBe("POR_SUFIXO");
  expect(onboardingDaConversa(conversa, [{ ...ficha, responsavelTelefone: "2177776666" }]).situacao).toBe("SEM_ONBOARDING");
  expect(onboardingDaConversa({ ...conversa, telefoneE164: "5511933334444" }, [{ ...ficha, responsavelTelefone: "1133334444" }]).situacao).toBe("SEM_ONBOARDING");
});
test("ambiguidade não escolhe primeira ficha; exato vence a aproximação", () => {
  expect(onboardingDaConversa(conversa, [ficha, { ...ficha, id: "o2" }]).situacao).toBe("AMBIGUO");
  expect(onboardingDaConversa(conversa, [ficha, { ...ficha, id: "o2", responsavelTelefone: "1177776666" }]).candidatos.map(c => c.id)).toEqual(["o1"]);
});
test("falha, telefone inválido e cliente vinculado não autorizam criar", () => {
  expect(onboardingDaConversa(conversa, null).situacao).toBe("DESCONHECIDO");
  expect(onboardingDaConversa({ ...conversa, telefoneE164: "123" }, []).situacao).toBe("TELEFONE_INVALIDO");
  expect(dadosDoInteressado({ ...conversa, portalClientId: "p1" })).toBeNull();
});
