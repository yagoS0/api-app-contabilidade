import { Button } from "../../../components/ui/Button";
import { AcoesDaEtapa } from "./AcoesDaEtapa";
import { ApresentacaoManual } from "./FichaAvulsa";

export function DevolutivaDoLead({ api, estado, conversaId, janela, canalDisponivel = true, ocupado, acao, executar }) {
  const { onboarding: o, jornada: j } = estado;
  const diagnostico = j?.diagnostico, entrega = j?.devolutiva;
  const precisaPdf = Boolean(diagnostico?.dados.analiseId);
  const podeEnviar = conversaId && canalDisponivel && (!janela || janela.situacao === "ABERTA") && !entrega?.incerta && !entrega?.concluida;
  const status = { nao_enviado: "Não enviado", enviado: "Enviado", entregue: "Entregue", lido: "Lido", falhou: "Falhou", enviando: "Enviando", indeterminado: "Sem confirmação" };
  return <section aria-label="Apresentar análise ao lead">
    <AcoesDaEtapa tituloPrincipal="Enviar pelo WhatsApp">
      <p className="lead-preview-caption">Confira o que será apresentado ao lead.</p>
      <p className="lead-message-preview">{diagnostico?.dados.texto}</p>
      {(entrega?.partes || []).map(p => <p key={p.parte}>{p.parte === "RELATORIO" ? "PDF fiscal" : "Mensagem"}: {status[p.status] || p.status}{p.erro ? " · " + p.erro : ""}</p>)}
      {precisaPdf && api.baixarAnaliseOnboarding && <Button variant="secondary" disabled={ocupado} onClick={() => executar(async () => {
        const blob = await api.baixarAnaliseOnboarding(o.id, diagnostico.dados.analiseId);
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "situacao-fiscal.pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      })}>Baixar PDF fiscal para apresentar</Button>}
      <Button disabled={ocupado || !podeEnviar} onClick={() => acao("/jornada/devolutiva", { diagnosticoId: diagnostico.id, conversaId })}>{precisaPdf ? "Conferi: enviar PDF e devolutiva" : "Conferi: enviar devolutiva"}</Button>
      <p>O envio usa o canal indicado acima. Partes já enviadas não serão repetidas.</p>
      {entrega?.incerta && <p role="alert">Há um envio sem confirmação. Confira o histórico antes de reenviar.</p>}
      {!podeEnviar && !entrega?.concluida && <p>Para continuar por outro meio, apresente a análise ao lead e registre abaixo como isso foi feito. Você não precisa esperar uma resposta no WhatsApp para registrar essa apresentação.</p>}
    <details><summary>Apresentar por outro meio</summary><ApresentacaoManual aberto versao={o.versao} diagnosticoId={diagnostico?.id} disabled={ocupado} onSalvar={body => acao("/jornada/apresentacao", body)} /></details>
    </AcoesDaEtapa>
  </section>;
}
