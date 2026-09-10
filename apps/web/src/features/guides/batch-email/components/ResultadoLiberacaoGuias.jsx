import { useEffect, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { formatCompetencia } from "../../../../lib/competencia";
const quantidade = (n, palavra) => `${n} ${palavra}${n === 1 ? "" : "s"}`;

function Canal({ nome, canal }) {
  return <div className={`guide-delivery-result__channel guide-delivery-result__channel--${canal.tom}`}>
    <span className="guide-delivery-result__label">{nome}</span>
    <span>{canal.texto}</span>
    {canal.detalhes?.length > 0 && <details><summary>Detalhes</summary><ul>{canal.detalhes.map((d) => <li key={d}>{d}</li>)}</ul></details>}
  </div>;
}

export function ResultadoLiberacaoGuias({ resultado, onFechar }) {
  const [aberto, setAberto] = useState(false);
  const [soPendencias, setSoPendencias] = useState(Boolean(resultado.atencao));
  useEffect(() => { setAberto(false); setSoPendencias(Boolean(resultado.atencao)); }, [resultado]);
  const linhas = soPendencias && resultado.atencao ? resultado.linhas.filter((r) => r.atencao || r.semAviso) : resultado.linhas;
  return <section className="guide-delivery-result" aria-label="Resultado da liberação de guias">
    <div className="guide-delivery-result__header">
      <div role="status">
        <h3>Resultado da liberação · {formatCompetencia(resultado.mesVencimento)}</h3>
        <p>{quantidade(resultado.empresas, "empresa")} · {quantidade(resultado.liberadas, "guia")} no portal · E-mail enviado para {quantidade(resultado.emails, "empresa")}</p>
        {resultado.aguardando > 0 && <p>WhatsApp: {quantidade(resultado.aguardando, "guia")} aguardando confirmação de entrega.</p>}
        {resultado.atencao > 0 && <p className="guide-delivery-result__attention">{resultado.atencao} empresa{resultado.atencao === 1 ? " precisa" : "s precisam"} de atenção.</p>}
      </div>
      <div className="guide-delivery-result__actions">
        <Button variant="secondary" size="sm" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>{aberto ? "Ocultar detalhes" : resultado.atencao ? "Ver pendências" : "Ver resultado por empresa"}</Button>
        <Button variant="secondary" size="sm" onClick={onFechar}>Fechar resultado</Button>
      </div>
    </div>
    {aberto && <>
      <div className="guide-delivery-result__filters" role="group" aria-label="Filtrar resultado">
        <Button variant="secondary" size="sm" aria-pressed={!soPendencias} onClick={() => setSoPendencias(false)}>Todas ({resultado.empresas})</Button>
        {resultado.atencao > 0 && <Button variant="secondary" size="sm" aria-pressed={soPendencias} onClick={() => setSoPendencias(true)}>Precisam de atenção ({resultado.atencao})</Button>}
      </div>
      <div className="guide-delivery-result__list" tabIndex={0} role="region" aria-label="Empresas deste lote">
        {linhas.map((r) => <article className="guide-delivery-result__company" key={r.companyId}>
          <div className="guide-delivery-result__identity"><strong>{r.nome}</strong><a href={`/companies/${encodeURIComponent(r.companyId)}/guides`}>Conferir guias</a></div>
          <Canal nome="Portal" canal={r.portal} />
          <Canal nome="E-mail" canal={r.email} />
          <Canal nome="WhatsApp" canal={r.whatsapp} />
          {r.detalhes.length > 0 && <ul className="guide-delivery-result__issues">{r.detalhes.map((d) => <li key={d}>{d}</li>)}</ul>}
          {r.semAviso && <p className="guide-delivery-result__issues">Nenhum novo envio ao cliente foi confirmado neste lote. Confira o histórico e os destinatários antes de repetir.</p>}
        </article>)}
      </div>
      <p className="guide-delivery-result__footnote">Este é o resultado desta execução. Acompanhe a entrega do WhatsApp na aba Guias. Canais não utilizados não anulam os envios concluídos.</p>
    </>}
  </section>;
}
