// WIZARD — a ficha de pré-cadastro, preenchida pelo escritório.
//
// ⚠ LARGURA: `--content-max` (leitura/formulário), não `--content-wide`. Linha longa demais em
// formulário cansa; a largura de trabalho é para tela de dados.
//
// O rascunho é salvo A CADA TELA e com debounce dentro da tela — F5 no meio não perde nada.

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { CartaoEmpresaBrasilApi } from "../components/CartaoEmpresaBrasilApi";
import { PassoOrigem } from "../components/PassoOrigem";
import { PassoRevisao } from "../components/PassoRevisao";
import { TrilhaPassos } from "../components/TrilhaPassos";
import { useOnboardingRascunho } from "../hooks/useOnboardingRascunho";
import { consultarCnpj, soDigitosCnpj } from "../lib/brasilApi";
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

export function OnboardingWizardPage({ api, onboardingId, onVoltar, onAbrirDetalhe }) {
  const rascunho = useOnboardingRascunho({ api, onboardingId });
  const { onboarding, dados, estadoSalvamento } = rascunho;
  const origem = onboarding?.origem || null;

  const [passo, setPasso] = useState("origem");
  const [errosDoPasso, setErrosDoPasso] = useState({});
  const [consultaCnpj, setConsultaCnpj] = useState(null);
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

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
    // Salva ao trocar de tela — o debounce sozinho perderia a última digitação.
    if (origem) await rascunho.salvarAgora({ ultimoPasso: destino }).catch(() => {});
    setErrosDoPasso({});
    setPasso(destino);
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
      const ok = window.confirm(
        `Trocar para "${nomeNova}" apaga o que já foi preenchido nesta ficha `
        + `(${preenchidos} ${preenchidos === 1 ? "campo preenchido" : "campos preenchidos"}), `
        + "porque cada origem faz perguntas diferentes.\n\nTrocar mesmo assim?"
      );
      if (!ok) return;
    }
    await rascunho.trocarOrigem(nova);
    setConsultaCnpj(null);
    await irPara("identificacao");
  }

  async function consultarReceita() {
    setConsultandoCnpj(true);
    const r = await consultarCnpj(dados.cnpj);
    setConsultandoCnpj(false);
    setConsultaCnpj(r);
  }

  function aplicarConsulta() {
    const e = consultaCnpj?.empresa;
    if (!e) return;
    if (e.razaoSocial) rascunho.alterarCampo("razaoSocial", e.razaoSocial);
    if (e.nomeFantasia) rascunho.alterarCampo("nomeFantasia", e.nomeFantasia);
    setConsultaCnpj(null);
  }

  async function finalizar() {
    setFinalizando(true);
    try {
      const registro = await rascunho.finalizar();
      onAbrirDetalhe?.(registro?.id || onboardingId);
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

  return (
    <PageShell
      title="Novo onboarding"
      subtitle={onboarding?.razaoSocial || "Ficha de pré-cadastro"}
      onBack={onVoltar}
      backLabel="Onboardings"
      actions={
        <span style={{ fontSize: 12, color: estadoSalvamento === "erro" ? "var(--state-warn)" : "var(--text-faint)" }}>
          {ROTULO_SALVAMENTO[estadoSalvamento]}
        </span>
      }
      contentStyle={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}
    >
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
          {passo === "identificacao" && (consultaCnpj || consultandoCnpj) && (
            <CartaoEmpresaBrasilApi
              consulta={consultaCnpj}
              carregando={consultandoCnpj}
              onConfirmar={aplicarConsulta}
              onRecusar={() => setConsultaCnpj(null)}
            />
          )}

          {campos.map((descritor) => (
            <CampoOnboarding
              key={`${descritor.passo}-${descritor.campo}`}
              descritor={descritor}
              dados={dados}
              valor={dados[descritor.campo]}
              erro={errosDoPasso[descritor.campo]}
              origemPreenchimento={onboarding?.origemPreenchimento}
              onChange={(valor) => rascunho.alterarCampo(descritor.campo, valor)}
              acaoExtra={
                descritor.consultaReceita ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={consultarReceita}
                    disabled={consultandoCnpj || soDigitosCnpj(dados[descritor.campo]).length !== 14}
                  >
                    consultar Receita
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex", gap: "var(--space-2)", justifyContent: "space-between",
          marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          type="button"
          variant="secondary"
          disabled={indice <= 0}
          onClick={() => irPara(passos[Math.max(indice - 1, 0)].chave)}
        >
          Voltar
        </Button>

        {ehUltimo ? (
          <Button type="button" onClick={finalizar} disabled={finalizando || !origem}>
            {finalizando ? "finalizando…" : "Finalizar e abrir a trilha"}
          </Button>
        ) : (
          <Button type="button" onClick={avancar} disabled={!origem}>
            Avançar
          </Button>
        )}
      </div>
    </PageShell>
  );
}

export default OnboardingWizardPage;
