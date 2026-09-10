import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AtendimentoComercial, OrientacoesRapidas } from "../../../whatsapp/components/AtendimentoComercial";

jest.mock("../FluxoComercial", () => ({ FluxoComercial: ({ onboardingId }) => <div>Fluxo da ficha {onboardingId}</div> }));
const pendente = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const recursos = [{ id: "r1", tipo: "ORIENTACAO", aprovadoEm: "2026-09-09", chave: "primeira", titulo: "Primeira", versao: 1 }, { id: "r2", tipo: "ORIENTACAO", aprovadoEm: "2026-09-09", chave: "segunda", titulo: "Segunda", versao: 2 }];
const a = { id: "a", contato: { nome: "Contato A" }, empresa: { cnpj: "12345678000195" } }, b = { id: "b", contato: { nome: "Contato B" }, empresa: { cnpj: "11222333000181" } };
async function abrir() { fireEvent.click(screen.getByText("Mensagens rápidas")); await screen.findByText("/primeira — Primeira · v1"); }
function selecionar(id) { fireEvent.change(screen.getByLabelText("Orientação"), { target: { value: id } }); }

test("troca de conversa limpa a ficha anterior e ignora consulta atrasada", async () => {
  const primeira = pendente();
  const api = { comercial: jest.fn(path => path === "/conversas/a" ? primeira.promise : Promise.resolve({ atendimento: { onboardingId: "ficha-b" } })) };
  const r = render(<AtendimentoComercial api={api} conversa={a} />);
  r.rerender(<AtendimentoComercial api={api} conversa={b} />);
  expect(await screen.findByText("Fluxo da ficha ficha-b")).toBeInTheDocument();
  await act(async () => primeira.resolve({ atendimento: { onboardingId: "ficha-a" } }));
  expect(screen.queryByText("Fluxo da ficha ficha-a")).not.toBeInTheDocument(); expect(screen.getByText("Fluxo da ficha ficha-b")).toBeInTheDocument();
});

test("não oferece criar ficha antes da consulta e permite recuperar falha", async () => {
  const api = { comercial: jest.fn().mockRejectedValueOnce(new Error("Falha de leitura")).mockResolvedValue({ atendimento: null }) };
  render(<AtendimentoComercial api={api} conversa={a} />);
  expect(screen.queryByText("Iniciar atendimento")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha de leitura"); expect(screen.getByText("Iniciar atendimento")).toBeDisabled();
  fireEvent.click(screen.getByText("Recarregar atendimento comercial"));
  await waitFor(() => expect(screen.getByText("Iniciar atendimento")).toBeEnabled());
});

test("conclusão de criação da conversa anterior não muda a nova nem chama callback antigo", async () => {
  const gravacao = pendente(), onCriado = jest.fn();
  const api = { comercial: jest.fn(path => path.endsWith("/iniciar") ? gravacao.promise : Promise.resolve({ atendimento: null })) };
  const r = render(<AtendimentoComercial api={api} conversa={a} onCriado={onCriado} />);
  fireEvent.click(await screen.findByText("Iniciar atendimento"));
  r.rerender(<AtendimentoComercial api={api} conversa={b} onCriado={onCriado} />);
  await screen.findByText("Iniciar atendimento"); await act(async () => gravacao.resolve({ atendimento: { onboardingId: "ficha-a" } }));
  expect(screen.queryByText("Fluxo da ficha ficha-a")).not.toBeInTheDocument(); expect(onCriado).not.toHaveBeenCalled();
  expect(api.comercial).toHaveBeenCalledWith("/conversas/a/iniciar", { origem: null });
});

test("prévia antiga não sobrescreve a orientação escolhida mais recentemente", async () => {
  const antiga = pendente(), nova = pendente();
  const api = { comercial: jest.fn(path => path === "/recursos" ? Promise.resolve({ recursos }) : path.includes("r1") ? antiga.promise : nova.promise), enviarOrientacaoWhatsapp: jest.fn().mockResolvedValue({ ok: true }) };
  render(<OrientacoesRapidas api={api} conversa={a} />); await abrir(); selecionar("r1"); selecionar("r2");
  await act(async () => nova.resolve({ previa: { texto: "Mensagem mais recente" } }));
  await act(async () => antiga.resolve({ previa: { texto: "Mensagem antiga" } }));
  expect(screen.queryByText("Mensagem antiga")).not.toBeInTheDocument(); expect(screen.getByText("Mensagem mais recente")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Assumir e enviar orientação"));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("a", { orientacaoId: "r2", variaveis: { nome: "Contato A", cnpj: "12345678000195", servico: "" }, assumir: true }));
});

test("alterar variáveis invalida prévia pendente e envia somente o conteúdo reconferido", async () => {
  const antiga = pendente(); let consultas = 0;
  const api = { comercial: jest.fn((path, body) => path === "/recursos" ? Promise.resolve({ recursos }) : ++consultas === 1 ? antiga.promise : Promise.resolve({ previa: { texto: `Para ${body.variaveis.nome}: ${body.variaveis.servico}` } })), enviarOrientacaoWhatsapp: jest.fn().mockResolvedValue({ ok: true }) };
  render(<OrientacoesRapidas api={api} conversa={a} />); await abrir(); selecionar("r1");
  fireEvent.change(screen.getByLabelText("Nome do destinatário"), { target: { value: "Nome corrigido" } });
  fireEvent.change(screen.getByLabelText("Serviço (quando solicitado pelo texto)"), { target: { value: "Abertura avulsa" } });
  await act(async () => antiga.resolve({ previa: { texto: "Para o contato antigo" } }));
  expect(screen.queryByText("Assumir e enviar orientação")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Conferir mensagem")); await screen.findByText("Para Nome corrigido: Abertura avulsa");
  fireEvent.click(screen.getByText("Assumir e enviar orientação"));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("a", { orientacaoId: "r1", variaveis: { nome: "Nome corrigido", cnpj: "12345678000195", servico: "Abertura avulsa" }, assumir: true }));
});

test("trocar contato descarta prévia e inicializa nome/CNPJ da nova conversa", async () => {
  const antiga = pendente();
  const api = { comercial: jest.fn(path => path === "/recursos" ? Promise.resolve({ recursos }) : antiga.promise), enviarOrientacaoWhatsapp: jest.fn() };
  const r = render(<OrientacoesRapidas api={api} conversa={a} />); await abrir(); selecionar("r1");
  r.rerender(<OrientacoesRapidas api={api} conversa={b} />); expect(screen.queryByLabelText("Orientação")).not.toBeInTheDocument();
  await abrir(); await act(async () => antiga.resolve({ previa: { texto: "Dados do contato A" } }));
  expect(screen.getByLabelText("Nome do destinatário")).toHaveValue("Contato B"); expect(screen.getByLabelText("CNPJ")).toHaveValue("11222333000181"); expect(screen.getByLabelText("Orientação")).toHaveValue("");
  expect(screen.queryByText("Dados do contato A")).not.toBeInTheDocument(); expect(screen.queryByText("Assumir e enviar orientação")).not.toBeInTheDocument(); expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("fechar o painel impede reaparecimento de prévia atrasada ao reabrir", async () => {
  const antiga = pendente(); const api = { comercial: jest.fn(path => path === "/recursos" ? Promise.resolve({ recursos }) : antiga.promise) };
  render(<OrientacoesRapidas api={api} conversa={a} />); await abrir(); selecionar("r1");
  fireEvent.click(screen.getByText("Mensagens rápidas")); await act(async () => antiga.resolve({ previa: { texto: "Prévia descartada" } })); await abrir();
  expect(screen.queryByText("Prévia descartada")).not.toBeInTheDocument(); expect(screen.queryByText("Assumir e enviar orientação")).not.toBeInTheDocument();
});

test("erro de listagem não aparece como biblioteca vazia", async () => {
  render(<OrientacoesRapidas api={{ comercial: jest.fn().mockRejectedValue(new Error("Acesso indisponível")) }} conversa={a} />);
  fireEvent.click(screen.getByText("Mensagens rápidas")); expect(await screen.findByRole("alert")).toHaveTextContent("Acesso indisponível"); expect(screen.queryByText(/Cadastre e aprove/)).not.toBeInTheDocument();
});
