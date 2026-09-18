import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ApuracaoLpTab } from "../ApuracaoLpTab";
const mockGet = jest.fn();
jest.mock("../../../../api/client", () => ({ createApiClient: () => ({ getApuracaoLp: (...a) => mockGet(...a) }) }));
it("uma falha antiga não substitui a competência atual", async () => {
  let rejeitarAntiga;
  mockGet.mockImplementationOnce(() => new Promise((_r, reject) => { rejeitarAntiga = reject; }))
    .mockResolvedValueOnce({ receita: { servicos: 2000, mercadorias: 0 }, pis: 13, cofins: 60 });
  const { rerender } = render(<ApuracaoLpTab companyId="a" competencia="2026-07" />);
  rerender(<ApuracaoLpTab companyId="a" competencia="2026-08" />);
  await waitFor(() => expect(screen.getByText(/Apuração do Lucro Presumido — 2026-08/)).toBeInTheDocument());
  await act(async () => { rejeitarAntiga(new Error("resposta antiga")); });
  expect(screen.queryByText("resposta antiga")).not.toBeInTheDocument();
  expect(screen.getByText(/Apuração do Lucro Presumido — 2026-08/)).toBeInTheDocument();
});

it('a premissa de serviços 16% não é herdada por outra empresa', async()=>{
 mockGet.mockReset();mockGet.mockResolvedValue({receita:{servicos:2000,mercadorias:0},pis:13,cofins:60,servicos16:{}});
 const {rerender}=render(<ApuracaoLpTab companyId="a" competencia="2026-07"/>);
 fireEvent.click(await screen.findByLabelText('Sim, enquadra'));
 await waitFor(()=>expect(mockGet).toHaveBeenLastCalledWith('a','2026-07',{servicos16:true}));
 rerender(<ApuracaoLpTab companyId="b" competencia="2026-07"/>);
 await waitFor(()=>expect(mockGet).toHaveBeenLastCalledWith('b','2026-07',{servicos16:null}));
});
