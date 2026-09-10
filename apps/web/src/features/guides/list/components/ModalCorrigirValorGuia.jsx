import { useEffect, useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../../../lib/format";

export function ModalCorrigirValorGuia({ api, companyId, guia, aoFechar, aoCorrigir }) {
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [concluida, setConcluida] = useState(false);
  const guideId = guia.guideId || guia.id;
  const valor = Number(guia.linhaDigitavelValorLidoCentavos) / 100;
  useEffect(() => {
    let vivo = true;
    setOcupado(true);
    api.preverCorrecaoValorGuia(companyId, guideId, valor).then(r => {
      if (!vivo) return;
      if (!r?.revisao || r.guideId !== guideId || r.companyId !== companyId || r.pdfPreservado !== true || r.linhaConfirmada !== true || Number(r.novoValor) !== valor) throw new Error("A prévia não confirmou a guia, o PDF e o valor solicitado.");
      setPrevia(r);
    }).catch(e => { if (vivo) setErro(e?.message || "Não foi possível conferir o PDF."); })
      .finally(() => { if (vivo) setOcupado(false); });
    return () => { vivo = false; };
  }, [api, companyId, guideId, valor]);
  async function corrigir() {
    if (!previa || !confirmado || ocupado || concluida) return;
    setOcupado(true); setErro(null);
    try {
      const r = await api.corrigirValorGuia(companyId, guideId, { valor: previa.novoValor, revisao: previa.revisao });
      if (r?.ok !== true) throw new Error(r?.message || "A correção não foi confirmada.");
      setConcluida(true);
      try { await aoCorrigir?.(); } catch { setErro("O valor foi corrigido, mas a lista não foi atualizada. Atualize a página para conferir."); }
    } catch(e) { setErro(e?.message || "Não foi possível confirmar a correção. Atualize e confira o valor antes de repetir."); setPrevia(null); }
    finally { setOcupado(false); }
  }
  return <Modal titulo="Conferir e corrigir o valor da guia" ocupado={ocupado} aoFechar={aoFechar} rodape={<>
    <Button variant="secondary" disabled={ocupado} onClick={aoFechar}>Fechar</Button>
    {!concluida ? <Button disabled={ocupado || !previa || !confirmado} onClick={corrigir}>Confirmar correção do valor</Button> : null}
  </>}>
    {ocupado && !previa ? <p>Conferindo o PDF e os lançamentos vinculados…</p> : null}
    {erro ? <p role="alert">{erro}</p> : null}
    {concluida ? <p role="status">Valor corrigido para {fmtMoney(valor)}. O PDF foi preservado. Nenhuma mensagem foi enviada ao cliente.</p> : previa ? <>
      <p>Valor cadastrado: <strong>{fmtMoney(previa.valorAtual)}</strong>. Valor confirmado no PDF: <strong>{fmtMoney(previa.novoValor)}</strong>.</p>
      <p>{previa.lancamentosAfetados} lançamento(s) de provisão em rascunho será(ão) atualizado(s), mantendo débito e crédito balanceados. O PDF original será preservado.</p>
      <p>Esta ação não confirma pagamento nem envia a guia.</p>
      <label><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)}/> Conferi o PDF e confirmo a correção para {fmtMoney(previa.novoValor)}.</label>
    </> : null}
  </Modal>;
}
