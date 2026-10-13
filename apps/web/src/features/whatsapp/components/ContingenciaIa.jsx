import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

export function ContingenciaIa({ conversa, hook, somenteLeitura = false, onDetalhes }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  if (conversa.contingenciaIa?.estado !== "PENDENTE" || (!conversa.atendidaDesde && !conversa.atendidaPor)) return null;
  const assumida = Boolean(conversa.atendidaPor);
  async function assumir() {
    if (trava.current || hook.ocupado) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const resultado = await hook.assumir(conversa.id);
      if (!resultado || resultado.ok === false) setErro("Não foi possível confirmar a atribuição. Atualize a conversa e tente novamente.");
    } catch { setErro("Não foi possível assumir. Tente novamente."); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <section className="wa-notice wa-contingency" role="status" aria-label="Contingência da IA">
    <div><strong>{assumida ? "Atendimento com a equipe" : "IA indisponível · atendimento humano necessário"}</strong>
      <p>{assumida ? `Responsável: ${conversa.atendente?.nome || "equipe"}. A automação permanece pausada.` : "A automação está pausada. A conversa e os dados coletados estão preservados."}</p>
      {erro && <p role="alert">{erro}</p>}
    </div>
    <div className="wa-contingency-actions">
      {!assumida && !somenteLeitura && typeof hook.assumir === "function" && <Button size="sm" disabled={ocupado || hook.ocupado} onClick={assumir}>{ocupado ? "Assumindo…" : "Assumir conversa"}</Button>}
      {onDetalhes && <Button variant="secondary" size="sm" onClick={onDetalhes}>Ver resumo</Button>}
    </div>
  </section>;
}
