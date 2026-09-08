import { useEffect, useRef, useState } from "react";
import { brl } from "../../lib/format";

export function SaldoInicial({ companyId, competencia, saldo, api, aoMudar, somenteLeitura = false, disponivel = true }) {
  const [mes, setMes] = useState(saldo?.dataReferencia?.slice(0, 7) || competencia || "");
  const [valor, setValor] = useState(saldo?.valor == null ? "" : String(saldo.valor).replace(".", ","));
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const vivo = useRef(true);
  const ultimaAncora = useRef(JSON.stringify(saldo || null));
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    const chave = JSON.stringify(saldo || null);
    if (!disponivel || chave === ultimaAncora.current) return;
    ultimaAncora.current = chave;
    setMes(saldo?.dataReferencia?.slice(0, 7) || competencia || "");
    setValor(saldo?.valor == null ? "" : String(saldo.valor).replace(".", ","));
  }, [saldo?.dataReferencia, saldo?.valor, disponivel]);
  async function gravar(remover = false) {
    if (ocupado || somenteLeitura || !disponivel) return;
    setErro(""); setSucesso("");
    const decimal = valor.trim().replace(",", ".");
    if (!remover && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || Number(mes.slice(0, 4)) < 1900 || Number(mes.slice(0, 4)) > 2199 || !/^-?\d+(\.\d{1,2})?$/.test(decimal) || Math.abs(Number(decimal)) > 999999999999.99)) {
      setErro("Informe o mês e um valor com até duas casas decimais, sem separador de milhar. O valor pode ser negativo ou zero."); return;
    }
    setOcupado(true);
    try {
      const resposta = remover ? await api.excluirSaldoInicial(companyId)
        : await api.salvarSaldoInicial(companyId, { dataReferencia: `${mes}-01`, valor: decimal });
      if (resposta?.ok === false) throw new Error(resposta.message || "Não foi possível salvar o saldo inicial.");
      if (!vivo.current) return;
      setSucesso(remover ? "Saldo inicial removido. A projeção será recalculada." : "Saldo inicial salvo. A projeção será recalculada.");
      aoMudar();
    } catch (e) { if (vivo.current) setErro(e?.message || "Não foi possível salvar. Confira os dados e tente novamente."); }
    finally { if (vivo.current) setOcupado(false); }
  }
  return <section aria-label="Saldo inicial informado" style={{ margin: "12px 0", padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
    <strong>Saldo inicial informado</strong>
    <p>{!disponivel ? "Aguarde a leitura atualizada do saldo inicial." : saldo ? `${brl(saldo.valor)} em ${saldo.dataReferencia.split("-").reverse().join("/")}` : "Ainda não informado. Configure um saldo inicial para transportar a projeção entre os meses."}</p>
    {!somenteLeitura && <details>
      <summary>{saldo ? "Alterar saldo inicial" : "Informar saldo inicial"}</summary>
      <p className="hint">Informe o valor disponível no primeiro dia do mês escolhido, antes das movimentações desse mês. A projeção usa entradas e saídas registradas e previstas; não comprova saldo bancário.</p>
      <form onSubmit={e => { e.preventDefault(); gravar(); }}>
        <fieldset disabled={ocupado || !disponivel} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 10 }}>
          <label>Mês de início<input type="month" min="1900-01" max="2199-12" value={mes} onChange={e => setMes(e.target.value)} required /></label>
          <label>Valor inicial (R$)<input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} placeholder="Ex.: 1500,00" required /></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit">{ocupado ? "Salvando…" : "Salvar saldo inicial"}</button>
            {saldo && <button className="btn" type="button" onClick={() => gravar(true)}>Remover saldo inicial</button>}
          </div>
        </fieldset>
      </form>
    </details>}
    {somenteLeitura && <p className="hint">Visita do escritório: saldo disponível apenas para leitura.</p>}
    {erro && <p role="alert">{erro}</p>}
    {sucesso && <p role="status">{sucesso}</p>}
  </section>;
}
