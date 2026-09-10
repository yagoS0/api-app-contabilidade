import { grupoNoEscopo, resumoDoGrupo, filtroMensagensDoGrupo, empresaDaMensagem } from "../whatsappAtendimento.js";

const atendimento = { id: "responsavel", versao: 3, conversaId: "c-b", portalClientId: "b", aguardandoSelecao: false };
const segmento = (id) => ({ id: `c-${id}`, atendimentoId: atendimento.id, portalClientId: id, portalClient: { id, razao: `Empresa ${id}`, cnpj: `cnpj-${id}` }, excluidaEm: null });
const segmentos = [segmento("a"), segmento("b"), segmento("c")];

// Interpreta a árvore de filtros usada nestas consultas; os dados realmente atravessam a guarda.
function casa(valor, filtro) {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object") return valor === filtro;
  if ("is" in filtro) return casa(valor, filtro.is);
  if ("in" in filtro && !filtro.in.includes(valor)) return false;
  if ("notIn" in filtro && filtro.notIn.includes(valor)) return false;
  if ("not" in filtro && casa(valor, filtro.not)) return false;
  return Object.entries(filtro).every(([chave, v]) => {
    if (["in", "notIn", "not"].includes(chave)) return true;
    if (chave === "OR") return v.some(item => casa(valor, item));
    if (chave === "AND") return v.every(item => casa(valor, item));
    if (chave === "NOT") return !casa(valor, v);
    if (chave === "startsWith") return String(valor || "").startsWith(v);
    return casa(valor?.[chave], v);
  });
}

function client() {
  const dados = [...segmentos, { id: "neutra", chaveEscopo: "sem-empresa:5500000000000", atendimentoId: atendimento.id, portalClientId: null, excluidaEm: null }, { id: "empresa-apagada", chaveEscopo: "empresa:apagada:5500000000000", atendimentoId: atendimento.id, portalClientId: null, excluidaEm: null }];
  return {
    atendimentoResponsavelWhatsapp: { findUnique: jest.fn(async () => atendimento) },
    conversaWhatsapp: {
      findMany: jest.fn(async ({ where }) => dados.filter(c => casa(c, where))),
      findFirst: jest.fn(async ({ where }) => dados.find(c => casa(c, where)) || null),
    },
  };
}
const mensagens = [
  { id: "historica-a", conversaId: "c-a", contexto: null },
  { id: "historica-b", conversaId: "c-b", contexto: null },
  { id: "historica-c", conversaId: "c-c", contexto: null },
  { id: "resolvida-a", conversaId: "neutra", contexto: { atendimentoId: atendimento.id, conversaId: "c-a", portalClientId: "a" } },
  { id: "resolvida-c", conversaId: "c-a", contexto: { atendimentoId: atendimento.id, conversaId: "c-c", portalClientId: "c" } },
  { id: "seletor", conversaId: "neutra", contexto: { atendimentoId: atendimento.id, conversaId: null } },
  { id: "saida-seletor", conversaId: "neutra", contexto: null },
  { id: "historico-empresa-apagada", conversaId: "empresa-apagada", contexto: null },
  { id: "outro-responsavel", conversaId: "outra", contexto: { atendimentoId: "outro", conversaId: "c-a", portalClientId: "a" } },
];

test("carteira parcial não revela nome, ID ou contagem das empresas de fora", async () => {
  const grupo = await grupoNoEscopo({ conversa: segmentos[0], visiveis: ["a"], client: client() });
  const resumo = resumoDoGrupo(grupo, segmentos[0]);
  expect(resumo.empresas).toEqual([{ id: "a", razao: "Empresa a", cnpj: "cnpj-a", conversaId: "c-a", apelidosWhatsapp: [] }]);
  expect(resumo.atendimento).toMatchObject({ empresaAtualId: null, empresaAtual: null, selecaoForaDaCarteira: true, contextoSelecionado: false });
  expect(JSON.stringify(resumo)).not.toContain("Empresa b");
  expect(grupo.segmentosNeutros).toEqual([]);
});

test("histórico parcial inclui recibo neutro resolvido na carteira, exclui neutro e resolução para outra empresa", async () => {
  const grupo = await grupoNoEscopo({ conversa: segmentos[0], visiveis: ["a"], client: client() });
  const visiveis = mensagens.filter(m => casa(m, filtroMensagensDoGrupo(grupo)));
  expect(visiveis.map(m => m.id)).toEqual(["historica-a", "resolvida-a"]);
  expect(empresaDaMensagem(visiveis[1], grupo)).toEqual(segmentos[0].portalClient);
});

test("carteira completa vê seletor sem empresa definida, sem atribuir artificialmente à empresa atual", async () => {
  const grupo = await grupoNoEscopo({ conversa: segmentos[1], visiveis: ["a", "b", "c"], client: client() });
  const visiveis = mensagens.filter(m => casa(m, filtroMensagensDoGrupo(grupo)));
  expect(visiveis.map(m => m.id)).toEqual(["historica-a", "historica-b", "historica-c", "resolvida-a", "resolvida-c", "seletor", "saida-seletor"]);
  expect(empresaDaMensagem(visiveis.find(m => m.id === "seletor"), grupo)).toBeNull();
  expect(resumoDoGrupo(grupo, segmentos[1]).atendimento).toMatchObject({ empresaAtualId: "b", contextoSelecionado: true });
});

test("filtrar histórico mantém empresa da resolução e não muda o contexto atual", async () => {
  const grupo = await grupoNoEscopo({ conversa: segmentos[1], visiveis: ["a", "b", "c"], client: client() });
  expect(mensagens.filter(m => casa(m, filtroMensagensDoGrupo(grupo, "a"))).map(m => m.id)).toEqual(["historica-a", "resolvida-a"]);
  expect(mensagens.filter(m => casa(m, filtroMensagensDoGrupo(grupo, "fora")))).toEqual([]);
  expect(atendimento.portalClientId).toBe("b");
});

test("históricos legados e conversa sem atendimento continuam independentes", async () => {
  const db = client();
  expect(await grupoNoEscopo({ conversa: { id: "legado", atendimentoId: atendimento.id, chaveEscopo: "legado:a" }, visiveis: ["a"], client: db })).toBeNull();
  expect(await grupoNoEscopo({ conversa: { id: "anterior" }, visiveis: ["a"], client: db })).toBeNull();
  expect(db.conversaWhatsapp.findMany).not.toHaveBeenCalled();
});
