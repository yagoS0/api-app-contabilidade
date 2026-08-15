// O CAMINHO DA FALHA DA LISTA DE DOWNLOADS.
//
// `loadRecentes` tinha `catch { /* silencioso */ }`, e o silêncio saía como "Nenhum download
// ainda." — a tela afirmando que não existe ZIP nenhum quando o que houve foi a listagem falhar.
// O contador dispara de novo a geração de um ZIP que já está pronto (e cada geração varre as notas
// de todas as empresas do período).

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotasDownloadContent } from "../renderNotasDownloadPage";

const COMPANIES = [{ companyId: "c1", razao: "ALFA LTDA", cnpj: "00.000.000/0001-91" }];

const UM_JOB = {
  id: "job-1", status: "concluido", createdAt: "2026-08-01T10:00:00.000Z",
  competenciaDe: "2026-07", competenciaAte: "2026-07", tipo: "", papel: "",
  totalEmpresas: 1, processadas: 1, totalNotas: 12, arquivoBytes: 2048,
};

function apiCom(listNotasDownloads) {
  return { listNotasDownloads, getNotasDownload: jest.fn(), createNotasDownload: jest.fn(), fetchNotasDownloadBlob: jest.fn() };
}

describe("Downloads recentes — falha de listagem não é 'não há download'", () => {
  it("⚠ a lista que falha NÃO diz 'Nenhum download ainda.'", async () => {
    render(<NotasDownloadContent api={apiCom(jest.fn().mockRejectedValue(new Error("rede caiu")))} companies={COMPANIES} />);

    await screen.findByText("Não foi possível carregar os downloads recentes");
    expect(screen.queryByText("Nenhum download ainda.")).not.toBeInTheDocument();
    expect(screen.getByText("rede caiu")).toBeInTheDocument();
    // O ponto inteiro: avisar que pode haver ZIP pronto do outro lado.
    expect(screen.getByText(/ZIP pronto que esta lista não está mostrando/)).toBeInTheDocument();
  });

  it("lista vazia DE VERDADE continua dizendo que está vazia", async () => {
    render(<NotasDownloadContent api={apiCom(jest.fn().mockResolvedValue({ ok: true, jobs: [] }))} companies={COMPANIES} />);

    await screen.findByText("Nenhum download ainda.");
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });

  it("resposta sem `jobs` é falha, não lista vazia", async () => {
    render(<NotasDownloadContent api={apiCom(jest.fn().mockResolvedValue({ ok: true }))} companies={COMPANIES} />);

    await screen.findByText("Não foi possível carregar os downloads recentes");
    expect(screen.queryByText("Nenhum download ainda.")).not.toBeInTheDocument();
  });

  it("403 é sem acesso, não ausência de download", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    render(<NotasDownloadContent api={apiCom(jest.fn().mockRejectedValue(err))} companies={COMPANIES} />);

    await screen.findByText("Você não tem acesso a estes dados");
    expect(screen.queryByText("Nenhum download ainda.")).not.toBeInTheDocument();
  });

  it("'Tentar de novo' recarrega e o ZIP pronto aparece", async () => {
    const listar = jest.fn()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValue({ ok: true, jobs: [UM_JOB] });
    render(<NotasDownloadContent api={apiCom(listar)} companies={COMPANIES} />);

    await screen.findByText("Não foi possível carregar os downloads recentes");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Baixar/ })).toBeInTheDocument());
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });

  it("API sem a capacidade diz isso — não finge lista vazia", async () => {
    render(<NotasDownloadContent api={{ getNotasDownload: jest.fn() }} companies={COMPANIES} />);

    await screen.findByText("Não foi possível carregar os downloads recentes");
    expect(screen.getByText(/não expõe a lista de downloads/)).toBeInTheDocument();
  });
});
