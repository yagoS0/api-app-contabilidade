// Q14.2.e — Modal pra resolver uma pendência (ITEM_SEM_REGRA por enquanto).
import { useId, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";

import { PANEL } from "../../notas/components/notasStyles.shared.js";
import { Aviso } from "../../../components/ui/Aviso";
import {
  ESCOPO_DA_RESOLUCAO, podeResolverGlobalmente, consequenciaDoEscopo, avisoDeAlcance,
  escopoParaPayload,
} from "../lib/escopoDaResolucao";

const TIPOS_RECEITA = [
  { value: "REVENDA_MERCADORIA",  label: "Revenda de mercadoria (Anexo I)" },
  { value: "INDUSTRIALIZACAO",     label: "Industrialização (Anexo II)" },
  { value: "SERVICO_ANEXO_III",    label: "Serviço — Anexo III (sem Fator R)" },
  { value: "SERVICO_ANEXO_IV",     label: "Serviço — Anexo IV (construção/advocacia/etc)" },
  { value: "SERVICO_ANEXO_V",      label: "Serviço — Anexo V puro (raro)" },
  { value: "SERVICO_FATOR_R",      label: "Serviço — Fator R (III↔V mensal) ★" },
];

const CONF_COLOR = { alta: "var(--state-ok)", media: "var(--state-warn)", baixa: "var(--text-muted)" };
const CONF_LABEL = { alta: "alta", media: "média", baixa: "baixa" };

export function ResolverPendenciaModal({ pendencia, onResolver, onClose, saving, myRole }) {
  const formId = useId();
  const detalhes = pendencia.detalhes || {};
  const codigo = detalhes.codigo || "?";
  const tipoCodigo = detalhes.tipoCodigo || "?";
  const ocorrencias = detalhes.ocorrencias || 0;
  // Q20: recomendação ancorada no CNAE → atividade SERPRO (sugestão, não chuta).
  const rec = detalhes.recomendacao || null;

  // Pré-seleciona o tipoReceita sugerido (se houver) — o contador confirma.
  const [tipoReceita, setTipoReceita] = useState(rec?.tipoReceitaSugerido || "");
  const [criarRegra, setCriarRegra] = useState(true);
  const [nomeProduto, setNomeProduto] = useState("");
  // ⚠ EMPRESA marcado, GLOBAL exige clique deliberado — marcar o alcance maior por padrão o faria
  // acontecer por inércia. É o mesmo default do servidor.
  const [escopo, setEscopo] = useState(ESCOPO_DA_RESOLUCAO.EMPRESA);

  const global = podeResolverGlobalmente({ myRole });
  // ⚠ Campo DERIVADO pelo backend (`esperandoAMesmaDecisao`), no item — não dentro de `detalhes`,
  // que é o payload gravado. Ausente ⇒ a tela não afirma nada sobre quantas empresas esperam.
  const esperando = pendencia.esperandoAMesmaDecisao;
  const textos = consequenciaDoEscopo({ esperando });
  const alcance = avisoDeAlcance(escopo, { esperando });

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving || !tipoReceita) return;
    await onResolver({
      tipoReceita,
      criarRegra,
      nomeProduto: nomeProduto.trim() || undefined,
      // ⚠ EMPRESA não manda o campo: o servidor tem esse default, e omitir mantém intacta a
      // requisição que já existia.
      ...escopoParaPayload(escopo),
    });
  }

  return (
    <Modal titulo="Classificar pendência" tamanho="md" ocupado={saving} aoFechar={onClose} fecharAoClicarFundo={false} rodape={<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
      <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
      <Button type="submit" form={formId} disabled={saving || !tipoReceita}>{saving ? "Resolvendo…" : "Resolver pendência"}</Button>
    </div>}>
      <form id={formId} onSubmit={handleSubmit} style={{ color: PANEL.text, overflowWrap: "anywhere" }}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 16 }}>
        <div style={{ background: PANEL.field, padding: 12, borderRadius: 6, fontSize: "0.85rem" }}>
          <div>Código: <code>{tipoCodigo}:{codigo}</code></div>
          <div>{ocorrencias} nota(s) com esse código</div>
          {pendencia.competencia && <div>Competência: {pendencia.competencia}</div>}
        </div>

        {/* Q20: recomendação (atividade SERPRO via CNAE) + confiança */}
        {rec && (
          <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, padding: 12, borderRadius: 6, fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <strong>Recomendação</strong>
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: CONF_COLOR[rec.confianca] || PANEL.muted, border: `1px solid ${CONF_COLOR[rec.confianca] || PANEL.border}`, borderRadius: 999, padding: "1px 8px" }}>
                confiança {CONF_LABEL[rec.confianca] || rec.confianca}
              </span>
            </div>
            {rec.atividade ? (
              <div>Atividade SERPRO: <strong>{rec.atividade.descricao}</strong> <span style={{ color: PANEL.muted }}>(#{rec.atividade.idAtividade} · Anexo {rec.atividade.anexoImplicito}{rec.atividade.sujeitoFatorR ? " ★FR" : ""})</span></div>
            ) : rec.ambiguo ? (
              <div style={{ color: PANEL.muted }}>Candidatos: {(rec.candidatos || []).join(", ") || "—"}</div>
            ) : null}
            <div style={{ color: PANEL.muted, fontSize: "0.8125rem" }}>{rec.motivo}</div>
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Tipo de Receita:
          <select value={tipoReceita} onChange={(e) => setTipoReceita(e.target.value)} required
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }}>
            <option value="">— Escolha —</option>
            {TIPOS_RECEITA.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <details style={{ fontSize: "0.8125rem", color: PANEL.muted }}>
          <summary style={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>Como funciona o Fator R</summary>
          <p style={{ margin: "0 0 8px" }}>Serviços intelectuais: o sistema decide o Anexo III ou V mensalmente conforme folha/RBT12.</p>
        </details>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={criarRegra} onChange={(e) => setCriarRegra(e.target.checked)} />
          Salvar como regra (próximas notas com mesmo código classificam sozinhas)
        </label>

        {/* ⚠⚠ O ALCANCE DA REGRA — só faz sentido se ela for salva. Sem `criarRegra` não há regra,
            e oferecer "para quem ela vale" seria perguntar sobre algo que não vai existir. */}
        {criarRegra && (
          <fieldset
            style={{
              minWidth: 0, border: `1px solid var(--border)`, borderRadius: 8, padding: "10px 12px",
              display: "flex", flexDirection: "column", gap: 8, margin: 0,
            }}
          >
            <legend style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: 500, padding: "0 4px" }}>
              Para quem esta regra vale
            </legend>

            {[ESCOPO_DA_RESOLUCAO.EMPRESA, ESCOPO_DA_RESOLUCAO.GLOBAL].map((valor) => {
              const t = textos[valor];
              const ehGlobal = valor === ESCOPO_DA_RESOLUCAO.GLOBAL;
              const bloqueado = ehGlobal && !global.pode;
              return (
                <label
                  key={valor}
                  style={{
                    display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.82rem",
                    cursor: bloqueado ? "not-allowed" : "pointer",
                    // ⚠ Bloqueado fica VISÍVEL e apagado, nunca ausente: opção que some esconde que
                    // a ação existe, e aí ninguém sabe a quem pedir.
                    opacity: bloqueado ? 0.55 : 1,
                  }}
                  title={bloqueado ? global.motivo : undefined}
                >
                  <input
                    type="radio" name="escopo-da-regra" value={valor}
                    checked={escopo === valor} disabled={bloqueado}
                    onChange={() => setEscopo(valor)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{t.rotulo}</strong>
                    <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.8125rem", marginTop: 2 }}>
                      {t.consequencia}
                    </span>
                    {/* ⚠ O GANHO é frase separada e só existe quando o número veio. Ausente ⇒ nada
                        é dito: a tela não afirma sobre o banco a partir de um campo que não chegou. */}
                    {ehGlobal && t.ganho && (
                      <span style={{ display: "block", color: "var(--text-faint)", fontSize: "0.8125rem", marginTop: 2 }}>
                        {t.ganho}
                      </span>
                    )}
                    {bloqueado && (
                      <span style={{ display: "block", color: "var(--text-faint)", fontSize: "0.8125rem", marginTop: 2 }}>
                        {global.motivo}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}

            {/* ⚠⚠ O aviso só aparece com GLOBAL escolhido — âmbar permanente treina o olho a
                ignorar justamente a cor que significa "pare e leia". */}
            {alcance && (
              <Aviso tom="atencao" titulo="Esta decisão sai desta empresa" compacto>
                {alcance.texto}
              </Aviso>
            )}
          </fieldset>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Nome do produto/serviço (opcional, cria entrada nomeada no catálogo):
          <input type="text" value={nomeProduto} onChange={(e) => setNomeProduto(e.target.value)}
            placeholder="ex: Confecção de páginas web"
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

      </fieldset>
      </form>
    </Modal>
  );
}
