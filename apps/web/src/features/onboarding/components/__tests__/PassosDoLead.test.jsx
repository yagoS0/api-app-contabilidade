import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiagnosticoDoLead, MensagemDoPasso, CamposDaEtapa } from "../PassosDoLead";
import { FluxoComercial } from "../FluxoComercial";
import { AcoesDaEtapa } from "../AcoesDaEtapa";

test("diagnóstico anterior reaparece como rascunho e só pode ser salvo depois da revisão explícita", () => {
  const onSalvar = jest.fn();
  const jornada = { diagnostico: null, diagnosticoDesatualizado: true, diagnosticoAnterior: { achados: "Endereço anterior conferido.", servicos: "Abertura e serviço contábil mensal." } };
  render(<DiagnosticoDoLead sempreAberto onboarding={{ id: "o", origem: "ABERTURA", versao: 4 }} jornada={jornada} onSalvar={onSalvar} />);
  expect(screen.getByLabelText(/Análise da atividade/)).toHaveValue(jornada.diagnosticoAnterior.achados);
  expect(screen.getByLabelText("Serviços necessários e escopo")).toHaveValue(jornada.diagnosticoAnterior.servicos);
  expect(screen.getByRole("alert")).toHaveTextContent(/rascunho|preservado/);
  expect(screen.getByRole("button", { name: "Confirmar diagnóstico e continuar" })).toBeDisabled();
  expect(onSalvar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi os dados atualizados: manter meu texto" }));
  fireEvent.change(screen.getByLabelText(/Análise da atividade/), { target: { value: "Novo endereço conferido pelo escritório." } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar diagnóstico e continuar" }));
  expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 4, achados: "Novo endereço conferido pelo escritório." }));
  expect(jornada.diagnostico).toBeNull();
});

test("diagnóstico vazio adota a nova versão sem pedir para preservar texto inexistente", () => {
  const onSalvar = jest.fn(), ficha = { id: "o", origem: "ABERTURA", versao: 1 };
  const ui = render(<DiagnosticoDoLead sempreAberto onboarding={ficha} jornada={{}} onSalvar={onSalvar} />);
  ui.rerender(<DiagnosticoDoLead sempreAberto onboarding={{ ...ficha, versao: 2 }} jornada={{}} onSalvar={onSalvar} />);
  expect(screen.getByLabelText(/Análise da atividade/)).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Conferi os dados atualizados: manter meu texto" })).not.toBeInTheDocument();
  expect(onSalvar).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Análise da atividade/), { target: { value: "Viabilidade conferida na nova versão." } });
  fireEvent.change(screen.getByLabelText("Serviços necessários e escopo"), { target: { value: "Abertura e acompanhamento mensal." } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar diagnóstico e continuar" }));
  expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 2, achados: "Viabilidade conferida na nova versão." }));
});

test("abas da etapa preservam dados abertos e a versão do rascunho", async () => {
  const onSalvar = jest.fn(async () => false), ficha = { id: "o", origem: "ABERTURA", versao: 1, dados: {} };
  const tela = onboarding => <AcoesDaEtapa tituloPrincipal="Preencher dados"><CamposDaEtapa sempreAberto onboarding={onboarding} campos={["responsavelNome"]} onSalvar={onSalvar} /><details><summary>Enviar formulário</summary><p>Formulário de apoio</p></details></AcoesDaEtapa>;
  const ui = render(tela(ficha));
  const campo = screen.getByRole("textbox");
  fireEvent.change(campo, { target: { value: "Pessoa sintética" } });
  fireEvent.click(screen.getByRole("tab", { name: "Enviar formulário" }));
  expect(campo).not.toBeVisible(); expect(campo).toBeInTheDocument();
  ui.rerender(tela({ ...ficha, versao: 2 }));
  fireEvent.click(screen.getByRole("tab", { name: "Preencher dados" }));
  expect(screen.getByRole("textbox")).toBe(campo);
  expect(campo).toHaveValue("Pessoa sintética");
  fireEvent.click(screen.getByRole("button", { name: "Salvar dados deste passo" }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 1 })));
});

test("prévia de orientação não muda de destino; exige preparar novamente antes de enviar", async () => {
  const api = { enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) };
  const preparar = jest.fn(async () => ({ texto: "Orientação conferida." }));
  const ui = render(<MensagemDoPasso api={api} conversaId="principal" preparar={preparar} rotulo="Preparar orientação" />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar orientação" }));
  await screen.findByText("Orientação conferida.");
  ui.rerender(<MensagemDoPasso api={api} conversaId="comercial" preparar={preparar} rotulo="Preparar orientação" />);
  const enviar = screen.getByRole("button", { name: "Conferi: enviar mensagem" });
  expect(enviar).toBeDisabled(); fireEvent.click(enviar);
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("canal de envio mudou");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar prévia" }));
  fireEvent.click(screen.getByRole("button", { name: "Preparar orientação" }));
  fireEvent.click(await screen.findByRole("button", { name: "Conferi: enviar mensagem" }));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("comercial", { texto: "Orientação conferida.", assumir: true }));
  expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1);
});

test("diagnóstico preserva o rascunho e pede revisão quando outro atendente altera a ficha", () => {
  const onSalvar = jest.fn(), o = { id: "o", origem: "ABERTURA", versao: 1 };
  const { rerender } = render(<DiagnosticoDoLead onboarding={o} jornada={{}} onSalvar={onSalvar} />);
  expect(screen.queryByLabelText(/Análise da atividade/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Preparar diagnóstico e escopo"));
  fireEvent.change(screen.getByLabelText(/Análise da atividade/), { target: { value: "Endereço e atividade conferidos." } });
  fireEvent.change(screen.getByLabelText("Serviços necessários e escopo"), { target: { value: "Abertura com serviço contábil mensal." } });
  rerender(<DiagnosticoDoLead onboarding={{ ...o, versao: 2 }} jornada={{}} onSalvar={onSalvar} />);
  expect(screen.getByText("Confirmar diagnóstico e continuar")).toBeDisabled();
  expect(screen.getByLabelText(/Análise da atividade/)).toHaveValue("Endereço e atividade conferidos.");
  fireEvent.click(screen.getByText("Conferi os dados atualizados: manter meu texto"));
  fireEvent.click(screen.getByText("Confirmar diagnóstico e continuar"));
  expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 2, achados: "Endereço e atividade conferidos." }));
});
test("campo da etapa preserva versão inicial e não apaga rascunho ao falhar", async () => {
  const o = { id: "o", origem: "ABERTURA", versao: 1, dados: {} }, onSalvar = jest.fn(async () => false);
  const { rerender } = render(<CamposDaEtapa onboarding={o} campos={["responsavelNome"]} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByText("Conferir ou preencher dados deste passo"));
  const input = screen.getByRole("textbox"); fireEvent.change(input, { target: { value: "Ana sintética" } });
  rerender(<CamposDaEtapa onboarding={{ ...o, versao: 2 }} campos={["responsavelNome"]} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByText("Salvar dados deste passo"));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 1 })));
  expect(input).toHaveValue("Ana sintética");
});

test("recolher os dados mantém o formulário montado e preserva a edição sem salvar", () => {
  const onSalvar = jest.fn();
  render(<CamposDaEtapa onboarding={{ id: "o", origem: "ABERTURA", versao: 1, dados: {} }} campos={["responsavelNome"]} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir ou preencher dados deste passo" }));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Ana sintética" } });
  fireEvent.click(screen.getByRole("button", { name: "Recolher dados" }));
  expect(input).toBeInTheDocument();
  expect(input).not.toBeVisible();
  expect(onSalvar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferir ou preencher dados deste passo" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("Ana sintética");
});

test("recolher o diagnóstico mantém os campos e ainda exige a conferência da versão atual", () => {
  const onSalvar = jest.fn(), o = { id: "o", origem: "ABERTURA", versao: 1 };
  const { rerender } = render(<DiagnosticoDoLead onboarding={o} jornada={{}} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar diagnóstico e escopo" }));
  const achados = screen.getByLabelText(/Análise da atividade/);
  fireEvent.change(achados, { target: { value: "Atividade conferida para a abertura." } });
  fireEvent.change(screen.getByLabelText("Serviços necessários e escopo"), { target: { value: "Abertura e acompanhamento mensal." } });
  fireEvent.click(screen.getByRole("button", { name: "Recolher diagnóstico" }));
  expect(achados).toBeInTheDocument();
  expect(achados).not.toBeVisible();
  rerender(<DiagnosticoDoLead onboarding={{ ...o, versao: 2 }} jornada={{}} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar diagnóstico e escopo" }));
  expect(screen.getByLabelText(/Análise da atividade/)).toBe(achados);
  expect(achados).toHaveValue("Atividade conferida para a abertura.");
  expect(screen.getByRole("button", { name: "Confirmar diagnóstico e continuar" })).toBeDisabled();
  expect(onSalvar).not.toHaveBeenCalled();
});

test("próximo passo segue a projeção do servidor e o mapa não executa etapas futuras", async () => {
  const estado = { onboarding: { id: "o", origem: "ABERTURA", versao: 1, dados: {} }, propostas: [], contratos: [], documentos: [], trabalhos: [], jornada: { projecao: {
    atual: "diagnostico", passos: [
      { id: "cadastro", titulo: "Dados conferidos", concluido: true, acessivel: true, pendencias: [] },
      { id: "diagnostico", titulo: "Conferir o serviço solicitado", concluido: false, acessivel: true, instrucao: "Revisar o que foi coletado antes da proposta.", pendencias: ["Conferência do contador"] },
      { id: "proposta", titulo: "Apresentar a proposta", concluido: false, acessivel: false, pendencias: [] }
    ]
  } } };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o" />);
  expect(await screen.findByText("Etapa atual")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Conferir o serviço solicitado" })).toBeVisible();
  const mapa = screen.getByRole("navigation", { name: "Passo a passo do lead", hidden: true });
  expect(mapa).toBeVisible();
  expect(mapa.closest("details")).toBeNull();
  const futura = screen.getByRole("button", { name: /Apresentar a proposta/ });
  expect(futura).toBeDisabled();
  fireEvent.click(futura);
  expect(api.comercial.mock.calls.every(args => args.length === 1)).toBe(true);
  expect(screen.queryByText("Gerar proposta para revisão")).not.toBeInTheDocument();
});
test("orientação precisa de prévia e envio explícito; timeout impede repetição", async () => {
  const preparar = jest.fn(async () => ({ texto: "Mensagem sintética" }));
  const api = { enviarOrientacaoWhatsapp: jest.fn(async () => { throw Error("Timeout sintético"); }) };
  render(<MensagemDoPasso api={api} conversaId="c" preparar={preparar} rotulo="Preparar orientação" />);
  fireEvent.click(screen.getByText("Preparar orientação"));
  await screen.findByText("Mensagem sintética"); expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Conferi: enviar mensagem"));
  await screen.findByRole("alert"); expect(screen.getByText("Conferi: enviar mensagem")).toBeDisabled();
  expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1);
});
test("tela avança diagnóstico, devolutiva e proposta com dados salvos e retoma após recarregar", async () => {
  let e = { onboarding: { id: "o", origem: "ABERTURA", versao: 1, dados: { responsavelNome: "Ana", atividadePretendida: "Consultoria", municipioAtendimento: "Rio", enderecoPretendido: "Rua sintética" } }, jornada: { analises: [], devolutiva: { partes: [], concluida: false } }, propostas: [], contratos: [], documentos: [], trabalhos: [] };
  const api = { comercial: jest.fn(async (path, body) => {
    if (path === "/recursos") return { recursos: [] };
    if (path.endsWith("/jornada/diagnostico")) e = { ...e, jornada: { ...e.jornada, diagnostico: { id: "d", dados: { ...body, texto: "Devolutiva sintética" } } } };
    if (path.endsWith("/jornada/devolutiva")) e = { ...e, jornada: { ...e.jornada, devolutiva: { partes: [{ parte: "TEXTO", status: "enviado" }], concluida: true } } };
    return JSON.parse(JSON.stringify(e));
  }) };
  const { unmount } = render(<FluxoComercial api={api} onboardingId="o" conversaId="c" />);
  expect(await screen.findByLabelText(/Análise da atividade/)).toBeVisible();
  fireEvent.change(await screen.findByLabelText(/Análise da atividade/), { target: { value: "Conferência da viabilidade sintética." } });
  fireEvent.change(screen.getByLabelText("Serviços necessários e escopo"), { target: { value: "Serviços avulsos e mensais sintéticos." } });
  fireEvent.click(screen.getByText("Confirmar diagnóstico e continuar"));
  expect(await screen.findByText("Devolutiva sintética")).toBeVisible();
  fireEvent.click(await screen.findByText("Conferi: enviar devolutiva"));
  fireEvent.click(await screen.findByText("Preparar uma nova proposta em PDF"));
  await screen.findByText("Gerar proposta para revisão");
  expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/jornada/devolutiva", { diagnosticoId: "d", conversaId: "c" });
  unmount(); render(<FluxoComercial api={api} onboardingId="o" conversaId="c" />);
  fireEvent.click(await screen.findByText("Preparar uma nova proposta em PDF"));
  expect(await screen.findByText("Gerar proposta para revisão")).toBeInTheDocument();
});

test("orientação enviada recolhe a prévia sem repetir mensagem ao atualizar", async () => {
  const api = { enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) };
  render(<MensagemDoPasso api={api} conversaId="c" preparar={async () => ({ texto: "Prévia sintética" })} rotulo="Preparar orientação" />);
  fireEvent.click(screen.getByText("Preparar orientação"));
  fireEvent.click(await screen.findByText("Conferi: enviar mensagem"));
  await screen.findByText("Mensagem enviada.");
  expect(screen.queryByText("Prévia sintética")).not.toBeInTheDocument();
  expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1);
});

test("onboarding direto não envia à conversa antiga e permite avançar pela conferência da procuração", async () => {
  const cnpj = "11222333000181";
  let e = { onboarding: { id: "o", origem: "TRANSFERENCIA", versao: 2, cnpj, dados: {} }, configuracao: { consultasFiscais: true }, jornada: { publicaConferida: true, analises: [{ id: "pub", tipo: "PUBLICA", status: "CONCLUIDA", cnpj }], devolutiva: { partes: [] } }, atendimento: { conversaId: "conversa-salva", autorizacao: {} }, propostas: [], contratos: [], documentos: [], trabalhos: [] };
  const api = { enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })), comercial: jest.fn(async (path, body) => {
    if (path === "/recursos") return { recursos: [{ id: "r", tipo: "ORIENTACAO", chave: "autorizacao-acesso", titulo: "Procuração", aprovadoEm: "2026-09-15", versao: 1 }] };
    if (path.endsWith("/previa")) return { previa: { texto: "Orientação de procuração sintética" } };
    if (path.endsWith("/representante")) e = { ...e, atendimento: { ...e.atendimento, representanteVerificadoEm: "2026-09-15" } };
    if (path.endsWith("/consultas") && body.tipo === "PROCURACAO") e = { ...e, atendimento: { ...e.atendimento, autorizacao: { cnpj, estado: "ATIVA", prova: { validUntil: "2099-01-01" } } } };
    return JSON.parse(JSON.stringify(e));
  }) };
  render(<FluxoComercial api={api} onboardingId="o" />);
  const preparar = await screen.findByRole("button", { name: "Preparar orientação: Procuração" });
  expect(preparar).toBeDisabled(); fireEvent.click(preparar);
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Como a representação foi conferida")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Registrar conferência do representante"));
  fireEvent.change(screen.getByLabelText("Como a representação foi conferida"), { target: { value: "Representante conferido com documentação." } });
  fireEvent.click(screen.getByText("OK: registrar e continuar"));
  fireEvent.click(await screen.findByText("Verificar procuração e avançar"));
  await screen.findByText("Solicitar situação fiscal");
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Como a representação foi conferida")).not.toBeInTheDocument();
});

test("serviço avulso contratado só encerra com evidência explícita de entrega", async () => {
  const estado = { onboarding: { id: "o", origem: "ABERTURA", dados: {}, versao: 3 }, propostas: [{ id: "p", status: "ACEITA" }], contratos: [{ id: "c", propostaId: "p", status: "ASSINADO_CONFERIDO", dados: { opcao: { recorrente: false } } }], marcos: [{ tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { contratoId: "c" } }], documentos: [], trabalhos: [] };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o" />);
  fireEvent.click(await screen.findByText("Encerrar serviço avulso após a entrega"));
  expect(screen.getByText("Conferi a entrega: concluir serviço avulso")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Evidência da entrega"), { target: { value: "Entrega sintética conferida pelo escritório." } });
  fireEvent.click(screen.getByText("Conferi a entrega: concluir serviço avulso"));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/concluir-avulso", { evidencia: "Entrega sintética conferida pelo escritório." }));
});
