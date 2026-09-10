import { resumirLiberacao } from "../resultadoLiberacao";
const previa = (canal = true) => ({ mesVencimento: "2026-09", items: [{ portalClientId: "c1", guideIds: ["g1"] }],
  rows: [{ portalClientId: "c1", razao: "ALFA" }], canais: { linhas: [{ portalClientId: "c1", whatsapp: { disponivel: canal }, email: { disponivel: true } }] } });
const result = (over = {}) => ({ portalClientId: "c1", liberadas: 1, ok: false, email: { ok: true }, whatsapp: [{ ok: true }], ...over });
const resumo = (r, p = previa()) => resumirLiberacao({ results: [r], previa: p });

test("e-mail enviado e WhatsApp indisponível não viram falha do lote", () => {
  const out = resumo(result({ whatsapp: [{ ok: false, tentado: false, naoSeAplica: true, message: "Sem contato" }] }), previa(false));
  expect(out).toMatchObject({ atencao: 0, emails: 1, aguardando: 0, liberadas: 1 });
  expect(out.linhas[0].whatsapp).toMatchObject({ texto: "Não utilizado", atencao: false });
});
test("resposta de servidor anterior usa disponibilidade conferida sem esconder tentativa explícita", () => {
  expect(resumo(result({ whatsapp: [{ ok: false, message: "Sem contato" }] }), previa(false)).atencao).toBe(0);
  expect(resumo(result({ whatsapp: [{ ok: false, tentado: true }] }), previa(false)).atencao).toBe(1);
});
test("aceito não vira entregue nem erro por causa do agregado ok=false", () => {
  const out = resumo(result());
  expect(out).toMatchObject({ atencao: 0, aguardando: 1 });
  expect(out.linhas[0].whatsapp.texto).toBe("1 aguardando entrega");
});
test("falha parcial e resultado incerto preservam o e-mail concluído", () => {
  for (const whatsapp of [[{ ok: true, parcial: true, aceitas: 1, falhas: 1 }], [{ ok: false, estado: "indeterminado" }]]) {
    const out = resumo(result({ whatsapp }));
    expect(out.atencao).toBe(1); expect(out.emails).toBe(1);
    expect(out.linhas[0].email.texto).toBe("Enviado");
  }
});
test("empresa sem resultado e guia sem retorno não são contadas como sucesso", () => {
  const p=previa(); p.items.push({ portalClientId:"c2", guideIds:["g2"] });
  const out = resumo(result({whatsapp:[]}), p);
  expect(out.atencao).toBe(2);
  expect(out.linhas[1].portal.texto).toBe("Não confirmado");
});
test("sem canais disponíveis mantém portal e informa necessidade de avisar o cliente", () => {
  const out = resumo(result({ email: { ok:false, naoSeAplica:true }, whatsapp:[{ok:false,naoSeAplica:true}] }),previa(false));
  expect(out).toMatchObject({atencao:1,liberadas:1,emails:0,aguardando:0});
  expect(out.linhas[0].semAviso).toBe(true);
});
test("parcelas faltantes ficam ligadas à empresa mesmo com todos os canais aceitos", () => {
  const p=previa(); p.rows[0].faltantes=[{acordo:"ABC",numeroParcela:9,motivo:"Guia faltante"}];
  const out=resumo(result(),p);
  expect(out.atencao).toBe(1);expect(out.linhas[0].detalhes[0]).toMatch(/ABC.*Guia faltante/);
});
test("erro técnico vira orientação sem induzir reenvio automático", () => {
  const out=resumo(result({email:{ok:false,message:"Internal error encountered."}}));
  expect(out.linhas[0].email.detalhes).toEqual(["O serviço não confirmou o envio. Confira o histórico antes de tentar novamente."]);
});
