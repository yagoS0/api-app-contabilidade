// ENTREGA POR ARQUIVO — EFD-Contribuições (e, pelo mesmo caminho, ECD e ECF).
//
// ⚠ O APP NÃO GERA O ARQUIVO, E ISSO ESTÁ DITO NA TELA, NÃO ESCONDIDO.
// O leiaute da EFD-Contribuições (Guia Prático da RFB, blocos 0/A/C/D/F/M/1/9) não está no
// projeto. Escrevê-lo por dedução produziria um arquivo que o validador recusa — ou, pior, aceita
// com dado errado, o que é uma declaração falsa transmitida à Receita. Regra 1 do projeto.
//
// ⚠ E O APP TAMBÉM NÃO TRANSMITE — mas aqui a razão é outra, e é importante não confundir as duas:
// validação, assinatura digital e transmissão acontecem no PROGRAMA OFICIAL (PVA). Não existe API
// para isso. Ou seja, mesmo com o leiaute implementado, o passo 2 continuaria fora do app.
//
// O QUE ESTA TELA ENTREGA, então, é o RASTRO — e ele não é consolo. Sem ele, "a EFD de março foi
// entregue?" só se responde abrindo o programa oficial, empresa por empresa, que é exatamente o
// trabalho que o app existe para poupar. A obrigação continua rastreável mesmo sem o app gerar
// coisa alguma, e é isso que o bloco pede.

import { useEffect, useState } from "react";
import { createApiClient } from "../../../../api/client";

const entregasApi = createApiClient();

const C = { surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", accent: "#BD93F9", ok: "#50FA7B", alerta: "#FFB347" };

/** Os três passos, na ordem em que acontecem — e cada um diz ONDE acontece. */
const PASSOS = [
  {
    n: 1,
    titulo: "Gerar o arquivo",
    onde: "fora do app",
    // O texto não pede desculpa: explica onde o trabalho é feito e por quê.
    detalhe: "O arquivo da EFD-Contribuições é gerado no seu sistema contábil ou no próprio PVA. Anexe-o aqui para deixar registrado o que foi entregue.",
  },
  {
    n: 2,
    titulo: "Validar, assinar e transmitir",
    onde: "no programa oficial (PVA)",
    detalhe: "A validação do leiaute, a assinatura com o certificado e a transmissão são feitas no PVA da Receita. Não existe API para essas etapas — nenhum sistema faz isso por fora.",
  },
  {
    n: 3,
    titulo: "Anexar o recibo",
    onde: "aqui",
    detalhe: "O recibo devolvido pelo PVA é o que fecha a obrigação. É ele que responde 'esta competência foi entregue?' sem abrir o programa oficial.",
  },
];

export function EntregaPorArquivo({ companyId, tipo = "EFD_CONTRIBUICOES", rotulo = "EFD-Contribuições", competencia }) {
  const [entrega, setEntrega] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!companyId || !competencia) return undefined;
    let vivo = true;
    setCarregando(true); setErro("");
    entregasApi.getEntregasObrigacao?.(companyId, tipo)
      .then((r) => {
        if (!vivo) return;
        setEntrega((r?.entregas || []).find((e) => e.competencia === competencia) || null);
      })
      .catch((e) => { if (vivo) setErro(e?.message || "Não foi possível carregar a entrega."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [companyId, tipo, competencia]);

  async function salvar(patch) {
    setSalvando(true); setErro("");
    try {
      const r = await entregasApi.salvarEntregaObrigacao?.(companyId, tipo, competencia, patch);
      setEntrega(r?.entrega || null);
    } catch (e) {
      setErro(e?.message || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }

  const temArquivo = Boolean(entrega?.arquivoNome);
  const temRecibo = Boolean(entrega?.reciboNome);
  const transmitida = Boolean(entrega?.transmitidaEm);
  // ⚠ O passo 2 nunca fica "concluído" sozinho: ele acontece FORA. O que marca é a confirmação
  // do contador, e por isso o estado dele é a própria marca de transmissão.
  const estadoPasso = [temArquivo, transmitida, temRecibo];

  return (
    <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, color: C.texto, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.9rem" }}>{rotulo}</strong>
        <span style={{ fontSize: "0.78rem", color: C.muted }}>competência {competencia}</span>
        {transmitida && temRecibo && (
          <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#1A1B26", background: C.ok, borderRadius: 999, padding: "2px 9px" }}>ENTREGUE</span>
        )}
      </div>

      {carregando && <div style={{ fontSize: "0.82rem", color: C.muted }}>Carregando…</div>}
      {erro && <div style={{ fontSize: "0.8rem", color: "#FF5555" }}>{erro}</div>}

      {PASSOS.map((p, i) => (
        <div key={p.n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{
            flex: "0 0 24px", height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.74rem", fontWeight: 800,
            background: estadoPasso[i] ? C.ok : "transparent",
            color: estadoPasso[i] ? "#1A1B26" : C.muted,
            border: `1px solid ${estadoPasso[i] ? C.ok : C.borda}`,
          }}>
            {estadoPasso[i] ? "✓" : p.n}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.84rem", fontWeight: 600 }}>
              {p.titulo}
              {/* ⚠ ONDE acontece cada passo fica no RÓTULO, não numa nota de rodapé: é a informação
                  que evita o contador procurar dentro do app um botão que nunca vai existir. */}
              <span style={{ fontWeight: 400, color: p.onde === "aqui" ? C.accent : C.alerta, fontSize: "0.76rem" }}> · {p.onde}</span>
            </div>
            <div style={{ fontSize: "0.76rem", color: C.muted, marginTop: 2 }}>{p.detalhe}</div>

            {/* Passo 1 — anexar o arquivo entregue. */}
            {p.n === 1 && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {temArquivo ? (
                  <>
                    <span style={{ fontSize: "0.78rem", color: C.ok }}>📎 {entrega.arquivoNome}</span>
                    <button type="button" disabled={salvando} onClick={() => salvar({ arquivoFileId: null, arquivoNome: null })} style={btnSec}>Remover</button>
                  </>
                ) : (
                  <label style={{ ...btnSec, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Anexar o arquivo gerado
                    <input
                      type="file"
                      accept=".txt,.efd,text/plain"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        // ⚠ Guardamos o NOME agora e o conteúdo quando o upload existir. Registrar
                        // só o nome já responde "o que foi entregue nesta competência?", que é a
                        // pergunta do rastro — e é honesto: a tela não promete guardar o arquivo.
                        if (f) salvar({ arquivoNome: f.name });
                      }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* Passo 2 — a confirmação de que foi transmitido no PVA. */}
            {p.n === 2 && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {transmitida ? (
                  <>
                    <span style={{ fontSize: "0.78rem", color: C.ok }}>
                      Confirmada em {new Date(entrega.transmitidaEm).toLocaleDateString("pt-BR")}
                    </span>
                    <button type="button" disabled={salvando} onClick={() => salvar({ transmitida: false })} style={btnSec}>Desfazer</button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => {
                      // O confirm diz o que a marca significa — ela é afirmação do contador sobre
                      // um ato que aconteceu fora daqui.
                      if (!window.confirm(`Confirmar que a ${rotulo} de ${competencia} foi transmitida no PVA?\n\nIsto registra a entrega do nosso lado; o app não transmite nada.`)) return;
                      salvar({ transmitida: true });
                    }}
                    style={btnSec}
                  >
                    Já transmiti no PVA
                  </button>
                )}
              </div>
            )}

            {/* Passo 3 — o recibo, que é o que fecha. */}
            {p.n === 3 && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {temRecibo ? (
                  <>
                    <span style={{ fontSize: "0.78rem", color: C.ok }}>📎 {entrega.reciboNome}</span>
                    <button type="button" disabled={salvando} onClick={() => salvar({ reciboFileId: null, reciboNome: null })} style={btnSec}>Remover</button>
                  </>
                ) : (
                  <label style={{ ...btnSec, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Anexar o recibo
                    <input
                      type="file" accept=".pdf,.txt,.rec" style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) salvar({ reciboNome: f.name }); }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* ⚠ A obrigação NUNCA some da tela por falta de suporte. Empresa fora do perfil, leiaute
          ainda não implementado, PVA indisponível — em nenhum caso a linha desaparece: ela fica,
          com o caminho alternativo à mão. Sumir seria transformar "não sabemos fazer" em "não
          existe obrigação", que é o erro caro. */}
      <div style={{ fontSize: "0.74rem", color: C.muted, borderTop: `1px solid ${C.borda}`, paddingTop: 8, lineHeight: 1.5 }}>
        O app <strong>não gera</strong> o arquivo da {rotulo} — o leiaute é definido pelo Guia Prático da
        Receita e o arquivo sai do seu sistema contábil ou do PVA. E <strong>não transmite</strong>: validação,
        assinatura e transmissão são etapas do programa oficial, sem API. O que fica registrado aqui é
        a entrega, para a competência poder ser respondida sem abrir o PVA.
      </div>
    </div>
  );
}

const btnSec = {
  background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6,
  padding: "4px 10px", font: "inherit", fontSize: "0.76rem", cursor: "pointer",
};
