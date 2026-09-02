// O PAINEL "O QUE A PRÓXIMA NOTA VAI LEVAR" — a costura entre a regra e a tela.
//
// ⚠ A REGRA em si está travada em `lib/nfse/__tests__/perfilEmissao.test.js` (inclusive o amarre com
// a lista do backend). Aqui se mede a LIGAÇÃO: que a tela desenha as seis linhas, mostra a TAG do
// XML, marca a procedência, e — o mais importante — **não promete efeito que não existe**.

import { render, screen, within } from "@testing-library/react";
import { PainelProximaDps } from "../PainelProximaDps";

const campo = (over = {}) => ({
  valor: "1", valorHoje: "1", fonte: "CRAVADO", mudariaComPerfil: false, cravadoHoje: true, ...over,
});

function dados({ temPerfil = false, integracaoLigada = false, perfis = [], campos = {}, avisos = [] } = {}) {
  return {
    ok: true,
    integracaoLigada,
    perfis,
    derivadoDoCadastro: { origem: "DERIVADO_DO_CADASTRO", codigoServicoNacional: "171901" },
    proximaDps: {
      temPerfil,
      perfisAtivos: perfis.filter((p) => p.ativo).length,
      avisos,
      campos: {
        codigoServicoNacional: campo({ valor: "171901", valorHoje: "171901", fonte: "COMPANY", cravadoHoje: false }),
        codigoServicoMunicipal: campo({ valor: "001", valorHoje: "001", fonte: "COMPANY", cravadoHoje: false }),
        cLocPrestacao: campo({ valor: null, valorHoje: null, fonte: "INDEFINIDO", cravadoHoje: false }),
        regEspTrib: campo({ valor: "0", valorHoje: "0", fonte: "CRAVADO", cravadoHoje: false }),
        regApTribSN: campo(),
        tribISSQN: campo(),
        ...campos,
      },
    },
  };
}

describe("as seis linhas, com a TAG do XML à vista", () => {
  it("desenha um campo por linha, com a tag embaixo do rótulo", () => {
    render(<PainelProximaDps dados={dados()} />);
    const linha = document.querySelector('[data-campo="tribISSQN"]');
    expect(within(linha).getByText("tribISSQN")).toBeInTheDocument();
    expect(within(linha).getByText(/Tributação do ISSQN/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-campo]")).toHaveLength(6);
  });

  it("⚠ ausência sai como TRAVESSÃO e 'não configurado' — nunca zero", () => {
    render(<PainelProximaDps dados={dados()} />);
    const linha = document.querySelector('[data-campo="cLocPrestacao"]');
    expect(within(linha).getByText("—")).toBeInTheDocument();
    expect(within(linha).getByText(/não configurado/)).toBeInTheDocument();
  });

  it("o valor que decide tributação sai com a descrição, não cru", () => {
    render(<PainelProximaDps dados={dados()} />);
    expect(screen.getByText(/1 — Operação tributável/)).toBeInTheDocument();
  });
});

describe("⚠⚠ o CRAVADO é o que justifica o painel", () => {
  it("avisa quantos campos são fixos, e diz que não adianta procurá-los no cadastro", () => {
    render(<PainelProximaDps dados={dados()} />);
    expect(screen.getByText(/2 campos são fixos no sistema hoje/)).toBeInTheDocument();
    expect(screen.getByText(/não adianta procurá-los lá/)).toBeInTheDocument();
  });

  it("a procedência do campo fixo é dita por extenso", () => {
    render(<PainelProximaDps dados={dados()} />);
    const linha = document.querySelector('[data-campo="regApTribSN"]');
    expect(within(linha).getByText(/não vem de cadastro nenhum/)).toBeInTheDocument();
  });
});

describe("⚠⚠ a tela NÃO promete efeito que não existe", () => {
  it("com a integração desligada, o cabeçalho é CONDICIONAL", () => {
    // "De onde vem" numa linha que diz "do perfil de emissão" afirmaria que a próxima nota já sai
    // assim — e não sai. O tempo verbal é parte do comportamento.
    render(<PainelProximaDps dados={dados({ temPerfil: true })} />);
    expect(screen.getByText("De onde viria")).toBeInTheDocument();
    expect(screen.queryByText("De onde vem")).toBeNull();
  });

  it("com a integração ligada, o cabeçalho passa ao presente", () => {
    render(<PainelProximaDps dados={dados({ temPerfil: true, integracaoLigada: true })} />);
    expect(screen.getByText("De onde vem")).toBeInTheDocument();
  });

  it("o rodapé diz o que MUDARIA, e conta", () => {
    render(<PainelProximaDps dados={dados({
      temPerfil: true,
      campos: { tribISSQN: campo({ valor: "3", valorHoje: "1", fonte: "PERFIL", mudariaComPerfil: true }) },
    })} />);
    expect(document.querySelector("[data-efeito]").textContent).toMatch(/1 campo\(s\) sairiam diferentes/);
  });

  it("⚠ o 'antes' fica ao lado do 'depois' — 'mudaria' sem referência não é informação", () => {
    render(<PainelProximaDps dados={dados({
      temPerfil: true,
      campos: { tribISSQN: campo({ valor: "3", valorHoje: "1", fonte: "PERFIL", mudariaComPerfil: true }) },
    })} />);
    const linha = document.querySelector('[data-campo="tribISSQN"]');
    expect(within(linha).getByText(/3 — Exportação de serviço/)).toBeInTheDocument();
    expect(within(linha).getByText(/hoje: 1 — Operação tributável/)).toBeInTheDocument();
  });
});

describe("⚠ os três estados da resposta", () => {
  it("resposta ausente NÃO diz 'esta empresa não tem perfil'", () => {
    // Afirmar coisa sobre o cadastro quando o problema é a chamada é o defeito que a distinção
    // entre `NAO_RECEBIDA` e `SEM_PERFIL` existe para impedir.
    render(<PainelProximaDps dados={null} />);
    expect(screen.getByText(/Não recebemos a configuração de emissão/)).toBeInTheDocument();
    expect(screen.queryByText(/ainda não tem perfil/)).toBeNull();
  });

  it("carregando não é 'não recebida'", () => {
    render(<PainelProximaDps dados={null} carregando />);
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(/Não recebemos/)).toBeNull();
  });

  it("sem perfil, a tela diz que a emissão sai do cadastro — o comportamento de hoje", () => {
    render(<PainelProximaDps dados={dados()} />);
    expect(screen.getByText(/a emissão sai do cadastro/)).toBeInTheDocument();
  });
});

describe("⚠ os perfis, e quem pode mexer", () => {
  const PERFIL = {
    id: "pf-1", nome: "Consultoria RJ", ativo: true, padrao: false,
    origem: "DERIVADO_DO_CADASTRO", codigoServicoNacional: "171901", tribISSQN: "1",
  };

  it("a origem do PERFIL é dita — 'derivado' não é o mesmo que 'configurado'", () => {
    render(<PainelProximaDps dados={dados({ temPerfil: true, perfis: [PERFIL] })} />);
    expect(screen.getByText("derivado do cadastro")).toBeInTheDocument();
  });

  it("sem permissão, não há botão de criar — e a tela diz por quê", () => {
    render(<PainelProximaDps dados={dados()} podeEditar={false} />);
    expect(screen.queryByRole("button", { name: /Criar perfil/ })).toBeNull();
    expect(screen.getByText(/Apenas admin ou contador/)).toBeInTheDocument();
  });

  it("o aviso do servidor chega inteiro à tela, não reescrito", () => {
    render(<PainelProximaDps dados={dados({ avisos: ["Esta empresa tem 2 perfis ativos e nenhum padrão."] })} />);
    expect(screen.getByText("Esta empresa tem 2 perfis ativos e nenhum padrão.")).toBeInTheDocument();
  });
});
