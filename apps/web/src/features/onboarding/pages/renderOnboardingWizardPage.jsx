// WIZARD — a ficha de pré-cadastro, preenchida pelo escritório.
//
// ⚠ LARGURA: `--content-max` (leitura/formulário), não `--content-wide`. Linha longa demais em
// formulário cansa; a largura de trabalho é para tela de dados.
//
// O rascunho é salvo antes de navegar e com debounce; ao fechar com pendência há aviso nativo.

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { useConfirmacao } from "../../../components/ui/useConfirmacao";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { ConsultaCnpjOnboarding } from "../components/ConsultaCnpjOnboarding";
import { useConsultaCnpjOnboarding } from "../hooks/useConsultaCnpjOnboarding";
import { PassoOrigem } from "../components/PassoOrigem";
import { PassoRevisao } from "../components/PassoRevisao";
import { TrilhaPassos } from "../components/TrilhaPassos";
import { useOnboardingRascunho } from "../hooks/useOnboardingRascunho";

import {
  ONBOARDING_ORIGENS,
  camposDoPasso,
  passosVisiveis,
  problemasDoPasso,
} from "../lib/onboardingSpec";
import { validarPasso } from "../lib/onboardingZod";

const ROTULO_SALVAMENTO = {
  salvo: "rascunho salvo",
  salvando: "salvando…",
  pendente: "alterações não salvas",
  erro: "falha ao salvar",
};

export function OnboardingWizardPage({ api, onboardingId, onVoltar, onAbrirDetalhe, embedded = false, onRegistrarSaida }) {
  const { pedir: confirmar, dialogo: confirmacao } = useConfirmacao();
  const rascunho = useOnboardingRascunho({ api, onboardingId });
  const { onboarding, dados, estadoSalvamento } = rascunho;
  const origem = onboarding?.origem || null;

  const [passo, setPasso] = useState("origem");
  const [errosDoPasso, setErrosDoPasso] = useState({});
  const cnpj = useConsultaCnpjOnboarding({ contexto: onboardingId, origem, dados, alterarCampo: rascunho.alterarCampo, habilitado: !rascunho.carregando });
  const [finalizando, setFinalizando] = useState(false);
  const [navegando, setNavegando] = useState(false);
  useEffect(() => {
    onRegistrarSaida?.(() => rascunho.salvarAgora({ ultimoPasso: passo }));
    return () => onRegistrarSaida?.(null);
  }, [onRegistrarSaida, rascunho.salvarAgora, passo]);

  // Reabre onde o preenchimento parou — é para isso que `ultimoPasso` existe.
  useEffect(() => {
    if (onboarding && passo === "origem" && onboarding.ultimoPasso) {
      setPasso(onboarding.ultimoPasso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding?.id]);

  const passos = useMemo(() => passosVisiveis(origem), [origem]);

  const pendenciasPorPasso = useMemo(() => {
    const out = {};
    for (const p of passos) {
      if (p.chave === "origem") continue;
      out[p.chave] = problemasDoPasso(origem, p.chave, dados).length;
    }
    return out;
  }, [passos, origem, dados]);

  const indice = passos.findIndex((p) => p.chave === passo);
  const ehUltimo = indice === passos.length - 1;

  async function irPara(destino) {
    if (navegando) return;
    setNavegando(true);
    try {
      if (origem) await rascunho.salvarAgora({ ultimoPasso: destino });
      setErrosDoPasso({});
      setPasso(destino);
    } catch { /* Mantém passo e campos para nova tentativa. */ }
    finally { setNavegando(false); }
  }

  async function salvarEVoltar() {
    if (navegando) return;
    setNavegando(true);
    try {
      await rascunho.salvarAgora({ ultimoPasso: passo });
      onVoltar?.();
    } catch { /* A mensagem persistente explica por que a página continua aberta. */ }
    finally { setNavegando(false); }
  }

  async function avancar() {
    if (passo !== "origem") {
      // A validação ACENDE o campo, não bloqueia: o funil aceita preenchimento parcial por
      // definição. Bloquear aqui transformaria "cliente que ainda não mandou o documento" em
      // "ficha que não pode ser salva".
      const { erros } = validarPasso(origem, dados, passo);
      setErrosDoPasso(erros);
    }
    const proximo = passos[Math.min(indice + 1, passos.length - 1)];
    await irPara(proximo.chave);
  }

  async function escolherOrigem(nova) {
    if (!origem) {
      await rascunho.trocarOrigem(nova);
      await irPara("identificacao");
      return;
    }
    if (nova === origem) {
      await irPara("identificacao");
      return;
    }
    // ⚠ Confirmação NOMEANDO o que se perde — no espírito do EmitirNfseWizard. As perguntas de
    // cada origem são diferentes, então trocar zera o rascunho (e o servidor zera também).
    const preenchidos = Object.entries(dados).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== null && String(v ?? "").trim() !== ""
    ).length;
    const nomeNova = ONBOARDING_ORIGENS.find((o) => o.chave === nova)?.titulo || nova;
    if (preenchidos > 0) {
      const ok = await confirmar({ titulo: "Trocar origem do onboarding", texto: `Trocar para “${nomeNova}” apaga ${preenchidos} campo(s) preenchido(s) nesta ficha, porque cada origem faz perguntas diferentes.`, acao: "Trocar e limpar ficha", perigo: true });
      if (!ok) return;
    }
    await rascunho.trocarOrigem(nova);

    await irPara("identificacao");
  }

  async function finalizar() {
    setFinalizando(true);
    try {
      const registro = await rascunho.finalizar();
      await onAbrirDetalhe?.(registro?.id || onboardingId);
    } catch {
      // o estado de erro já aparece no selo de salvamento
    } finally {
      setFinalizando(false);
    }
  }

  if (rascunho.carregando) {
    return (
      <PageShell title="Novo onboarding" onBack={onVoltar}>
        <p style={{ color: "var(--text-muted)" }}>Carregando…</p>
      </PageShell>
    );
  }

  if (rascunho.erro && !onboarding) {
    return (
      <PageShell title="Novo onboarding" onBack={onVoltar}>
        <p style={{ color: "var(--state-warn)" }}>{rascunho.erro.message}</p>
      </PageShell>
    );
  }

  const campos = origem && passo !== "origem" && passo !== "revisao"
    ? camposDoPasso(origem, passo, dados)
    : [];

  const Shell = embedded ? EmbeddedShell : PageShell;
  return (
    <Shell
      title="Novo onboarding"
      subtitle={onboarding?.razaoSocial || "Ficha de pré-cadastro"}
      onBack={salvarEVoltar}
      backLabel="Onboardings"
      actions={
        <span style={{ fontSize: 12, color: estadoSalvamento === "erro" ? "var(--state-warn)" : "var(--text-faint)" }}>
          {ROTULO_SALVAMENTO[estadoSalvamento]}
        </span>
      }
      contentClassName="onboarding-workspace onboarding-wizard"
      contentStyle={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}
    >
      {estadoSalvamento === "erro" && <p role="alert" style={{ color: "var(--state-warn)" }}>Não foi possível salvar. Seus campos continuam nesta tela. Tente novamente antes de sair. {rascunho.erro?.message}</p>}
      <TrilhaPassos
        passos={passos}
        passoAtual={passo}
        pendenciasPorPasso={pendenciasPorPasso}
        onIr={irPara}
      />

      {passo === "origem" && <PassoOrigem origem={origem} onEscolher={escolherOrigem} />}

      {passo === "revisao" && origem && (
        <PassoRevisao
          origem={origem}
          dados={dados}
          origemPreenchimento={onboarding?.origemPreenchimento}
          onIrPara={irPara}
        />
      )}

      {campos.length > 0 && (
        <div>
          {passo === "identificacao" && <ConsultaCnpjOnboarding consulta={cnpj.consulta} carregando={cnpj.carregando} cadastro={dados.cadastroCnpj} />}

          {campos.map((descritor) => (
            <CampoOnboarding
              key={`${descritor.passo}-${descritor.campo}`}
              descritor={descritor}
              dados={dados}
              valor={dados[descritor.campo]}
              erro={errosDoPasso[descritor.campo]}
              origemPreenchimento={onboarding?.origemPreenchimento}
              onChange={(valor) => cnpj.editar(descritor.campo, valor)}
              acaoExtra={
                descritor.consultaReceita ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={cnpj.consultar}
                    disabled={cnpj.carregando || !cnpj.permitido}
                  >
                    Consultar novamente
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      )}

      <div
        className="onboarding-wizard__actions"
        style={{
          display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "space-between",
          marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          type="button"
          variant="secondary"
          disabled={indice <= 0 || navegando || finalizando}
          onClick={() => irPara(passos[Math.max(indice - 1, 0)].chave)}
        >
          Voltar
        </Button>

        {ehUltimo ? (
          <Button type="button" onClick={finalizar} disabled={finalizando || navegando || !origem}>
            {finalizando ? "finalizando…" : "Salvar e continuar atendimento"}
          </Button>
        ) : (
          <Button type="button" onClick={avancar} disabled={!origem || navegando || finalizando}>
            Avançar
          </Button>
        )}
      </div>
      {confirmacao}
    </Shell>
  );
}

function EmbeddedShell({ children }) { return <div className="onboarding-wizard">{children}</div>; }

export default OnboardingWizardPage;
