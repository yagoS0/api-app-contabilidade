// ⚠⚠ A HIERARQUIA E O NOME DOS CAMPOS — os dois defeitos que o dono resumiu como "está tudo muito
// bugado", e os dois MEDIDOS no navegador antes de mexer (01/09/2026):
//
//   página 2.806px · formulário terminando aos 1.025px · PRIMEIRO RESULTADO só aos 1.055px
//   10 campos, 10 SEM `id`
//   4 rótulos contaminados — o nome acessível da receita era literalmente
//     "Receita anual (R$)da empresa · notas fiscais emitidas e autorizadas de 09/2025 a 08/2026 (…"
//
// Depois: primeiro resultado aos 298px, zero campos sem `id`, nome acessível limpo.

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

function montar() {
  return render(<PlanejamentoPage api={{}} />);
}
const comReceita = () =>
  fireEvent.change(screen.getByLabelText(/Receita anual/i), { target: { value: "30000000" } });

// Revisão de 08/09: o contador primeiro identifica e edita as premissas, depois compara.
describe("Premissas antes da comparação", () => {
  it("com resultado na tela, o comparativo aparece depois do primeiro campo", async () => {
    // ⚠ O jsdom não faz layout, então não dá para medir pixel. O que se mede é a ORDEM NO
    // DOCUMENTO, que é o que produz a ordem na tela — e é ela que uma refatoração desfaz sem
    // querer.
    const { container } = montar();
    comReceita();
    await waitFor(() => expect(container.querySelector("[data-print-area]")).toBeInTheDocument());

    const html = container.innerHTML;
    const resultado = html.indexOf("data-print-area");
    const primeiroCampo = html.indexOf('id="pl-receita"');
    expect(resultado).toBeGreaterThan(-1);
    expect(primeiroCampo).toBeGreaterThan(-1);
    expect(resultado).toBeGreaterThan(primeiroCampo);
  });

  it("nenhum campo some ao reorganizar o formulário", async () => {
    montar();
    comReceita();
    // Os nove campos continuam todos lá. "Resposta primeiro" não pode virar "esconder premissa".
    for (const id of ["pl-receita", "pl-rbt12", "pl-meses", "pl-folha", "pl-atividade",
      "pl-anexo", "pl-iss", "pl-margem", "pl-creditos"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("⚠ sem receita não há resposta, e a tela abre no formulário", () => {
    // Ali a pergunta ainda não foi feita — pôr um bloco vazio no topo seria pior.
    const { container } = montar();
    expect(container.querySelector("[data-print-area]")).toBeNull();
  });
});

describe("⚠⚠ O NOME DO CAMPO É O QUE ELE PEDE — a procedência é DESCRIÇÃO", () => {
  it("⚠⚠ o nome acessível da receita NÃO carrega a procedência", () => {
    // Era: "Receita anual (R$)da empresa · notas fiscais emitidas e autorizadas de 09/2025 a…".
    // O nome de um campo não pode MUDAR com o dado da empresa.
    montar();
    const campo = screen.getByLabelText(/Receita anual/i);
    const rotulo = document.querySelector(`label[for="${campo.id}"]`);
    expect(rotulo.textContent.trim()).toBe("Receita anual (R$)");
    expect(rotulo.textContent).not.toMatch(/da empresa|notas fiscais/i);
  });

  it("todo campo tem `id`, e o rótulo aponta para ele", () => {
    montar();
    const campos = [...document.querySelectorAll("input:not([type=checkbox]), select")];
    expect(campos.length).toBeGreaterThan(0);
    for (const c of campos) {
      expect(c.id).toBeTruthy();
      expect(document.querySelector(`label[for="${c.id}"]`)).not.toBeNull();
    }
  });

  it("⚠ e a procedência continua NA TELA — ela mudou de canal, não sumiu", async () => {
    // Tirá-la seria trocar um defeito por outro: ela é o que distingue dois PDFs da mesma empresa.
    // O canal certo é `aria-describedby`, não o nome.
    const api = {
      getDadosPlanejamento: async () => ({
        ok: true,
        empresa: { id: "e1", razao: "ALFA", cnpj: "1" },
        referencia: { competencia: "2026-08", janela: [], janelaRotulo: "08/2025 a 07/2026" },
        campos: {
          receitaAnual: { valor: 300000, apurado: true, origem: "notas fiscais", motivoAusencia: null },
          rbt12: { valor: 300000, apurado: true, origem: "extrato", motivoAusencia: null },
          folhaAnual: { valor: null, apurado: false, origem: null, motivoAusencia: "Não foi possível apurar a folha" },
          regimeAtual: { valor: "SIMPLES_NACIONAL", apurado: true, origem: "cadastro", motivoAusencia: null },
          anexo: { valor: "III", apurado: true, origem: "cadastro", motivoAusencia: null },
          sujeitoFatorR: { valor: false, apurado: true, origem: "perfil", motivoAusencia: null },
          aliquotaIss: { valor: 0.03, apurado: true, origem: "cadastro", motivoAusencia: null },
          atividadePresumido: { valor: null, apurado: false, origem: null, motivoAusencia: "Escolha na tela." },
        },
      }),
    };
    render(<PlanejamentoPage api={api} empresa={{ id: "e1" }} empresaFixa />);
    await waitFor(() => expect(screen.getAllByDisplayValue("300.000,00").length).toBeGreaterThan(0));

    const campo = screen.getByLabelText(/Receita anual/i);
    const descId = campo.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId).textContent).toMatch(/da empresa/i);
  });
});

 it('ações de cenário vêm depois das premissas, com salvar por último',()=>{montar();const campo=screen.getByLabelText('Créditos anuais de PIS/COFINS (R$)');const abrir=screen.getByRole('button',{name:'Abrir cenário'});const salvar=screen.getByRole('button',{name:'Salvar cenário'});expect(campo.compareDocumentPosition(abrir)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(abrir.compareDocumentPosition(salvar)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByText('Premissas não salvas')).toBeVisible();});
