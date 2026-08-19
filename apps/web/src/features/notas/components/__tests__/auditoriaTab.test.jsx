// A LIGAÇÃO DA ABA AUDITORIA — a regra já está travada em `lib/__tests__/auditoriaTela.test.js`;
// aqui trava-se que a TELA a consome, e que nada é escrito.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE:
//   1. `NAO_CONFERIVEL` não é desenhado como "nada a apontar" — é o defeito que apagaria o cadastro
//      vazio de 33 de 33 empresas da produção;
//   2. a nota que a pergunta não conseguiu avaliar continua NA TELA, com o motivo;
//   3. a frase "isto é pergunta, não veredito" está visível, não num comentário de código;
//   4. a aba não oferece nenhuma ação que escreva.

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AuditoriaTab } from "../renderAuditoriaTab";

const perguntaBase = (over) => ({
  achado: "há um ponto a conferir nesta nota",
  situacao: "CONFERIDA", motivo: null, avaliadas: 10, achados: [], naoAvaliadas: [], ...over,
});

const AUDITORIA = {
  competencia: "2026-07",
  totalNotas: 13,
  totalNotasApuradas: 12,
  totalAchados: 2,
  perguntas: [
    perguntaBase({
      id: "ATIVIDADE_FORA_DO_CADASTRO", titulo: "Atividade fora do cadastro",
      pergunta: "Alguma nota saiu num código de serviço que não está cadastrado na empresa?",
      situacao: "NAO_CONFERIVEL", motivo: "EMPRESA_SEM_CODIGOS_CADASTRADOS", avaliadas: 0,
    }),
    perguntaBase({
      id: "EMISSAO_FORA_DA_COMPETENCIA", titulo: "Emissão fora da competência",
      pergunta: "Alguma nota está sendo contada num mês diferente do mês em que foi emitida?",
      achado: "esta nota está contada numa competência diferente do mês da data de emissão",
      achados: [{
        pergunta: "EMISSAO_FORA_DA_COMPETENCIA", notaId: "n1", numero: "13000",
        chaveAcesso: "CH1", emissao: "2026-08-02", competencia: "2026-07", valor: 1250,
        dados: { mesDaCompetencia: "2026-07", mesDaEmissao: "2026-08", mesesDeDesvio: -1 },
      }],
    }),
    perguntaBase({
      id: "ISS_ZERADO_ONDE_TRIBUTA", titulo: "ISS zerado onde a atividade tributa",
      pergunta: "Alguma nota tem base ou alíquota de ISSQN e mesmo assim saiu com imposto zero?",
      naoAvaliadas: [{ notaId: "n2", numero: "13001", motivo: "SEM_ISSQN_NO_XML" }],
    }),
    perguntaBase({
      id: "NUMERACAO_DA_DPS", titulo: "Numeração da DPS",
      pergunta: "Dentro de uma mesma série, algum número de DPS foi repetido ou pulado?",
      janela: { de: "2025-08", ate: "2026-07", meses: 12 },
      series: [{ serie: "00001", de: 40, ate: 55, notas: 12, numerosDistintos: 12, pulados: 4, repetidos: 0 }],
      achados: [{
        pergunta: "NUMERACAO_DA_DPS", notaId: null, numero: null, chaveAcesso: null,
        emissao: null, competencia: null, valor: null,
        dados: { especie: "NUMERO_PULADO", serie: "00001", de: 44, ate: 47, quantidade: 4, antes: 43, depois: 48 },
      }],
    }),
    perguntaBase({
      id: "NOTA_NAO_LIDA", titulo: "Nota que não pôde ser lida",
      pergunta: "De alguma nota deste mês não conseguimos extrair os campos fiscais do XML?",
    }),
  ],
  empresa: { temCadastroDeServicos: false, codigosServicoNacional: [] },
  janelaDaSerie: { de: "2025-08", ate: "2026-07", meses: 12 },
};

const apiCom = (auditoria) => ({ getAuditoriaNotas: jest.fn(async () => ({ ok: true, auditoria })) });

describe("a aba Auditoria", () => {
  it("pede a auditoria da empresa e da competência que recebeu", async () => {
    const api = apiCom(AUDITORIA);
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    await waitFor(() => expect(api.getAuditoriaNotas).toHaveBeenCalledWith("emp-1", "2026-07"));
  });

  it("⚠ NÃO CONFERÍVEL não vira 'nada a apontar' — a tela manda cadastrar os códigos", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/a empresa não tem código de serviço cadastrado/i)).toBeInTheDocument();
    // ⚠ 19/08/2026: o "onde se resolve" passou a sair de `ONDE_CONFIGURA_EMISSAO` — a configuração
    // saiu da ficha e a entrada virou a engrenagem da aba Notas Fiscais (pedido do dono).
    expect(screen.getByText(/Cadastre os códigos em Notas Fiscais → ⚙ Configuração de emissão/i)).toBeInTheDocument();
  });

  it("a pergunta conferida SEM achado diz quantas notas foram olhadas", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findAllByText(/Nada a apontar em 10 nota\(s\) conferida\(s\)/)).not.toHaveLength(0);
  });

  it("⚠ a frase 'pergunta, não veredito' está NA TELA", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/Cada ponto é uma pergunta, não um veredito/)).toBeInTheDocument();
    expect(screen.getByText(/Quem decide se a nota está correta é você/)).toBeInTheDocument();
  });

  it("o achado sai com a frase da regra e o desvio em meses", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText("Competência 2026-07 · emitida em 2026-08")).toBeInTheDocument();
    expect(screen.getByText(/1 mês de diferença/)).toBeInTheDocument();
  });

  it("⚠ a JANELA da numeração aparece — 'nenhum salto' num mês só seria promessa maior que a conferência", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/de 2025-08 a 2026-07/)).toBeInTheDocument();
    expect(screen.getByText(/série 00001: nº 40 a 55/)).toBeInTheDocument();
  });

  it("⚠ a nota fora da conferência NÃO some — aparece com o motivo", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    const botao = await screen.findByText(/1 nota\(s\) fora desta conferência/);
    fireEvent.click(botao);
    expect(await screen.findByText(/Nota 13001 — o XML não traz ISSQN/)).toBeInTheDocument();
  });

  it("⚠ nenhuma ação de escrita é oferecida — a aba é leitura", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    await screen.findByText(/Auditoria pré-apuração/);
    const rotulos = screen.getAllByRole("button").map((b) => b.textContent || "");
    for (const r of rotulos) {
      expect(r).not.toMatch(/salvar|marcar|corrigir|ignorar|aplicar|confirmar|transmitir|excluir/i);
    }
    expect(screen.getByText(/Esta tela apenas lê/)).toBeInTheDocument();
  });

  it("⚠ falha NÃO vira 'nada a apontar' — o erro aparece", async () => {
    const api = { getAuditoriaNotas: jest.fn(async () => { throw new Error("servidor fora do ar"); }) };
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    expect(await screen.findByText(/servidor fora do ar/)).toBeInTheDocument();
    expect(screen.queryByText(/Nada a apontar/)).not.toBeInTheDocument();
  });

  it("sem competência não chama nada — e não afirma nada sobre o mês", async () => {
    const api = apiCom(AUDITORIA);
    render(<AuditoriaTab companyId="emp-1" competencia="" api={api} />);
    expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
    expect(await screen.findByText(/Escolha uma competência no topo/)).toBeInTheDocument();
  });

  it("com achado, o cabeçalho conta os pontos E lembra o que não deu para conferir", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText("2 pontos a conferir")).toBeInTheDocument();
    expect(screen.getByText(/1 sem como conferir/)).toBeInTheDocument();
  });
});
