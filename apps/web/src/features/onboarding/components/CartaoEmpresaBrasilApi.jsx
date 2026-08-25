// "É essa empresa?" — a confirmação do CNPJ consultado na Receita.
//
// ⚠ O CAMINHO DE FALHA É REQUISITO, NÃO POLIMENTO. A chamada sai do browser, sem proxy: cai com
// rede corporativa, bloqueador de conteúdo, offline e throttle. Quando cai, o cartão dá lugar a um
// aviso em `--state-warn` e o formulário continua preenchível à mão.
//
// ⚠ E A ESCAPATÓRIA MANUAL EXISTE TAMBÉM NO SUCESSO. Uma consulta bem-sucedida do CNPJ ERRADO
// trancaria o usuário em campos somente-leitura sem saída — por isso o botão "Não é essa".
//
// ⚠ SITUAÇÃO ≠ ATIVA (BAIXADA / INAPTA / SUSPENSA) muda a conversa inteira e vem de graça na mesma
// resposta. Fica em `--state-warn`, não em vermelho: é informação que muda o trabalho, não um
// bloqueio.

import { Button } from "../../../components/ui/Button";

function Linha({ rotulo, valor }) {
  if (!valor) return null;
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ minWidth: 130, fontSize: 12, color: "var(--text-muted)" }}>{rotulo}</span>
      <strong style={{ fontSize: 13, color: "var(--text)" }}>{valor}</strong>
      {/* A marca discreta da fonte: o dado veio de fora, e quem lê precisa saber de onde. */}
      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>← Receita Federal</span>
    </div>
  );
}

export function CartaoEmpresaBrasilApi({ consulta, onConfirmar, onRecusar, carregando }) {
  if (carregando) {
    return (
      <div style={caixaStyle("var(--border)")}>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Consultando a Receita…</span>
      </div>
    );
  }

  if (!consulta) return null;

  // ── Falha: bloco editável com faixa de aviso ───────────────────────────────
  if (!consulta.ok) {
    return (
      <div style={{ ...caixaStyle("var(--state-warn)"), borderLeft: "3px solid var(--state-warn)" }}>
        <strong style={{ color: "var(--state-warn)", fontSize: 13 }}>
          {consulta.motivo === "nao_encontrado" ? "CNPJ não encontrado" : "Consulta indisponível"}
        </strong>
        <span style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {consulta.mensagem}
        </span>
        <div>
          <Button variant="secondary" size="sm" onClick={onRecusar} type="button">
            Preencher à mão
          </Button>
        </div>
      </div>
    );
  }

  const { empresa, situacao } = consulta;

  return (
    <div style={caixaStyle("var(--border)")}>
      <strong style={{ fontSize: 14, color: "var(--text)" }}>É essa empresa?</strong>

      <div style={{ display: "grid", gap: 6 }}>
        <Linha rotulo="Razão social" valor={empresa.razaoSocial} />
        <Linha rotulo="Nome fantasia" valor={empresa.nomeFantasia} />
        <Linha rotulo="Município / UF" valor={[empresa.municipio, empresa.uf].filter(Boolean).join(" / ")} />
        <Linha rotulo="Abertura" valor={empresa.dataAbertura} />
        <Linha rotulo="Porte" valor={empresa.porte} />
      </div>

      {situacao?.texto && !situacao.ativa && (
        <div
          style={{
            display: "flex", gap: "var(--space-2)", alignItems: "baseline",
            padding: "6px 10px", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--state-warn)", color: "var(--state-warn)", fontSize: 13,
          }}
        >
          <span aria-hidden="true">!</span>
          <span>
            Situação cadastral: <strong>{situacao.texto}</strong>
            {situacao.motivo ? ` (${situacao.motivo})` : ""}
            {situacao.data ? ` desde ${situacao.data}` : ""}.
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {/* ⚠ Primária em `--primary`, NÃO em verde: verde é "concluído", nunca ação primária. */}
        <Button variant="primary" size="sm" onClick={onConfirmar} type="button">
          Sim, é essa
        </Button>
        <Button variant="secondary" size="sm" onClick={onRecusar} type="button">
          Não é essa / preencher à mão
        </Button>
      </div>
    </div>
  );
}

function caixaStyle(corBorda) {
  return {
    display: "grid",
    gap: "var(--space-3)",
    padding: "var(--space-4)",
    borderRadius: "var(--radius)",
    border: `1px solid ${corBorda}`,
    background: "var(--bg-subtle)",
    marginBottom: "var(--space-4)",
  };
}

export default CartaoEmpresaBrasilApi;
