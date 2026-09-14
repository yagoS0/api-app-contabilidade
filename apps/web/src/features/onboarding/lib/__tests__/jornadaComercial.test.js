import { montarJornada } from "../jornadaComercial";

const base = origem => ({ onboarding: { id: "o", origem, cnpj: origem === "ABERTURA" ? null : "11222333000181", dados: {}, versao: 1 }, propostas: [], contratos: [], marcos: [], jornada: { analises: [] } });
test("abertura coleta dados sem CNPJ e avança somente com os quatro campos", () => {
  const e = base("ABERTURA");
  expect(montarJornada(e).passos.map(p => p.id)).toEqual(["cadastro", "diagnostico", "devolutiva", "proposta", "contrato", "pagamento"]);
  expect(montarJornada(e).atual).toBe("cadastro");
  e.onboarding.dados = { responsavelNome: "Ana", atividadePretendida: "Consultoria", municipioAtendimento: "Rio", enderecoPretendido: "Rua teste" };
  expect(montarJornada(e).atual).toBe("diagnostico");
  expect(montarJornada(e).passos.find(p => p.id === "proposta").acessivel).toBe(false);
});
test.each(["TRANSFERENCIA", "INATIVA"])("%s percorre análise pública, autorização, fiscal e contratação", origem => {
  const e = base(origem), j = e.jornada;
  expect(montarJornada(e).atual).toBe("publica");
  j.analises.push({ id: "p", cnpj: e.onboarding.cnpj, tipo: "PUBLICA", status: "CONCLUIDA" });
  expect(montarJornada(e).atual).toBe("publica");
  j.publicaConferida = true; expect(montarJornada(e).atual).toBe("autorizacao");
  e.atendimento = { representanteVerificadoEm: "2026-09-14", autorizacao: { cnpj: e.onboarding.cnpj, estado: "ATIVA", prova: { validUntil: "2099-01-01" } } };
  expect(montarJornada(e).atual).toBe("fiscal");
  j.analises.push({ id: "f", cnpj: e.onboarding.cnpj, tipo: "SITFIS", status: "CONCLUIDA", resultado: { relatorioDisponivel: true } });
  expect(montarJornada(e).atual).toBe("fiscal");
  j.fiscalConferido = true; expect(montarJornada(e).atual).toBe("diagnostico");
  j.diagnostico = { id: "d" }; expect(montarJornada(e).atual).toBe("devolutiva");
  j.devolutiva = { incerta: true }; expect(montarJornada(e).atual).toBe("devolutiva");
  j.devolutiva = { concluida: true }; expect(montarJornada(e).atual).toBe("proposta");
  e.propostas = [{ id: "pr", status: "ENVIADA" }]; expect(montarJornada(e).atual).toBe("proposta");
  e.propostas[0].status = "ACEITA"; expect(montarJornada(e).atual).toBe("contrato");
  e.contratos = [{ id: "ct", propostaId: "pr", status: "AGUARDANDO_ASSINATURA" }];
  expect(montarJornada(e).atual).toBe("contrato");
  e.contratos[0].status = "ASSINADO_CONFERIDO"; expect(montarJornada(e).atual).toBe("pagamento");
  e.marcos.push({ tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { contratoId: "outro" } }); expect(montarJornada(e).atual).toBe("pagamento");
  e.marcos.push({ tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { contratoId: "ct" } }); expect(montarJornada(e).atual).toBe("conclusao");
});
test("aceite antigo retoma contrato sem inventar conferências históricas", () => {
  const e = base("INATIVA"); e.propostas = [{ id: "p", status: "ACEITA" }];
  const j = montarJornada(e); expect(j.atual).toBe("contrato"); expect(j.passos[0]).toMatchObject({ anterior: true, concluido: false });
});
test("CNPJ trocado e procuração vencida impedem usar as provas anteriores", () => {
  const e = base("TRANSFERENCIA"); e.jornada.publicaConferida = true;
  e.jornada.analises = [{ id: "p", tipo: "PUBLICA", cnpj: "00000000000000", status: "CONCLUIDA" }];
  expect(montarJornada(e).atual).toBe("publica");
  e.jornada.analises[0].cnpj = e.onboarding.cnpj;
  e.atendimento = { representanteVerificadoEm: "2026-01-01", autorizacao: { cnpj: e.onboarding.cnpj, estado: "ATIVA", prova: { validUntil: "2020-01-01" } } };
  expect(montarJornada(e).atual).toBe("autorizacao");
});
