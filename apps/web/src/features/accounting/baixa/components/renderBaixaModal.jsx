import { useEffect, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { CONTA_JUROS, CONTA_MULTA, conferirPrincipalContraSaldo } from "../lib/principalDaBaixa";

// ⚠ `CONTA_JUROS`/`CONTA_MULTA` vêm de `lib/principalDaBaixa.js`, que também é quem espelha a regra
// do servidor. Eram literais "501"/"506" soltos aqui — quarta cópia de um código de conta que já
// divergia em três lugares.

const SUBTIPO_LABELS = {
  DAS: "DAS / Simples Nacional",
  IRRF: "IRRF",
  ISS: "ISS",
  PIS: "PIS",
  COFINS: "COFINS",
  // Mantido para lançamento ANTIGO que ainda não passou pelo script de separação — sem isto o modal
  // mostraria o subtipo cru na tela em vez do rótulo.
  PIS_COFINS: "PIS/COFINS (a separar)",
  FGTS: "FGTS",
  FERIAS: "Férias",
  DECIMO_TERCEIRO: "13º Salário",
  OUTROS_TRIBUTOS: "Outros Tributos",
};

function fmtMoney(val) {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const INPUT = {
  height: 32,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "0 var(--space-3)",
  font: "inherit",
  fontSize: "0.8125rem",
  background: "var(--bg-page)",
  color: "var(--text)",
  colorScheme: "dark",
};

/**
 * ⚠⚠ O CÓDIGO SOZINHO NÃO CONFERE NADA. Na tela que o dono mandou, as duas partidas da baixa
 * apareciam como "240" e "5" — dois números nus, num modal que grava lançamento contábil. O
 * `<datalist>` ajudava a DIGITAR e sumia depois: escolhido o código, não havia como saber se
 * "240" é a conta certa sem abrir o plano de contas em outra aba.
 *
 * Três respostas, e a terceira é a que importa: conta encontrada (mostra o nome), campo vazio
 * (não diz nada — é o estado normal de quem ainda não digitou) e **código que não está no plano
 * de contas**, que é dito com todas as letras. Silêncio ali faria um código inexistente parecer
 * conferido; o backend recusaria depois, com a baixa já preenchida.
 *
 * ⚠ `accounts` ausente ≠ plano vazio: sem a lista carregada não se afirma que a conta não existe.
 */
function NomeDaConta({ codigo, accounts }) {
  const cod = String(codigo || "").trim();
  if (!cod) return null;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const achada = accounts.find((a) => String(a.codigo) === cod);
  return (
    <div style={{
      fontSize: "0.7rem", marginTop: 2, lineHeight: 1.3,
      color: achada ? "var(--text-muted)" : "var(--state-warn)",
    }}>
      {achada ? achada.nome : "não está no plano de contas desta empresa"}
    </div>
  );
}

function LineEditor({ lines, onChange, accounts }) {
  function updateLine(idx, field, val) {
    onChange(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  }
  function removeLine(idx) {
    onChange(lines.filter((_, i) => i !== idx));
  }
  function addLine(tipo) {
    // Débito nasce como PRINCIPAL — mesmo default do backend para linha sem papel, então o que a
    // tela mostra é o que vai acontecer. Antes a linha nascia SEM papel e não havia como marcá-la:
    // o contador digitava juros como linha extra e o backend, por não ver papel, tratava tudo como
    // principal e devolvia um lançamento em bloco.
    onChange([...lines, { tipo, conta: "", valor: "", papel: tipo === "D" ? "PRINCIPAL" : undefined }]);
  }

  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const diff = Math.abs(totalD - totalC);
  const balanced = diff < 0.01;

  return (
    // minWidth:0 + overflowX próprio: se as colunas não couberem, quem rola é ESTA tabela,
    // não o modal inteiro (o pai agora é overflowX:hidden).
    <div style={{ marginTop: 8, overflowX: "auto", minWidth: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr style={{ background: "var(--bg-subtle)" }}>
            <th style={{ padding: "4px 6px", width: 52, textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>D/C</th>
            {/* O papel é o que decide se a baixa sai em um lançamento ou em três. Ficava invisível:
                só o pré-preenchimento sabia marcá-lo, e linha digitada à mão ia sem nada. */}
            <th style={{ padding: "4px 6px", width: 104, textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>Papel</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>Conta</th>
            <th style={{ padding: "4px 6px", width: 120, textAlign: "right", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>Valor (R$)</th>
            <th style={{ padding: "4px 6px", width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ padding: "2px 4px" }}>
                <select value={l.tipo} onChange={(e) => updateLine(i, "tipo", e.target.value)}
                  style={{ ...INPUT, width: 46, fontWeight: 700, color: l.tipo === "D" ? "var(--accent-cyan)" : "var(--state-ok)" }}>
                  <option value="D">D</option>
                  <option value="C">C</option>
                </select>
              </td>
              <td style={{ padding: "2px 4px" }}>
                {/* Só o débito tem papel — o crédito é sempre a contrapartida (caixa/banco), e cada
                    lançamento separado credita o SEU total. */}
                {l.tipo === "D" ? (
                  <select
                    value={l.papel || "PRINCIPAL"}
                    onChange={(e) => updateLine(i, "papel", e.target.value)}
                    title="Principal amortiza o passivo; juros e multa são despesa do mês do pagamento e viram lançamentos próprios."
                    style={{ ...INPUT, width: "100%" }}
                  >
                    <option value="PRINCIPAL">Principal</option>
                    <option value="JUROS">Juros</option>
                    <option value="MULTA">Multa</option>
                  </select>
                ) : (
                  /* ⚠ MESMA ALTURA DO `<select>` do débito. Era um `<span>` solto de 0.7rem numa
                     célula cuja vizinha tem 32px de campo: a linha do crédito subia alguns pixels
                     e as duas partidas da MESMA baixa não se liam como uma tabela. */
                  <span style={{
                    display: "inline-flex", alignItems: "center", height: 32,
                    fontSize: "0.7rem", color: "var(--text-faint)",
                  }}>
                    contrapartida
                  </span>
                )}
              </td>
              <td style={{ padding: "2px 4px" }}>
                <input
                  type="text"
                  value={l.conta}
                  onChange={(e) => updateLine(i, "conta", e.target.value)}
                  placeholder="Código da conta"
                  list={`baixa-accounts-${i}`}
                  style={{ ...INPUT, width: "100%" }}
                />
                {accounts?.length > 0 && (
                  <datalist id={`baixa-accounts-${i}`}>
                    {accounts.map((a) => (
                      <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>
                    ))}
                  </datalist>
                )}
                <NomeDaConta codigo={l.conta} accounts={accounts} />
              </td>
              <td style={{ padding: "2px 4px" }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.valor}
                  onChange={(e) => updateLine(i, "valor", e.target.value)}
                  placeholder="0,00"
                  style={{ ...INPUT, width: "100%", textAlign: "right" }}
                />
              </td>
              <td style={{ padding: "2px 4px", textAlign: "center" }}>
                {lines.length > 2 && (
                  <button onClick={() => removeLine(i)}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}>
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ padding: "4px 6px", fontSize: "0.75rem" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {/* ⚠⚠ OS DOIS ERAM COLORIDOS, E OS DOIS TOKENS QUERIAM DIZER OUTRA COISA.
                    *"+ Crédito"* saía em `--state-ok`, que nesta casa significa **concluído** — e a
                    regra escrita é que verde **nunca** é ação. *"+ Débito"* saía em
                    `--accent-cyan`, que aqui é o acento do **Simples Nacional** (`tokens.css:121`),
                    nada a ver com débito. Dois botões de AÇÃO vestidos com o vocabulário de estado e
                    de regime, um ao lado do outro.
                    ⚠ A distinção D × C não se perdeu: ela está na PALAVRA, que é onde ela sempre
                    esteve para quem lê. ⚠ Se o dono quiser um par de cores próprio para débito e
                    crédito, isso é token novo em `tokens.css` — não é emprestar dois que já têm
                    dono. */}
                <button onClick={() => addLine("D")}
                  style={{ fontSize: "0.7rem", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Débito
                </button>
                <button onClick={() => addLine("C")}
                  style={{ fontSize: "0.7rem", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Crédito
                </button>
              </div>
            </td>
            <td colSpan={2} style={{ padding: "4px 6px", textAlign: "right", fontSize: "0.75rem" }}>
              {balanced ? (
                <span style={{ color: "var(--success)", fontWeight: 700 }}>Balanceado</span>
              ) : (
                <span style={{ color: "#FF5757", fontWeight: 700 }}>Dif. R$ {fmtMoney(diff)}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// A data da baixa é o DIA DA CONFIRMAÇÃO (hoje) — pagamento se lança quando acontece.
// Antes o padrão era "dia 5 do mês seguinte à competência", o que jogava o lançamento para um
// mês diferente do atual (às vezes futuro), fora do mês que o contador está fechando.
// O campo segue editável para corrigir um pagamento feito em outro dia.

export function BaixaModal({ entry, accounts, onSave, onClose, saving, onLoadBaixaTemplate }) {
  const subtipoLabel = SUBTIPO_LABELS[entry.subtipo] || entry.subtipo || entry.tipo;
  const title = `Dar Baixa — ${subtipoLabel}`;

  const defaultHistorico = entry.subtipo
    ? `Pagamento ${SUBTIPO_LABELS[entry.subtipo] || entry.subtipo} ref. ${entry.competencia}`
    : `Pagamento ref. ${entry.competencia}`;

  const today = new Date().toISOString().slice(0, 10);
  const valorBase = Number(entry.valor || entry.totalD || 0);

  // Quando o pagamento já foi localizado no SERPRO, a data da BAIXA é a da arrecadação (não hoje)
  // e os valores vêm do comprovante — é o ponto do fluxo "buscar agora, lançar depois".
  const comprovante = entry?.comprovante?.confiavel ? entry.comprovante : null;
  const dataComprovante = (() => {
    const m = String(comprovante?.dataArrecadacao || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  })();
  const [data, setData] = useState(dataComprovante || today);
  const [historico, setHistorico] = useState(defaultHistorico);
  const [lines, setLines] = useState(() => {
    const entryLines = entry.lines || [];
    if (entryLines.length === 0) {
      return [{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }];
    }
    return entryLines.map((l) => ({
      tipo: l.tipo === "D" ? "C" : "D",
      conta: l.conta,
      valor: String(Number(l.valor).toFixed(2)),
    }));
  });
  const [error, setError] = useState("");
  const [templateApplied, setTemplateApplied] = useState(null); // "COMPANY" | "GLOBAL" | null
  const [acrescimo, setAcrescimo] = useState(null); // { juros, multa, total, conta } — guia recalculada (item 2)
  const [saldoInfo, setSaldoInfo] = useState(null); // { principal, abatido, saldo, quotasPagas } — baixa parcial
  const [quotaNumero, setQuotaNumero] = useState(1); // nº da quota desta baixa

  // Carrega template configurado (se houver) para pré-preencher
  useEffect(() => {
    if (!onLoadBaixaTemplate || !entry?.id) return;
    let canceled = false;
    onLoadBaixaTemplate(entry.id)
      .then((res) => {
        if (canceled) return;
        const acr = res?.acrescimo || null;
        setAcrescimo(acr);
        setSaldoInfo(res?.saldoInfo || null);
        setQuotaNumero(res?.quotaNumero || 1);
        const tpl = res?.template;
        // ⚠ Sem template NÃO se descarta o comprovante.
        //
        // Aqui havia `if (!tpl) return;` antes de qualquer uso do comprovante. Empresa sem folha
        // lançada devolve `template: null` (`reason: "sem_conta_folha"`), e com isso o rateio
        // INTEIRO — principal, juros e multa, já validado contra o total — ia para o lixo. O modal
        // abria com as duas linhas padrão e o contador salvava um bloco só, sem ver erro nenhum.
        //
        // O que falta sem template é apenas a CONTA de débito; os valores continuam válidos. Então
        // o pré-preenchimento acontece de qualquer jeito, com a conta em branco para o contador
        // escolher — que é infinitamente melhor que perder a separação.
        if (!tpl && !comprovante) return;

        // Baixa parcial: tpl.valor já vem como o SALDO restante (não o principal cheio).
        // Comprovante do SERPRO vence a estimativa da circular: são os valores efetivamente pagos.
        const principal = comprovante?.principal != null
          ? Number(comprovante.principal)
          : (Number(tpl?.valor || valorBase) || 0);
        const juros = comprovante?.juros != null ? Number(comprovante.juros) : (Number(acr?.juros) || 0);
        const multa = comprovante?.multa != null ? Number(comprovante.multa) : (Number(acr?.multa) || 0);
        const acrescimoTotal = Math.round((juros + multa) * 100) / 100;
        // Item 2: guia recalculada → cada acréscimo na sua conta de despesa (juros 501, multa 506);
        // o crédito (caixa) sai pelo TOTAL pago (principal + juros + multa).
        // `papel` marca o que cada linha representa. O backend usa isso pra separar a baixa em
        // lançamentos independentes (principal / juros / multa) — derivar pelo número da conta não
        // serviria, porque o contador pode trocar a conta aqui no modal.
        //
        // ⚠ `acr?.` — SEM o optional chaining isto derrubava tudo em silêncio. Quando o acréscimo
        // vem do COMPROVANTE e não da circular, `res.acrescimo` é `null`, e `acr.contaJuros`
        // lançava `TypeError` — engolido pelo `.catch()` lá embaixo. `setLines` nunca rodava, o
        // modal ficava com as duas linhas padrão, e o contador não via erro nenhum: via um modal
        // "normal" que produzia um lançamento em bloco.
        const newLines = [{ tipo: "D", conta: tpl?.debitAccountCode || "", valor: principal.toFixed(2), papel: "PRINCIPAL" }];
        if (juros > 0) newLines.push({ tipo: "D", conta: acr?.contaJuros || CONTA_JUROS, valor: juros.toFixed(2), papel: "JUROS" });
        if (multa > 0) newLines.push({ tipo: "D", conta: acr?.contaMulta || CONTA_MULTA, valor: multa.toFixed(2), papel: "MULTA" });
        newLines.push({ tipo: "C", conta: tpl?.creditAccountCode || "", valor: (principal + acrescimoTotal).toFixed(2), papel: "CAIXA" });
        setLines(newLines);
        if (tpl?.historico) setHistorico(tpl.historico);
        if (tpl) setTemplateApplied(tpl.scope || "GLOBAL");
      })
      .catch(() => { /* silencioso — fallback ao comportamento manual */ });
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.01 && totalD > 0;
  // ⚠ BALANCEADO NÃO É SUFICIENTE, e era só isso que o botão conferia.
  // Comprovante do SERPRO com principal maior que a provisão (guia RECALCULADA, acréscimo embutido e
  // não quebrado) monta `D X / C X` — balanceado — e o servidor recusa com `baixa_excede_saldo`.
  // A conferência é a MESMA do servidor, em `lib/principalDaBaixa.js`; quem recusa continua sendo
  // ele. Sem `saldoInfo` isto devolve `null` e nada é afirmado.
  const excedeSaldo = conferirPrincipalContraSaldo(lines, saldoInfo);
  const canSave = data && historico && balanced && !excedeSaldo && !saving;
  const motivoNaoSalva = !data
    ? "Informe a data do pagamento."
    : !historico
      ? "Informe o histórico."
      : !balanced
        ? "As partidas não fecham (Σ D ≠ Σ C)."
        : excedeSaldo
          ? `${excedeSaldo.motivo} ${excedeSaldo.saida}`
          : "";

  async function handleSave() {
    if (!canSave) return;
    setError("");
    try {
      await onSave({
        data,
        historico,
        // `papel` só existe nas linhas que o template gerou; linha adicionada à mão vai sem ele
        // (o backend trata como principal). Não atrapalha quem ignora o campo.
        lines: lines.map((l, i) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: i, papel: l.papel || null })),
      });
    } catch (err) {
      setError(err?.message || "Falha ao registrar baixa.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
    }}>
      <div style={{
        background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)",
        // Largura suficiente pra tabela de partidas caber SEM scroll lateral (era 560px).
        boxShadow: "0 8px 32px rgba(0,0,0,0.16)", width: "min(96vw, 860px)",
        // overflow:"auto" valia para os DOIS eixos: a tabela de partidas (colunas fixas) estourava
        // e o modal inteiro rolava lateralmente. Agora só o eixo Y rola no modal; quem rola em X é
        // o wrapper da tabela (abaixo). Mesmo tratamento do CircularEntryEditModal.
        maxHeight: "90vh", overflowY: "auto", overflowX: "hidden",
        padding: "var(--space-5)", boxSizing: "border-box",
        // Sem isso, um texto longo sem espaços (código, mensagem do SERPRO) empurra a largura
        // e reintroduz a barra horizontal mesmo com o modal largo.
        overflowWrap: "anywhere",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>{title}</h2>
            {templateApplied && (
              <span style={{ fontSize: "0.7rem", color: "#16a34a", display: "inline-block", marginTop: 4 }}>
                ✓ Pré-preenchido com regra {templateApplied === "COMPANY" ? "da empresa" : "global"}
              </span>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
        </div>

        {/* Baixa parcial por quota: mostra saldo restante quando a provisão já teve quotas pagas */}
        {saldoInfo && saldoInfo.abatido > 0.009 && saldoInfo.saldo > 0.009 && (
          <div style={{ background: "rgba(120,170,255,0.12)", border: "1px solid #6EA8FF", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem" }}>
            💠 Pagamento por quota — <strong>quota {quotaNumero}</strong>. Provisão R$ {saldoInfo.principal.toFixed(2)} ·
            já pago R$ {saldoInfo.abatido.toFixed(2)} · <strong>saldo R$ {saldoInfo.saldo.toFixed(2)}</strong>.
            O valor sugerido é o saldo; reduza o principal se for pagar só uma parte.
          </div>
        )}

        {/* Item 2: aviso de guia recalculada (juros → 501, multa → 506) */}
        {acrescimo && acrescimo.total > 0 && (
          <div style={{ background: "rgba(255,110,110,0.12)", border: "1px solid #FF6E6E", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem" }}>
            ⚠ Guia recalculada — acréscimo de <strong>R$ {acrescimo.total.toFixed(2)}</strong>:
            {acrescimo.juros > 0 && <> juros R$ {acrescimo.juros.toFixed(2)} → conta <strong>{acrescimo.contaJuros || "501"}</strong></>}
            {acrescimo.juros > 0 && acrescimo.multa > 0 && " · "}
            {acrescimo.multa > 0 && <> multa R$ {acrescimo.multa.toFixed(2)} → conta <strong>{acrescimo.contaMulta || "506"}</strong></>}
            . O crédito (caixa) sai pelo total pago (principal + juros + multa).
          </div>
        )}

        {/* Info da provisão */}
        <div style={{
          background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6,
          padding: "8px 12px", marginBottom: 16, fontSize: "0.8125rem",
        }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><strong>Competência:</strong> {entry.competencia}</span>
            <span><strong>Histórico:</strong> {entry.historico}</span>
            <span><strong>Valor provisionado:</strong> R$ {fmtMoney(entry.valor || entry.totalD)}</span>
          </div>
        </div>

        {/* ⚠ A RECUSA TEM O MESMO PESO VISUAL DO RESTO — ela é o que separa "não funciona" de
            "não pode, e por isto". O bloco diz o MOTIVO e a SAÍDA; recusa muda é o defeito. */}
        {excedeSaldo && (
          <div style={{
            background: "var(--state-danger-surface, rgba(255,87,87,0.12))",
            border: "1px solid var(--state-danger, #FF5757)",
            borderRadius: 6, padding: "10px 12px", marginBottom: 12, fontSize: "0.8125rem",
          }}>
            <strong>Esta baixa não pode ser registrada.</strong> {excedeSaldo.motivo}
            <div style={{ marginTop: 6, opacity: 0.9 }}>{excedeSaldo.saida}</div>
          </div>
        )}

        {error && <p style={{ color: "var(--danger)", margin: "0 0 12px", fontSize: "0.875rem" }}>{error}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginBottom: 8 }}>
          <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", display: "grid", gap: 4 }}>
            Data do pagamento
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={{ ...INPUT, width: "100%" }}
            />
          </label>
          <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", display: "grid", gap: 4 }}>
            Histórico
            <input
              type="text"
              value={historico}
              onChange={(e) => setHistorico(e.target.value)}
              style={{ ...INPUT, width: "100%" }}
            />
          </label>
        </div>

        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
          Partidas (contrapartida da provisão)
        </div>
        <LineEditor lines={lines} onChange={setLines} accounts={accounts} />

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {/* O botão desabilitado NOMEIA o motivo — nascer mudo é o que faz "não faz nada". */}
          <Button variant="primary" onClick={handleSave} disabled={!canSave} title={motivoNaoSalva || undefined}>
            {saving ? "Registrando..." : "Confirmar Baixa"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
