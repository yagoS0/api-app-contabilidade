// O FIO ABERTO — cabeçalho, balões e compositor. Extraído de `pages/renderWhatsappPage.jsx` em
// 06/09/2026 porque ganhou um SEGUNDO consumidor concreto: a mesma conversa dentro da empresa,
// ao lado das Anotações (F2). Extrair antes do segundo consumidor seria abstração sem caso.
//
// ⚠ `LinhaConversa` e `FormVincular` FICARAM na página, e por motivo: dentro da empresa a linha
// mostraria o nome da empresa em cada item (ruído — todas são a mesma), e o vínculo não existe lá
// (ali `portalClientId` nunca é nulo). Por isso o vínculo entra por `slotVincular`: quem tem a fila
// passa o formulário; a aba da empresa simplesmente não passa nada.
//
// ⚠⚠ A IDENTIDADE SÃO DUAS PERGUNTAS — *quem* está falando e *de qual empresa* —, e uma não
// substitui a outra. Ver `identidadeDaConversa` em `../lib/conversasTela.js`.

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { formatarCnpj } from "../../onboarding/lib/brasilApi";
import {
  SITUACAO_FIO,
  situacaoDoFio,
  rotuloDaSituacao,
  rotuloDoAutor,
  estadoDaResposta,
  fmtDataHora,
  identidadeDaConversa,
  descricaoDaMidia,
  frasePaginacao,
} from "../lib/conversasTela";

export const campo = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
export const COR_TOM = { aviso: "var(--state-warn)", neutro: "var(--text-muted)" };

/**
 * A empresa da conversa, em UMA linha — razão social + CNPJ.
 *
 * ⚠ Sem empresa a frase é a do estado da fila (*"sem empresa — número novo"*), em âmbar, porque é
 * pendência do escritório. Ela nunca some: linha em branco se lê como "não tem nada a dizer".
 */
export function LinhaDaEmpresa({ identidade, tamanho = "0.74rem" }) {
  return (
    <span
      data-testid="empresa-da-conversa"
      data-sem-empresa={identidade.semEmpresa ? "sim" : "nao"}
      style={{ fontSize: tamanho, color: identidade.semEmpresa ? "var(--state-warn)" : "var(--text-muted)" }}
    >
      {identidade.linhaDaEmpresa}
      {identidade.cnpj ? ` · ${formatarCnpj(identidade.cnpj)}` : ""}
    </span>
  );
}

/**
 * Quem está falando. ⚠ `avisoDoNome` acompanha o nome que NÃO veio do cadastro — o do perfil é o
 * que a própria pessoa escreveu no aparelho dela, e a tela precisa poder dizer isso.
 */
export function NomeDaPessoa({ identidade, tamanho = "0.88rem" }) {
  return (
    <>
      <strong data-testid="pessoa-da-conversa" data-origem={identidade.origemDoNome} style={{ fontSize: tamanho }}>
        {identidade.pessoa}
      </strong>
      {identidade.papel ? <span style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>{identidade.papel}</span> : null}
      {identidade.avisoDoNome ? (
        <span data-testid="aviso-do-nome" style={{ fontSize: "0.68rem", color: "var(--text-faint)" }}>({identidade.avisoDoNome})</span>
      ) : null}
    </>
  );
}

export function FioDaConversa({ fio, hook, slotVincular = null, temMais = null }) {
  const { conversa, mensagens } = fio;
  const [texto, setTexto] = useState("");
  const [recusa, setRecusa] = useState(null);
  const situacao = situacaoDoFio(conversa);
  const resposta = estadoDaResposta(conversa);
  const identidade = identidadeDaConversa(conversa);
  // ⚠ O autor do balão de ENTRADA segue a MESMA autoridade do cabeçalho: o cadastro primeiro.
  // Com só o nome de perfil aqui, o cabeçalho dizia "Financeiro" (cadastro) e o balão logo abaixo
  // dizia "Fin. Empresa 1" (perfil) — duas respostas para "quem escreveu isto", na mesma tela.
  // ⚠ Sem nome nenhum continua caindo em "cliente", que é o que `rotuloDoAutor` já respondia.
  const nomeDoCliente = conversa?.contato?.nome || conversa?.nomePerfilProvedor || null;
  const avisoDePaginacao = frasePaginacao(temMais);

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    setRecusa(null);
    const r = await hook.responder(conversa.id, t);
    if (r?.ok === false) setRecusa(r.erro?.payload?.message || r.erro?.message || "Não foi possível responder.");
    else setTexto("");
  }

  return (
    <div data-testid="fio" style={{ display: "flex", flexDirection: "column", minHeight: 400 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
            <NomeDaPessoa identidade={identidade} tamanho="0.95rem" />
          </span>
          <LinhaDaEmpresa identidade={identidade} tamanho="0.76rem" />
          <span style={{ fontSize: "0.74rem", color: COR_TOM[rotuloDaSituacao(conversa).tom] }}>
            {conversa.telefoneMascarado} · {rotuloDaSituacao(conversa).texto}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {situacao === SITUACAO_FIO.ASSUMIDA ? (
            <Button variant="secondary" disabled={hook.ocupado} onClick={() => hook.devolver(conversa.id)} title="O assistente volta a responder neste fio">Devolver à IA</Button>
          ) : situacao !== SITUACAO_FIO.FILA_SEM_EMPRESA ? (
            <Button variant="secondary" disabled={hook.ocupado} onClick={() => hook.assumir(conversa.id)} title="Você responde; o assistente fica em silêncio">Assumir</Button>
          ) : null}
        </div>
      </div>

      {conversa.pendencia ? (
        <div data-testid="pendencia-aberta" style={{ fontSize: "0.78rem", padding: "6px 10px", border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)", borderRadius: "var(--radius-sm)", marginBottom: 8 }}>
          Pedido aguardando confirmação do cliente: <strong>{conversa.pendencia.tipo}</strong> · código <strong>{conversa.pendencia.codigo}</strong> · expira {fmtDataHora(conversa.pendencia.expiraEm)}.
        </div>
      ) : null}

      {situacao === SITUACAO_FIO.FILA_SEM_EMPRESA ? slotVincular : null}

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-page)", marginBottom: 8 }}>
        {/* ⚠ O corte deixou de ser silencioso: a tela DIZ que há conversa antes do primeiro balão. */}
        {avisoDePaginacao ? (
          <p data-testid="aviso-paginacao" style={{ fontSize: "0.72rem", color: "var(--text-faint)", margin: "0 8px 8px", textAlign: "center" }}>{avisoDePaginacao}</p>
        ) : null}
        {mensagens.length === 0 ? <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: 8 }}>Nenhuma mensagem neste fio.</p> : null}
        {mensagens.map((m) => {
          const entrada = m.direcao === "in";
          const midia = descricaoDaMidia(m);
          return (
            <div key={m.id} data-testid={`balao-${m.id}`} data-autor={m.autor || (entrada ? "cliente" : "sem-autor")} style={{ display: "flex", justifyContent: entrada ? "flex-start" : "flex-end", marginBottom: 6 }}>
              <div style={{ maxWidth: "78%", padding: "6px 10px", borderRadius: 10, fontSize: "0.82rem", background: entrada ? "var(--bg-subtle)" : "var(--accent-purple-surface)", border: `1px solid ${entrada ? "var(--border)" : "var(--accent-purple-border)"}`, color: "var(--text)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-faint)", marginBottom: 2 }}>{rotuloDoAutor(m, { nomeDoCliente })} · {fmtDataHora(m.ocorridaEmProvedor || m.registradaEm)}</div>
                {/* ⚠ `[image]` não é frase: a mídia vira o que CHEGOU, dizendo que não dá para abrir ainda. */}
                {midia ? <div data-testid="midia-do-balao" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{midia}</div> : null}
                {m.corpo ? <div style={{ whiteSpace: "pre-wrap" }}>{m.corpo}</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* ⚠ A JANELA É DITA ANTES DE DIGITAR: campo desabilitado com o motivo, nunca campo que recusa depois. */}
      <div>
        {!resposta.pode ? <p data-testid="resposta-bloqueada" style={{ fontSize: "0.76rem", color: "var(--state-warn)", margin: "0 0 6px" }}>{resposta.motivo}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            aria-label="Responder ao cliente"
            style={{ ...campo, minHeight: 56, resize: "vertical" }}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={!resposta.pode || hook.ocupado}
            placeholder={resposta.pode ? "Escreva a resposta — sai como mensagem do escritório" : "Fora da janela de 24h"}
          />
          <Button variant="primary" disabled={!resposta.pode || !texto.trim() || hook.ocupado} onClick={enviar}>Responder</Button>
        </div>
        {recusa ? <p role="alert" style={{ fontSize: "0.76rem", color: "var(--state-danger)", margin: "6px 0 0" }}>{recusa}</p> : null}
      </div>
    </div>
  );
}

export default FioDaConversa;
