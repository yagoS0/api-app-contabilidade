import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiagnosticoDoLead, MensagemDoPasso, CamposDaEtapa } from "../PassosDoLead";
import { FluxoComercial } from "../FluxoComercial";

test("diagnóstico preserva o rascunho e pede revisão quando outro atendente altera a ficha", () => {
  const onSalvar = jest.fn(), o = { id: "o", origem: "ABERTURA", versao: 1 };
  const { rerender } = render(<DiagnosticoDoLead onboarding={o} jornada={{}} onSalvar={onSalvar} />);
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
  const input = screen.getByRole("textbox"); fireEvent.change(input, { target: { value: "Ana sintética" } });
  rerender(<CamposDaEtapa onboarding={{ ...o, versao: 2 }} campos={["responsavelNome"]} onSalvar={onSalvar} />);
  fireEvent.click(screen.getByText("Salvar dados deste passo"));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith(expect.objectContaining({ versao: 1 })));
  expect(input).toHaveValue("Ana sintética");
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
  fireEvent.change(await screen.findByLabelText(/Análise da atividade/), { target: { value: "Conferência da viabilidade sintética." } });
  fireEvent.change(screen.getByLabelText("Serviços necessários e escopo"), { target: { value: "Serviços avulsos e mensais sintéticos." } });
  fireEvent.click(screen.getByText("Confirmar diagnóstico e continuar"));
  fireEvent.click(await screen.findByText("Conferi: enviar devolutiva"));
  await screen.findByText("Gerar proposta para revisão");
  expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/jornada/devolutiva", { diagnosticoId: "d" });
  unmount(); render(<FluxoComercial api={api} onboardingId="o" conversaId="c" />);
  expect(await screen.findByText("Gerar proposta para revisão")).toBeInTheDocument();
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
