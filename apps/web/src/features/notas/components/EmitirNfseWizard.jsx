// EMISSÃO DE NFS-e — o assistente.
//
// ⚠ NÃO EXISTE CAMINHO QUE PULE O PREVIEW.
// Emitir uma nota é ato fiscal IRREVERSÍVEL: uma vez autorizada, o desfazer é um cancelamento com
// justificativa, sujeito a prazo da prefeitura — quando a prefeitura aceita. Por isso o passo 4 não
// é uma tela de "revisar se quiser": é a única porta para o botão Emitir, e o botão só aparece lá.
// O confirm final repete valor e tomador no texto (regra 5), porque "tem certeza?" não diz o que
// vai ser emitido.
//
// ⚠ OS CAMPOS SÃO OS DO BACKEND, não uma invenção da tela.
// Tudo aqui espelha `application/validators/nfsePayload.js`:
//   tomador  { cnpjCpf, nome, email?, endereco? { cMun, CEP, xLgr, nro, xCpl?, xBairro } }
//   servico  { descricao, valorServicos, aliquota?, issRetido? }
//   competencia?, referencia?, totTrib? { pTotTribSN }
// O endereço do tomador é OPCIONAL para o validador, mas ele só é aceito COMPLETO: faltando um
// pedaço, o backend descarta o endereço inteiro (`hasEnderecoTomador`). Então a tela trata o bloco
// como tudo-ou-nada e diz isso — meio endereço preenchido viraria nota sem endereço, em silêncio.

import { useMemo, useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";

const PASSOS = ["Tomador", "Serviço", "Valores", "Conferir"];

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const fmtBRL = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function formatarDoc(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc || "";
}

const campo = {
  background: "#1A1B26", border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "8px 10px", fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
};
const rotulo = { display: "grid", gap: 4, fontSize: "0.78rem", color: PANEL.muted };

export function EmitirNfseWizard({ companyId, onEmitir, onClose, onEmitida }) {
  const [passo, setPasso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState(null);

  const [tomador, setTomador] = useState({ cnpjCpf: "", nome: "", email: "" });
  const [endereco, setEndereco] = useState({ cMun: "", CEP: "", xLgr: "", nro: "", xCpl: "", xBairro: "" });
  const [servico, setServico] = useState({ descricao: "", valorServicos: "", aliquota: "", issRetido: false });
  const [competencia, setCompetencia] = useState("");
  const [referencia, setReferencia] = useState("");

  const docLimpo = soDigitos(tomador.cnpjCpf);
  const docValido = docLimpo.length === 11 || docLimpo.length === 14;
  const emailValido = !tomador.email || tomador.email.includes("@");
  const valor = Number(String(servico.valorServicos).replace(",", "."));

  // ⚠ Endereço é TUDO OU NADA — é assim que o backend o trata. Um campo preenchido e outro não
  // faria o servidor descartar o bloco inteiro sem avisar ninguém.
  const camposEndereco = [endereco.cMun, endereco.CEP, endereco.xLgr, endereco.nro, endereco.xBairro];
  const enderecoParcial = camposEndereco.some(Boolean) && !camposEndereco.every(Boolean);

  const problemasPorPasso = useMemo(() => [
    [
      !docValido && "informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido",
      !String(tomador.nome).trim() && "informe o nome ou a razão social do tomador",
      !emailValido && "o e-mail informado não parece um e-mail",
      enderecoParcial && "o endereço precisa estar completo (município, CEP, logradouro, número e bairro) ou totalmente vazio — o servidor descarta endereço incompleto",
    ].filter(Boolean),
    [!String(servico.descricao).trim() && "descreva o serviço prestado"].filter(Boolean),
    [(!Number.isFinite(valor) || valor <= 0) && "o valor do serviço precisa ser maior que zero"].filter(Boolean),
    [],
  ], [docValido, tomador.nome, emailValido, enderecoParcial, servico.descricao, valor]);

  const problemasAtuais = problemasPorPasso[passo] || [];
  const podeAvancar = problemasAtuais.length === 0;
  // Chegar em "Conferir" exige que os TRÊS passos anteriores estejam bons — senão o preview
  // mostraria uma nota que o servidor recusaria, e o erro voltaria depois do clique em Emitir.
  const prontoParaEmitir = problemasPorPasso.slice(0, 3).every((p) => p.length === 0);

  function montarPayload() {
    return {
      companyId,
      tomador: {
        cnpjCpf: docLimpo,
        nome: String(tomador.nome).trim(),
        email: String(tomador.email).trim() || undefined,
        endereco: camposEndereco.every(Boolean) ? { ...endereco } : undefined,
      },
      servico: {
        descricao: String(servico.descricao).trim(),
        valorServicos: valor,
        aliquota: servico.aliquota === "" ? undefined : Number(String(servico.aliquota).replace(",", ".")),
        issRetido: Boolean(servico.issRetido),
      },
      competencia: competencia || undefined,
      referencia: String(referencia).trim() || undefined,
    };
  }

  async function emitir() {
    setErro("");
    const texto = `Emitir nota de ${fmtBRL(valor)} para ${String(tomador.nome).trim()} (${formatarDoc(docLimpo)})?\n\n`
      + "A emissão é um ato fiscal: depois de autorizada, desfazer exige cancelamento com justificativa, dentro do prazo da prefeitura.";
    if (!window.confirm(texto)) return;
    setEnviando(true);
    try {
      const r = await onEmitir(montarPayload());
      setResultado(r);
      onEmitida?.(r);
    } catch (e) {
      // A mensagem do provedor chega traduzida pelo `normalizeError`; o código seco não ajudaria.
      setErro(e?.message || "Não foi possível emitir a nota.");
    } finally {
      setEnviando(false);
    }
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const caixa = { background: "#24253A", border: `1px solid ${PANEL.border}`, borderRadius: 12, padding: 20, width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", color: PANEL.text, boxSizing: "border-box" };

  // ── Depois de emitida: o resultado, não o formulário ──────────────────────
  if (resultado) {
    const st = String(resultado?.status || resultado?.nfse?.status || "").toLowerCase();
    const autorizada = st.includes("issued") || st.includes("autoriz");
    return (
      <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={caixa}>
          <h3 style={{ margin: "0 0 10px" }}>{autorizada ? "✓ Nota autorizada" : "Nota enviada"}</h3>
          <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
            {autorizada
              ? "A prefeitura autorizou a nota."
              /* "pending" NÃO é sucesso nem erro, e dizer "emitida" aqui seria afirmar o que ainda
                 não aconteceu — a nota volta para a lista e o status se resolve na consulta. */
              : "A nota foi registrada e está aguardando o retorno da prefeitura. O status aparece na lista assim que houver resposta."}
          </p>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "0.82rem", margin: 0 }}>
            <dt style={{ color: PANEL.muted }}>Tomador</dt><dd style={{ margin: 0 }}>{String(tomador.nome).trim()}</dd>
            <dt style={{ color: PANEL.muted }}>Valor</dt><dd style={{ margin: 0 }}>{fmtBRL(valor)}</dd>
            {resultado?.nfse?.numeroNfse && <><dt style={{ color: PANEL.muted }}>Número</dt><dd style={{ margin: 0 }}>{resultado.nfse.numeroNfse}</dd></>}
            {resultado?.nfse?.chaveAcesso && <><dt style={{ color: PANEL.muted }}>Chave</dt><dd style={{ margin: 0, wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.74rem" }}>{resultado.nfse.chaveAcesso}</dd></>}
          </dl>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: PANEL.accent, color: "#000", fontWeight: 700, cursor: "pointer" }}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={caixa}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Emitir nota de serviço</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Trilha dos passos: onde estou e quanto falta. */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {PASSOS.map((p, i) => (
            <span
              key={p}
              style={{
                fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                border: `1px solid ${i === passo ? PANEL.accent : PANEL.border}`,
                // ⚠ Nada de `${PANEL.accent}22`: `accent` é `var(--accent-cyan)`, e concatenar
                // hex numa var() produz uma cor inválida que o browser descarta em silêncio.
                background: i === passo ? "rgba(139, 233, 253, 0.14)" : "transparent",
                color: i === passo ? PANEL.text : (i < passo ? "#69FF47" : PANEL.muted),
              }}
            >
              {i < passo ? "✓ " : `${i + 1}. `}{p}
            </span>
          ))}
        </div>

        {passo === 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={rotulo}>CNPJ ou CPF do tomador
              <input value={tomador.cnpjCpf} onChange={(e) => setTomador({ ...tomador, cnpjCpf: e.target.value })} placeholder="Só números" style={campo} />
            </label>
            <label style={rotulo}>Nome ou razão social
              <input value={tomador.nome} onChange={(e) => setTomador({ ...tomador, nome: e.target.value })} style={campo} />
            </label>
            <label style={rotulo}>E-mail (opcional)
              <input value={tomador.email} onChange={(e) => setTomador({ ...tomador, email: e.target.value })} style={campo} />
            </label>
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: PANEL.muted }}>
                Endereço do tomador (opcional — mas só vale completo)
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <label style={rotulo}>Código do município (IBGE)<input value={endereco.cMun} onChange={(e) => setEndereco({ ...endereco, cMun: e.target.value })} style={campo} /></label>
                <label style={rotulo}>CEP<input value={endereco.CEP} onChange={(e) => setEndereco({ ...endereco, CEP: e.target.value })} style={campo} /></label>
                <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Logradouro<input value={endereco.xLgr} onChange={(e) => setEndereco({ ...endereco, xLgr: e.target.value })} style={campo} /></label>
                <label style={rotulo}>Número<input value={endereco.nro} onChange={(e) => setEndereco({ ...endereco, nro: e.target.value })} style={campo} /></label>
                <label style={rotulo}>Complemento<input value={endereco.xCpl} onChange={(e) => setEndereco({ ...endereco, xCpl: e.target.value })} style={campo} /></label>
                <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Bairro<input value={endereco.xBairro} onChange={(e) => setEndereco({ ...endereco, xBairro: e.target.value })} style={campo} /></label>
              </div>
            </details>
          </div>
        )}

        {passo === 1 && (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={rotulo}>Descrição do serviço
              <textarea value={servico.descricao} onChange={(e) => setServico({ ...servico, descricao: e.target.value })} rows={4} style={{ ...campo, resize: "vertical" }} />
            </label>
            <label style={rotulo}>Competência (opcional)
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ ...campo, colorScheme: "dark" }} />
            </label>
            <label style={rotulo}>Referência interna (opcional)
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: contrato, pedido" style={campo} />
            </label>
          </div>
        )}

        {passo === 2 && (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={rotulo}>Valor dos serviços (R$)
              <input value={servico.valorServicos} onChange={(e) => setServico({ ...servico, valorServicos: e.target.value })} placeholder="0,00" inputMode="decimal" style={campo} />
            </label>
            <label style={rotulo}>Alíquota de ISS (%) — opcional
              <input value={servico.aliquota} onChange={(e) => setServico({ ...servico, aliquota: e.target.value })} placeholder="Deixe vazio para usar a da prefeitura" inputMode="decimal" style={campo} />
            </label>
            {/* ⚠ Retenção fica VISÍVEL como escolha, não escondida num default: ela muda quem
                recolhe o ISS, e passar batido é erro que só aparece na conciliação. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={servico.issRetido} onChange={(e) => setServico({ ...servico, issRetido: e.target.checked })} />
              ISS retido pelo tomador
            </label>
          </div>
        )}

        {passo === 3 && (
          <div>
            <p style={{ fontSize: "0.8rem", color: PANEL.muted, margin: "0 0 10px" }}>
              Confira o espelho antes de emitir. Depois de autorizada, desfazer exige cancelamento com
              justificativa, dentro do prazo da prefeitura.
            </p>
            <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12, background: "#1A1B26", display: "grid", gap: 6, fontSize: "0.84rem" }}>
              <LinhaEspelho r="Tomador" v={`${String(tomador.nome).trim()} · ${formatarDoc(docLimpo)}`} />
              {tomador.email && <LinhaEspelho r="E-mail" v={tomador.email} />}
              <LinhaEspelho r="Endereço" v={camposEndereco.every(Boolean) ? `${endereco.xLgr}, ${endereco.nro}${endereco.xCpl ? ` — ${endereco.xCpl}` : ""} · ${endereco.xBairro} · CEP ${endereco.CEP} · município ${endereco.cMun}` : "não informado"} />
              <LinhaEspelho r="Serviço" v={String(servico.descricao).trim()} />
              {competencia && <LinhaEspelho r="Competência" v={competencia} />}
              {referencia && <LinhaEspelho r="Referência" v={referencia} />}
              <div style={{ borderTop: `1px solid ${PANEL.border}`, margin: "4px 0" }} />
              <LinhaEspelho r="Valor dos serviços" v={fmtBRL(valor)} forte />
              <LinhaEspelho r="Alíquota de ISS" v={servico.aliquota === "" ? "a da prefeitura" : `${servico.aliquota}%`} />
              <LinhaEspelho r="ISS retido" v={servico.issRetido ? "sim — quem recolhe é o tomador" : "não"} />
            </div>
            {!prontoParaEmitir && (
              <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#FF5757" }}>
                Faltam dados nos passos anteriores — volte e complete antes de emitir.
              </div>
            )}
          </div>
        )}

        {/* Opção desabilitada NUNCA fica sem explicação. */}
        {problemasAtuais.length > 0 && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "#FF5757", fontSize: "0.78rem" }}>
            {problemasAtuais.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {erro && (
          <div style={{ marginTop: 12, padding: 8, borderRadius: 6, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", color: "#FF5757", fontSize: "0.8rem" }}>
            {erro}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
          {/* Voltar de PASSO, não de tela — por isso é `Button variant="secondary"` e não o
              `BackButton`, que é a saída da página. Os outros assistentes (OFX, Excel, regras de
              obrigação) já escreviam exatamente isto. */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => (passo === 0 ? onClose() : setPasso(passo - 1))}
            disabled={enviando}
          >
            {passo === 0 ? "Cancelar" : "Voltar"}
          </Button>

          {/* ⚠ O botão Emitir SÓ existe no passo de conferência. Não é uma decisão de estilo: é a
              garantia de que ninguém emite sem ver o espelho. */}
          {passo < 3 ? (
            <Button
              type="button"
              onClick={() => setPasso(passo + 1)}
              disabled={!podeAvancar}
              title={podeAvancar ? undefined : problemasAtuais.join(" · ")}
            >
              Continuar →
            </Button>
          ) : (
            /* ⚠ Era verde #69FF47. Emitir nota é o oposto de "concluído" — é o ato fiscal
               acontecendo. Ação primária usa o accent. */
            <Button
              type="button"
              onClick={emitir}
              disabled={enviando || !prontoParaEmitir}
            >
              {enviando ? "Emitindo…" : "Emitir nota"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinhaEspelho({ r, v, forte }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
      <span style={{ color: PANEL.muted, flex: "0 0 auto" }}>{r}</span>
      <span style={{ textAlign: "right", fontWeight: forte ? 800 : 500 }}>{v}</span>
    </div>
  );
}
