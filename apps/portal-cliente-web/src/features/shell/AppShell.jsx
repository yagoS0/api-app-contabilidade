import { useMemo, useState } from "react";
import { api } from "../../api";
import { limparSessao, lerEmpresaSalva, salvarEmpresa } from "../../api/sessionStore";
import { AlertaErro, Carregando, Vazio } from "../../components/ui";
import { useCarregamento, useRota } from "../../lib/hooks";
import { fmtCnpj, texto } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { SeletorEmpresa } from "./SeletorEmpresa";
import { HomePage } from "../home/HomePage";
import { NotasPage } from "../notas/NotasPage";
import { GuiasPage } from "../guias/GuiasPage";

const ABAS = [
  { chave: "home", rotulo: "Início" },
  { chave: "notas", rotulo: "Notas" },
  { chave: "guias", rotulo: "Guias" },
];

export function AppShell({ user }) {
  const { rota, navegar } = useRota();
  const [empresaEscolhida, setEmpresaEscolhida] = useState(() => lerEmpresaSalva());
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const empresasQuery = useCarregamento(() => api.getCompanies(), []);
  const empresas = empresasQuery.dados || [];

  // Empresa ativa: a escolhida, se ainda for válida; senão a `defaultClientId`
  // do login; senão a primeira. ⚠ A validação contra a lista importa: um id
  // salvo de um acesso anterior (ou de outro usuário na mesma máquina) não pode
  // sobreviver à troca de conta.
  const empresaAtiva = useMemo(() => {
    if (!empresas.length) return null;
    return (
      empresas.find((e) => e.companyId === empresaEscolhida) ||
      empresas.find((e) => e.companyId === user?.defaultClientId) ||
      empresas[0]
    );
  }, [empresas, empresaEscolhida, user?.defaultClientId]);

  function escolherEmpresa(companyId) {
    setEmpresaEscolhida(companyId);
    salvarEmpresa(companyId);
    setSeletorAberto(false);
  }

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await api.logout();
    } finally {
      // A sessão local some mesmo se o servidor não responder: "Sair" que não
      // sai é pior que erro visível, sobretudo em computador compartilhado.
      salvarEmpresa(null);
      limparSessao();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Portal do Cliente</span>

        <div className="empresa">
          {empresaAtiva ? (
            <>
              <div className="empresa-nome" title={texto(empresaAtiva.razao)}>
                {texto(empresaAtiva.razao)}
              </div>
              <div className="empresa-cnpj">
                {fmtCnpj(empresaAtiva.cnpj)}
                {empresaAtiva.myRole ? ` · ${roleLabel(empresaAtiva.myRole)}` : ""}
              </div>
            </>
          ) : (
            <div className="empresa-cnpj">{empresasQuery.carregando ? "Carregando empresas…" : ""}</div>
          )}
        </div>

        <div className="topbar-actions">
          {empresas.length > 1 ? (
            <button type="button" className="btn" onClick={() => setSeletorAberto(true)}>
              Trocar empresa
            </button>
          ) : null}
          <button type="button" className="btn" onClick={sair} disabled={saindo}>
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      <nav className="nav" aria-label="Seções">
        {ABAS.map((aba) => (
          <button
            key={aba.chave}
            type="button"
            aria-current={rota === aba.chave ? "page" : undefined}
            onClick={() => navegar(aba.chave)}
          >
            {aba.rotulo}
          </button>
        ))}
      </nav>

      <main className="page">
        {empresasQuery.carregando ? (
          <Carregando>Carregando suas empresas…</Carregando>
        ) : empresasQuery.erro ? (
          <AlertaErro
            erro={empresasQuery.erro}
            padrao="Não foi possível carregar suas empresas."
            aoTentarNovamente={empresasQuery.recarregar}
          />
        ) : !empresaAtiva ? (
          <Vazio>
            Nenhuma empresa está vinculada ao seu acesso. Fale com o seu contador para liberar.
          </Vazio>
        ) : rota === "notas" ? (
          <NotasPage empresa={empresaAtiva} />
        ) : rota === "guias" ? (
          <GuiasPage empresa={empresaAtiva} />
        ) : (
          <HomePage empresa={empresaAtiva} aoNavegar={navegar} />
        )}
      </main>

      {seletorAberto ? (
        <SeletorEmpresa
          empresas={empresas}
          ativaId={empresaAtiva?.companyId || null}
          aoEscolher={escolherEmpresa}
          aoFechar={() => setSeletorAberto(false)}
        />
      ) : null}
    </div>
  );
}
