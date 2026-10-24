import { formatarValor } from './PassoRevisao.shared.js';
import { Button } from "../../../components/ui/Button";
// Revisão — a ficha inteira relida, PERCORRENDO A MESMA SPEC do wizard.
//
// É a garantia de que o que a tela mostra é exatamente o que foi perguntado, na ordem em que foi
// perguntado. Reescrever a lista à mão aqui faria a revisão divergir do formulário — e é a revisão
// que o contador confere antes de finalizar.

import { ONBOARDING_PASSOS, camposDoPasso, problemasDoRascunho } from "../lib/onboardingSpec";
import { SeloDeclarado } from "./SeloDeclarado";


export function FichaDeclarada({ origem, dados, origemPreenchimento, compacta = false }) {
  const passos = ONBOARDING_PASSOS.filter((p) => p.chave !== "origem" && p.chave !== "revisao");

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      {origem === 'ABERTURA' && dados?.enderecoPretendido && <p>Endereço informado anteriormente: {dados.enderecoPretendido}</p>}
      {passos.map((passo) => {
        const campos = camposDoPasso(origem, passo.chave, dados);
        if (!campos.length) return null;
        return (
          <section key={passo.chave}>
            <h3
              style={{
                margin: "0 0 var(--space-2)", fontSize: 13, textTransform: "uppercase",
                letterSpacing: 0.5, color: "var(--text-faint)",
              }}
            >
              {passo.titulo}
            </h3>
            <div style={{ display: "grid", gap: 6 }}>
              {campos.map((descritor) => {
                const texto = formatarValor(descritor, dados?.[descritor.campo]);
                return (
                  <div
                    key={`${descritor.passo}-${descritor.campo}`}
                    className={`onboarding-review-row${compacta ? " onboarding-review-row--compact" : ""}`}
                    style={{
                      display: "grid",
                      gap: "var(--space-2)",
                      alignItems: "baseline",
                      padding: "4px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{descritor.rotulo}</span>
                      {descritor.sensivel && texto && (
                        <SeloDeclarado origemPreenchimento={origemPreenchimento} />
                      )}
                    </span>
                    {/* ⚠ Campo em branco NÃO some: some da tela quem não respondeu e ninguém sabe
                        se foi resposta vazia ou pergunta que nunca foi feita. */}
                    <span style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 13, color: texto ? "var(--text)" : "var(--text-faint)" }}>
                      {texto || "— não informado —"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function PassoRevisao({ origem, dados, origemPreenchimento, onIrPara }) {
  const problemas = problemasDoRascunho(origem, dados);

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      {problemas.length > 0 && (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--state-warn)",
            borderLeft: "3px solid var(--state-warn)",
            display: "grid",
            gap: "var(--space-2)",
          }}
        >
          <strong style={{ color: "var(--state-warn)", fontSize: 13 }}>
            {problemas.length === 1 ? "1 campo obrigatório em branco" : `${problemas.length} campos obrigatórios em branco`}
          </strong>
          {/* ⚠ Isto NÃO bloqueia finalizar. O funil aceita preenchimento parcial — é a razão de
              ele existir. A lista serve para o contador saber o que vai faltar depois. */}
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Salve o rascunho para continuar depois. Para concluir uma ficha empresarial, identifique ao menos uma pessoa com nome e CPF válidos.
          </span>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
            {problemas.map((p) => (
              <li key={`${p.passo}-${p.campo}`} style={{ fontSize: 13 }}>
                <Button variant="secondary" size="sm"
                  type="button"
                  onClick={() => onIrPara?.(p.passo)}
                >
                  {p.rotulo}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FichaDeclarada origem={origem} dados={dados} origemPreenchimento={origemPreenchimento} />
    </div>
  );
}

export default PassoRevisao;
