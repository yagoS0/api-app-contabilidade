import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import "./guia-parcelamento-modal.css";
import { FAMILIAS_PARCELAMENTO, MODALIDADES_SEM_FAMILIA } from "../../../../lib/vocabulario";
import { tipoGuiaSugerido, parcelaSugerida, opcoesDeParcela, dataParaInput, avisosDeDuplicidade, parcelamentosSelecionaveis, rotuloDoParcelamento, normalizarCompetencia } from "../../lib/anexoParcelamento";

const FIELD = { background: "var(--surface-input, #1A1B26)", border: "1px solid var(--border, #44475A)", borderRadius: 6, color: "var(--text, #F8F8F2)", padding: "8px 10px", width: "100%", boxSizing: "border-box" };
const LBL = { display: "block", fontSize: "0.75rem", color: "var(--text-muted, #aeb6d3)", marginBottom: 4, fontWeight: 600 };
const TIPOS_GUIA = ["SIMPLES", "INSS", "DARF", "ISS", "PIS", "COFINS", "IRPJ", "CSLL", "FGTS", "OUTRA"];
const MODALIDADES = [...Object.values(FAMILIAS_PARCELAMENTO).flatMap(f => f.modalidades), ...MODALIDADES_SEM_FAMILIA];
const ROTULOS_MODALIDADE = { PARCSN: "Simples Nacional", PARCMEI: "MEI", PARCSN_ESPECIAL: "Simples Nacional · especial", PARCMEI_ESPECIAL: "MEI · especial", PERT_SN: "PERT · Simples Nacional", PERT_MEI: "PERT · MEI", RELP_SN: "RELP · Simples Nacional", RELP_MEI: "RELP · MEI", INSS: "INSS", OUTRO: "Outro", LUCRO_PRESUMIDO: "Lucro Presumido" };

export function GuiaDeParcelamentoModal({ parcelamentosAtivos = [], guias = [], arquivo, onEscolherArquivo,
  onCriarNovoParcelamento, parcelamentoIdInicial = "", guiaExistente = null, pdfUrlExistente = null,
  indicacaoId = null, modalidadeInicial = "", competenciaInicial = "", onSalvar, onClose, saving = false }) {
  const ativos = useMemo(() => parcelamentosSelecionaveis(parcelamentosAtivos).filter(p => p.origem !== "GUIA_AVULSA"), [parcelamentosAtivos]);
  const [modo, setModo] = useState(guiaExistente || parcelamentoIdInicial ? "VINCULAR" : "APENAS");
  const [parcId, setParcId] = useState(parcelamentoIdInicial || (ativos.length === 1 ? ativos[0].id : ""));
  const [modalidade, setModalidade] = useState(modalidadeInicial || guiaExistente?.parcelamentoTipo || "");
  const [numeroParcela, setNumeroParcela] = useState(String(guiaExistente?.numeroParcela ?? ""));
  const [competencia, setCompetencia] = useState(normalizarCompetencia(guiaExistente?.competencia || competenciaInicial));
  const [vencimento, setVencimento] = useState(dataParaInput(guiaExistente?.vencimento));
  const [valor, setValor] = useState(guiaExistente?.valor == null ? "" : String(guiaExistente.valor));
  const [tipo, setTipo] = useState(guiaExistente?.tipo || (modalidadeInicial ? tipoGuiaSugerido(modalidadeInicial) : ""));
  const [erro, setErro] = useState("");
  const [duplicidade, setDuplicidade] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(pdfUrlExistente);
  const titulo = guiaExistente ? (modo === "VINCULAR" ? "Vincular parcela" : "Salvar parcela") : "Subir guia de parcelamento";
  const parc = modo === "VINCULAR" ? ativos.find(p => p.id === parcId) : null;
  const opcoes = parc ? opcoesDeParcela(parc) : [];
  const avisos = parc ? avisosDeDuplicidade({ guias: guias.filter(g => g.id !== guiaExistente?.id), parcelamentoId: parc.id, numeroParcela: numeroParcela ? Number(numeroParcela) : null, competencia }) : [];

  useEffect(() => { if (parcelamentoIdInicial) { setParcId(parcelamentoIdInicial); setModo("VINCULAR"); } }, [parcelamentoIdInicial]);
  useEffect(() => {
    if (!parc || guiaExistente) return;
    const sug = parcelaSugerida(parc);
    setTipo(atual => atual || tipoGuiaSugerido(parc.tipo));
    if (sug) {
      setNumeroParcela(atual => atual || String(sug.numeroParcela ?? ""));
      setCompetencia(atual => atual || normalizarCompetencia(sug.competencia));
      setVencimento(atual => atual || dataParaInput(sug.vencimento));
    }
    const v = parc.valorParcelaReferencia ?? parc.principalPerParcela;
    if (v != null) setValor(atual => atual === "" ? String(v) : atual);
  }, [parc, guiaExistente]);
  useEffect(() => {
    if (!arquivo) { setPdfUrl(pdfUrlExistente); return undefined; }
    const url = URL.createObjectURL(arquivo); setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo, pdfUrlExistente]);
  useEffect(() => {
    const key = e => { if (e.key === "Escape" && !saving) { if (duplicidade) setDuplicidade(false); else onClose?.(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [onClose, saving, duplicidade]);

  function escolherParcela(n) {
    setNumeroParcela(n);
    if (guiaExistente) return;
    const p = opcoes.find(o => String(o.numeroParcela) === n);
    if (p) { setCompetencia(normalizarCompetencia(p.competencia)); setVencimento(dataParaInput(p.vencimento)); }
  }
  async function salvar(confirmada = false) {
    if (modo === "VINCULAR" && !parc) return setErro("Escolha o parcelamento para vincular esta parcela.");
    if (!parc && !modalidade) return setErro("Escolha a modalidade do parcelamento.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) return setErro("Informe a competência no formato AAAA-MM.");
    if (!tipo) return setErro("Escolha o tipo da guia.");
    if (!arquivo && !guiaExistente) return setErro("Selecione o PDF da parcela.");
    const numero = numeroParcela === "" ? null : Number(numeroParcela);
    if (numero != null && (!Number.isInteger(numero) || numero < 1)) return setErro("Informe um número de parcela válido.");
    const total = valor === "" ? null : Number(String(valor).replace(",", "."));
    if (total != null && (!Number.isFinite(total) || total <= 0)) return setErro("Informe um valor maior que zero ou deixe em branco para conferir depois.");
    if (avisos.length && !confirmada) return setDuplicidade(true);
    setErro(""); setDuplicidade(false);
    try {
      const resultado = await onSalvar({ somenteGuia: modo === "APENAS", guideId: guiaExistente?.id || null,
        parcelamentoId: parc?.id || null, numeroParcela: numero,
        metadata: { tipo, competencia, valor: total, vencimento: vencimento || null, isParcelamento: true,
          parcelamentoTipo: parc?.tipo || modalidade, numeroParcela: numero, indicacaoId, parcelamentoId: parc?.id || null },
        header: parc ? { parcelamentoId: parc.id, tipo: parc.tipo, numeroParcelamento: parc.numeroParcelamento,
          numeroParcela: numero, quantidadeParcelas: parc.numParcelas ?? parc.parcelasTotal ?? null,
          anoMesParcela: competencia.replace("-", ""), vencimento: vencimento || null } : null });
      if (resultado?.ok === false) setErro(resultado.message || resultado.error || "Não foi possível salvar a parcela.");
    } catch (e) { setErro(e.message || "Não foi possível salvar a parcela."); }
  }

  return <div role="dialog" aria-modal="true" aria-label={titulo}
    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 4vw" }}>
    <div className={pdfUrl ? "guia-parcelamento-modal guia-parcelamento-modal--pdf" : "guia-parcelamento-modal"}>
      {pdfUrl && <iframe src={pdfUrl} title="PDF da guia do parcelamento" className="guia-parcelamento-modal__pdf" />}
      <div className="guia-parcelamento-modal__form">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div>
          <h3 style={{ margin: 0 }}>{titulo}</h3>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: ".8rem" }}>{guiaExistente ? "Vincule o documento ao parcelamento correspondente." : "Suba a parcela agora e organize a contabilidade quando preferir."}</p>
        </div><button type="button" aria-label="Fechar" disabled={saving} onClick={onClose} style={{ border: 0, background: "none", color: "inherit", fontSize: 22 }}>×</button></div>
        {erro && <div role="alert" style={{ color: "var(--state-danger)" }}>{erro}</div>}
        {!guiaExistente && <div><label style={LBL} htmlFor="anexo-modo">Como deseja continuar?</label><select id="anexo-modo" style={FIELD} value={modo} onChange={e => setModo(e.target.value)}>
          <option value="APENAS">Apenas subir parcela</option><option value="VINCULAR">Vincular a parcelamento existente</option></select></div>}
        {onCriarNovoParcelamento && <Button variant="secondary" type="button" disabled={saving} onClick={onCriarNovoParcelamento}>Contabilizar agora</Button>}
        {modo === "VINCULAR" ? <div><label style={LBL} htmlFor="anexo-parcelamento">Parcelamento</label><select id="anexo-parcelamento" style={FIELD} value={parcId} onChange={e => setParcId(e.target.value)}>
          <option value="">Selecione o parcelamento</option>{ativos.map(p => <option key={p.id} value={p.id}>{rotuloDoParcelamento(p)}</option>)}</select>
          {!ativos.length && <p className="text-muted">Nenhum parcelamento disponível para vínculo. A parcela pode ser vinculada depois.</p>}</div>
          : <div><label style={LBL} htmlFor="anexo-modalidade">Modalidade</label><select id="anexo-modalidade" style={FIELD} value={modalidade} onChange={e => { setModalidade(e.target.value); setTipo(tipoGuiaSugerido(e.target.value)); }}>
            <option value="">Selecione a modalidade</option>{MODALIDADES.map(m => <option key={m} value={m}>{ROTULOS_MODALIDADE[m]}</option>)}</select></div>}
        <div><label style={LBL} htmlFor="anexo-numero">Número da parcela (opcional)</label>{opcoes.length ? <select id="anexo-numero" style={FIELD} value={numeroParcela} onChange={e => escolherParcela(e.target.value)}>
          <option value="">Sem número identificado</option>{numeroParcela && !opcoes.some(o => String(o.numeroParcela) === numeroParcela) && <option value={numeroParcela}>{numeroParcela} · informado na guia</option>}{opcoes.map(o => <option key={o.numeroParcela} value={o.numeroParcela}>{o.numeroParcela}{o.competencia ? " · " + o.competencia : ""}{o.jaTemGuia ? " · já tem guia" : ""}{o.quitada ? " · quitada" : ""}</option>)}</select>
          : <input id="anexo-numero" style={FIELD} type="number" min="1" step="1" value={numeroParcela} onChange={e => setNumeroParcela(e.target.value)} />}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={LBL} htmlFor="anexo-tipo">Tipo da guia</label><select id="anexo-tipo" style={FIELD} disabled={Boolean(guiaExistente)} value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Selecione</option>{TIPOS_GUIA.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label style={LBL} htmlFor="anexo-competencia">Competência (AAAA-MM)</label><input id="anexo-competencia" style={FIELD} disabled={Boolean(guiaExistente)} value={competencia} onChange={e => setCompetencia(e.target.value)} placeholder="2026-09" /></div>
          <div><label style={LBL} htmlFor="anexo-vencimento">Vencimento</label><input id="anexo-vencimento" style={FIELD} type="date" disabled={Boolean(guiaExistente)} value={vencimento} onChange={e => setVencimento(e.target.value)} /></div>
          <div><label style={LBL} htmlFor="anexo-valor">Valor (R$)</label><input id="anexo-valor" style={FIELD} inputMode="decimal" disabled={Boolean(guiaExistente)} value={valor} onChange={e => setValor(e.target.value)} /></div>
        </div>
        {!guiaExistente && <div><label style={LBL}>PDF da parcela</label><Button type="button" variant="secondary" disabled={saving} onClick={onEscolherArquivo}>{arquivo ? "Trocar PDF…" : "Escolher PDF…"}</Button><span style={{ marginLeft: 8, fontSize: ".8rem" }}>{arquivo?.name || "Nenhum arquivo escolhido"}</span></div>}
        {avisos.length > 0 && <div role="status" style={{ color: "var(--state-warn)" }}>{avisos.map(a => <p key={a} style={{ margin: "4px 0" }}>{a}</p>)}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border, #44475A)", paddingTop: 12 }}>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={saving} onClick={() => salvar()}>{saving ? "Salvando…" : guiaExistente ? titulo : modo === "APENAS" ? "Subir parcela" : "Subir e vincular"}</Button>
        </div>
      </div>
    </div>
    {duplicidade && <div role="alertdialog" aria-label="Conferir possível duplicidade" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 1750, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="panel" style={{ maxWidth: 520, padding: 22 }}><h3>Esta parcela já tem uma guia</h3><p>Confira se o documento é uma reemissão antes de continuar.</p><Button variant="secondary" onClick={() => setDuplicidade(false)}>Voltar</Button><Button onClick={() => salvar(true)}>Confirmar reemissão</Button></div>
    </div>}
  </div>;
}
export default GuiaDeParcelamentoModal;
