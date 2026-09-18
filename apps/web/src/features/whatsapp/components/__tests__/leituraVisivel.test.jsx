import { render, screen, act } from "@testing-library/react";
import { FioDaConversa } from "../FioDaConversa";
let callback;
const observe = jest.fn(), disconnect = jest.fn();
beforeEach(() => { global.IntersectionObserver = jest.fn(cb => { callback = cb; return { observe, disconnect }; }); });
afterEach(() => { delete global.IntersectionObserver; jest.clearAllMocks(); });
const fio = { conversa: { id: "cv1", interlocutorId: "p1", contato: { nome: "Liz" }, janela: { situacao: "ABERTA" } }, mensagens: [{ id: "m1", direcao: "in", corpo: "Minha mensagem", registradaEm: "2026-09-16T12:00:00Z" }] };
function hook() { return { api: {}, marcarLida: jest.fn(), rascunhosRef: { current: new Map() } }; }
test("GET e render não marcam leitura; só a mensagem visível na conversa ativa", () => {
 const h = hook(); render(<FioDaConversa fio={fio} hook={h} />);
 expect(h.marcarLida).not.toHaveBeenCalled();
 act(() => callback([{ target: screen.getByTestId("balao-m1"), isIntersecting: false, intersectionRatio: 0 }]));
 expect(h.marcarLida).not.toHaveBeenCalled();
 act(() => callback([{ target: screen.getByTestId("balao-m1"), isIntersecting: true, intersectionRatio: 1 }]));
 expect(h.marcarLida).toHaveBeenCalledWith("cv1", "m1");
});
test("painel cobrindo a conversa suspende a observação de leitura", () => {
 const h = hook(); const ui = render(<FioDaConversa fio={fio} hook={h} />);
 ui.rerender(<FioDaConversa fio={fio} hook={h} detalhesAbertos />);
 expect(disconnect).toHaveBeenCalled();
 expect(h.marcarLida).not.toHaveBeenCalled();
});
