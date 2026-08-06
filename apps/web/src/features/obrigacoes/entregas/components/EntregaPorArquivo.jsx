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
import { obrigatoriedadeEfdContribuicoes, ehCompetenciaQueConsolidaOAno } from "../lib/obrigatoriedadeEfd";

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

/**
 * A empresa não deve esta obrigação — e a tela DIZ ISSO, com a fonte, no lugar onde o fluxo estaria.
 *
 * ⚠ ISTO NÃO É "SUMIR". A primeira versão desta tela mostrava os três passos para toda empresa,
 * com o argumento de que decidir dispensa seria julgar em silêncio. O argumento acertava o risco e
 * errava o remédio: o remédio não é mostrar para todos — é dizer a dispensa em voz alta, citando a
 * norma. Optante do Simples Nacional nunca entrega EFD-Contribuições; oferecer a ela três passos de
 * entrega não é prudência, é pedir trabalho que a lei não pede.
 */
function ObrigacaoNaoDevida({ rotulo, competencia, veredito }) {
  const indefinida = veredito.situacao === "indefinida";
  // Indefinida usa a cor de PENDÊNCIA (falta cadastrar algo); dispensada é neutra — não há
  // trabalho a fazer, e pintar de âmbar treinaria o olho a ignorar o âmbar que importa.
  const cor = indefinida ? C.alerta : C.borda;

  return (
    <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${cor}`, background: C.surface, color: C.texto, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.9rem" }}>{rotulo}</strong>
        <span style={{ fontSize: "0.78rem", color: C.muted }}>competência {competencia}</span>
        <span style={{
          fontSize: "0.7rem", fontWeight: 800, borderRadius: 999, padding: "2px 9px",
          border: `1px solid ${cor}`, color: indefinida ? C.alerta : C.muted,
        }}>
          {indefinida ? "NÃO DÁ PARA DIZER" : "NÃO DEVIDA"}
        </span>
      </div>

      <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>{veredito.motivo}</div>
      {veredito.acao && <div style={{ fontSize: "0.78rem", color: C.muted, lineHeight: 1.5 }}>{veredito.acao}</div>}

      <div style={{ fontSize: "0.72rem", color: C.muted, borderTop: `1px solid ${C.borda}`, paddingTop: 8 }}>
        {veredito.fonte}
      </div>
    </div>
  );
}

export function EntregaPorArquivo({ companyId, regime, tipo = "EFD_CONTRIBUICOES", rotulo = "EFD-Contribuições", competencia }) {
  const [entrega, setEntrega] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // ⚠ O veredito é calculado ANTES do efeito de carga, mas o efeito respeita o mesmo hook order —
  // por isso ele fica aqui e o `return` antecipado vem depois de todos os hooks.
  const veredito = obrigatoriedadeEfdContribuicoes({ regime, competencia });
  const devida = veredito.situacao === "obrigada";

  useEffect(() => {
    // Empresa que não deve a obrigação não gasta uma chamada perguntando pela entrega dela.
    if (!companyId || !competencia || !devida) return undefined;
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
  }, [companyId, tipo, competencia, devida]);

  async function salvar(patch) {
    setSalvando(true); setErro("");
    try {
      const r = await entregasApi.salvarEntregaObrigacao?.(companyId, tipo, competencia, patch);
      setEntrega(r?.entrega || null);
    } catch (e) {
      setErro(e?.message || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }

  if (!devida) return <ObrigacaoNaoDevida rotulo={rotulo} competencia={competencia} veredito={veredito} />;

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

      {/* ⚠ DEZEMBRO NÃO É UM MÊS COMO OS OUTROS. É ele que consolida no registro 0120 os meses
          dispensados do ano — então nunca é dispensável por falta de movimento. O aviso fica na
          competência de dezembro, e não numa nota geral que ninguém lê em dezembro. */}
      {ehCompetenciaQueConsolidaOAno(competencia) && (
        <div style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.alerta}`, background: "rgba(255,179,71,0.10)", fontSize: "0.76rem", lineHeight: 1.5 }}>
          <strong style={{ color: C.alerta }}>Dezembro é obrigatório mesmo sem movimento.</strong>{" "}
          A escrituração de dezembro consolida no registro <strong>0120</strong> os meses dispensados do
          ano — deixar de entregar deixa o ano sem essa consolidação.
        </div>
      )}

      {/* ⚠ AS DISPENSAS QUE NÃO CONSEGUIMOS AVALIAR APARECEM JUNTO DA OBRIGAÇÃO, não escondidas.
          Imunidade, mês sem receita e inatividade dependem de dado que o sistema não guarda. Ficam
          nomeadas para o contador conferir — é o que impede "obrigada" de ser lido como "sem saída",
          sem que o sistema afirme uma dispensa que não pode verificar. */}
      {veredito.dispensasNaoAvaliadas.length > 0 && (
        <details style={{ fontSize: "0.75rem", color: C.muted }}>
          <summary style={{ cursor: "pointer" }}>Há dispensas que dependem de dado que o sistema não guarda — confira</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 5, lineHeight: 1.5 }}>
            {veredito.dispensasNaoAvaliadas.map((d) => (
              <li key={d.chave}><strong style={{ color: C.texto }}>{d.titulo}</strong> — {d.detalhe}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ⚠ A obrigação NUNCA some da tela por falta de suporte TÉCNICO. Ela só sai quando a LEI não
          a exige (aí vira `ObrigacaoNaoDevida`, com a norma citada). Gerador não implementado ou PVA
          indisponível não apagam a linha: sumir por limitação nossa transformaria "não sabemos
          fazer" em "não existe obrigação", que é o erro caro. */}
      <div style={{ fontSize: "0.74rem", color: C.muted, borderTop: `1px solid ${C.borda}`, paddingTop: 8, lineHeight: 1.5 }}>
        O app <strong>ainda não gera</strong> o arquivo da {rotulo}: o leiaute oficial (Guia Prático v1.35)
        já está no repositório, mas o gerador não foi construído — hoje o arquivo sai do seu sistema
        contábil ou do PVA. E o app <strong>não transmite</strong>, o que é diferente: validação, assinatura
        e transmissão são etapas do programa oficial e não têm API. Prazo legal: <strong>10º dia útil do 2º
        mês seguinte</strong> à competência.
      </div>
    </div>
  );
}

const btnSec = {
  background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6,
  padding: "4px 10px", font: "inherit", fontSize: "0.76rem", cursor: "pointer",
};
