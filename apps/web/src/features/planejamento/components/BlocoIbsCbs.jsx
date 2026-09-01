// IBS E CBS NO SIMPLES — o bloco que responde a decisão de setembro.
//
// ⚠⚠ ESTE BLOCO NÃO CALCULA NADA. Toda a regra mora em `lib/ibsCbsNoSimples.js`, que por sua vez
// só lê a lei (`docs/reforma-consumo/`, com hash) e o número que o contador digita. Aqui é
// LIGAÇÃO: escolher o cenário, mostrar o que a regra devolveu, e dizer o que não se sabe.
//
// ⚠ Ler `docs/fontes-fiscais.md` §6.1 antes de mexer nos textos: cada frase daqui cita um
// dispositivo, e a pesquisa que os levantou derrubou quatro afirmações de um plano escrito sem a
// lei na frente.

import {
  CENARIO,
  ibsCbsDoSimples,
  IBS_2027_2028,
  OPCAO_POR_FORA,
} from "../lib/ibsCbsNoSimples";
import { lerPercentual, textoDoPercentualForaDaFaixa } from "../lib/campoNumerico";

const brl = (n) =>
  n == null ? "—" : `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n, casas = 3) =>
  n == null ? "—" : `${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: casas })}%`;

export function BlocoIbsCbs({
  cenario,
  aoTrocarCenario,
  cbsEstimada,
  aoMudarCbs,
  anexo,
  faixa,
  aliquotaEfetivaPct,
  dasAnual,
  receitaAnual,
  cores: C,
  rotulo,
  campo,
}) {
  const cbsLida = lerPercentual(cbsEstimada);
  const r = ibsCbsDoSimples({
    cenario,
    anexo,
    faixa,
    aliquotaEfetivaPct,
    cbsEstimadaPct: cbsLida.valor,
    dasAnual,
    receitaAnual,
  });

  const caixa = {
    padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface,
    display: "grid", gap: 12,
  };
  const nota = { fontSize: "0.72rem", color: C.muted, lineHeight: 1.5, margin: 0 };

  return (
    <section style={caixa} aria-label="IBS e CBS no Simples Nacional">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ color: C.texto, fontSize: "0.95rem" }}>IBS e CBS no Simples Nacional</strong>
        {/* ⚠ `mode="view"` seria a barra de abas do app, mas aqui são dois botões dentro de um
            bloco — a barra global é da PÁGINA. Dois `aria-pressed` bastam e não competem com ela. */}
        <div role="group" aria-label="Cenário" style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[
            [CENARIO.EM_2026, "2026"],
            [CENARIO.DE_2027_A_2028, "2027–2028"],
          ].map(([chave, texto]) => {
            const ativo = cenario === chave;
            return (
              <button
                key={chave}
                type="button"
                aria-pressed={ativo}
                onClick={() => aoTrocarCenario(chave)}
                /* ⚠ O ATIVO SE DISTINGUE PELA ESPESSURA DA BORDA, não por uma cor de fundo nova.
                   É o precedente escrito do calendário ("trocar a cor quebraria a lei de estado"),
                   e aqui há um motivo a mais: não existe token `--accent-surface`, e derivar o
                   fundo com `${cor}22` quebra em silêncio assim que a cor vira `var(--…)`. */
                style={{
                  padding: "4px 12px", borderRadius: 999, cursor: "pointer",
                  fontSize: "0.78rem", fontWeight: ativo ? 700 : 600,
                  border: `${ativo ? 2 : 1}px solid ${ativo ? C.accent : C.borda}`,
                  background: "transparent",
                  color: ativo ? C.accent : C.muted,
                }}
              >
                {texto}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 2026: ZERO, e com fundamento ─────────────────────────────────────────────────── */}
      {r.zeroPorLei ? (
        <>
          {/* ⚠⚠ ZERO NÃO É "NÃO DEU PARA CALCULAR", e o desenho tem de dizer isso. Um traço cinza
              aqui seria lido como ausência de dado — e o dono pediu, com todas as letras, que a
              tela MOSTRE que em 2026 é zero. */}
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ color: C.texto, fontSize: "1.35rem", fontWeight: 700 }}>R$ 0,00</div>
            <div style={{ color: C.texto, fontSize: "0.84rem", fontWeight: 600 }}>{r.titulo}</div>
          </div>
          <p style={nota}>{r.explicacao}</p>
          <p style={nota}>
            Fundamento: <strong>{r.fundamento}</strong>. As alíquotas de teste de 2026 existem
            (IBS 0,1% e CBS 0,9%) — o que a lei diz é que elas <strong>não alcançam</strong> quem é
            optante.
          </p>
          <p style={nota}>
            ⚠ A decisão que <strong>existe agora</strong> é sobre 2027: veja o cenário
            <strong> 2027–2028</strong>, ao lado.
          </p>
        </>
      ) : null}

      {/* ─── 2027–2028: por dentro × por fora ─────────────────────────────────────────────── */}
      {r.cenario === CENARIO.DE_2027_A_2028 ? (
        <>
          <label style={{ ...rotulo, maxWidth: 320 }}>
            Alíquota da CBS no regime regular (%) — estimativa sua
            <input
              value={cbsEstimada}
              onChange={(e) => aoMudarCbs(e.target.value)}
              inputMode="decimal"
              placeholder="ainda não fixada em lei"
              style={campo}
            />
            {cbsLida.fora && (
              <span style={{ display: "block", marginTop: 4, fontSize: "0.72rem", color: "var(--state-warn)" }}>
                {textoDoPercentualForaDaFaixa("A alíquota da CBS")}
              </span>
            )}
          </label>
          {/* ⚠⚠ A FRASE DO CAMPO É OBRIGATÓRIA. Um percentual num campo sem ela é lido como se
              fosse lei — e este número vai impresso ao cliente. */}
          <p style={nota}>
            ⚠ <strong>O IBS não se digita:</strong> em 2027 e 2028 ele é{" "}
            {pct(IBS_2027_2028.estadual, 2)} estadual + {pct(IBS_2027_2028.municipal, 2)} municipal
            (<strong>{IBS_2027_2028.fundamento}</strong>). Só a CBS falta ser fixada — por resolução
            do Senado, até <strong>15/12/2026</strong>.
          </p>

          {/* ⚠⚠⚠ QUANTO A EMPRESA PAGA — VEM PRIMEIRO. Defeito relatado pelo dono em 01/09/2026:
              *"o que não ficou claro no CBS e IBS é quanto meu cliente vai pagar de imposto; no
              caso ela só diz quanto de crédito ele vai gerar"*. O crédito transferido responde
              "quanto o cliente DO meu cliente ganha" — sozinho, ele não ajuda quem precisa
              escolher entre ficar e sair. */}
          {r.imposto ? (
            <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.borda}`, display: "grid", gap: 6 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: C.texto }}>
                Quanto esta empresa vai pagar
              </div>

              {/*
                ⚠⚠ ESTA FRASE ERA CRAVADA ("o DAS não muda") E É FALSA NA 6ª FAIXA — a alíquota
                nominal do Anexo cai 0,10 pp em 2027-2028 nos cinco anexos, e volta em 2029. Hoje
                ela vem de `mudaEmRelacaoAHoje`, que é MEDIDO contra a tabela vigente.
                ⚠ No caso que muda a tela **não inventa o DAS novo**: ele depende do RBT12, que esta
                simulação não recebe. Ela diz o que muda, o sentido, e que o número não foi calculado.
              */}
              {r.imposto.porDentro.mudaEmRelacaoAHoje ? (
                <div style={{ fontSize: "0.78rem", color: C.texto, lineHeight: 1.5 }}>
                  <strong>Ficando por dentro: nesta faixa o DAS muda — para menos.</strong> Hoje ele é{" "}
                  {brl(r.imposto.porDentro.dasAnual)} por ano; o valor de 2027-2028 não é calculado aqui.
                </div>
              ) : (
                <div style={{ fontSize: "0.78rem", color: C.texto, lineHeight: 1.5 }}>
                  <strong>Ficando por dentro: o DAS não muda</strong> — {brl(r.imposto.porDentro.dasAnual)} por ano,
                  o mesmo de hoje.
                </div>
              )}
              <div style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.5 }}>
                {r.imposto.porDentro.explicacao} Dentro dele,{" "}
                <strong>{brl(r.imposto.porDentro.cbsDentroDoDas)}</strong> é CBS
                {r.imposto.porDentro.ibsDentroDoDas != null ? (
                  <> e <strong>{brl(r.imposto.porDentro.ibsDentroDoDas)}</strong> é IBS</>
                ) : (
                  <> — nesta faixa não há parcela de IBS no DAS (sublimite)</>
                )}.
              </div>

              {r.imposto.porFora ? (
                <>
                  <div style={{ fontSize: "0.78rem", color: C.texto, lineHeight: 1.5, marginTop: 4 }}>
                    <strong>Saindo por fora:</strong> saem{" "}
                    {brl(r.imposto.porFora.parcelaQueSaiDoDas)} do DAS por ano, e entra um débito de{" "}
                    {brl(r.imposto.porFora.debitoSobreAReceita)} de IBS/CBS no regime regular —{" "}
                    <strong>antes dos créditos das compras</strong>.
                  </div>
                  {/* ⚠⚠ DIZER QUE A CONTA NÃO FECHA É O PRODUTO. Um "total por fora" cravado aqui
                      seria número inventado num documento que vai ao cliente. */}
                  <div style={{ fontSize: "0.72rem", color: "var(--state-warn)", lineHeight: 1.5 }}>
                    ⚠ <strong>Não dá para fechar esse total aqui</strong>, e por dois motivos:
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {r.imposto.porFora.porQueNaoFecha.map((m) => (
                        <li key={m} style={{ marginBottom: 2 }}>{m}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.5 }}>
                  Informe a alíquota da CBS acima para ver o lado “por fora”.
                </div>
              )}
            </div>
          ) : null}

          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: C.texto, marginTop: 2 }}>
            E quanto de crédito ela transfere a quem compra dela
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.borda}` }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: C.texto }}>
                Por dentro <span style={{ fontWeight: 400, color: C.muted }}>(o padrão)</span>
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: C.texto, marginTop: 4 }}>
                {r.porDentro ? pct(r.porDentro.creditoPct) : "—"}
              </div>
              <div style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.5, marginTop: 4 }}>
                {r.porDentro ? (
                  <>
                    do valor da operação vira crédito para quem compra desta empresa.
                    <br />
                    {pct(r.porDentro.aliquotaEfetivaPct, 2)} (alíquota efetiva) ×{" "}
                    {pct(r.porDentro.somaPercentual, 2)} (CBS
                    {r.porDentro.semIbsNoDas ? "" : " + IBS"} do Anexo {r.porDentro.anexo}, na{" "}
                    {r.porDentro.faixa}ª faixa).
                    {/* ⚠⚠ Sem esta frase, o crédito da 6ª faixa aparece MENOR que o da 5ª e parece
                        erro de conta. Ele é menor porque o IBS não está no DAS. */}
                    {r.porDentro.semIbsNoDas ? (
                      <>
                        <br />
                        ⚠ Nesta faixa o IBS <strong>não está dentro do DAS</strong> (sublimite,
                        LC 123/2006, art. 13-A): não há parcela de IBS a transferir, e o crédito sai
                        só da CBS.
                      </>
                    ) : null}
                  </>
                ) : (
                  "Informe receita, anexo e faixa para calcular."
                )}
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.borda}` }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: C.texto }}>
                Por fora <span style={{ fontWeight: 400, color: C.muted }}>(a opção)</span>
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: C.texto, marginTop: 4 }}>
                {r.porFora ? pct(r.porFora.totalPct) : "—"}
              </div>
              <div style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.5, marginTop: 4 }}>
                {r.porFora ? (
                  <>
                    do valor da operação vira crédito para quem compra — o destaque é cheio.
                    <br />
                    {pct(r.porFora.cbsPct, 2)} (CBS informada) + {pct(r.porFora.ibsPct, 2)} (IBS, da lei).
                  </>
                ) : (
                  // ⚠ Ausência DITA, nunca um número estimado no lugar.
                  "Informe a alíquota da CBS acima. Não estimamos esse número por você."
                )}
              </div>
            </div>
          </div>

          {r.diferencaPct != null ? (
            <p style={{ ...nota, color: C.texto }}>
              A diferença é de <strong>{pct(r.diferencaPct)}</strong> do valor da operação — é isso
              que o cliente da sua cliente deixa de creditar quando ela fica “por dentro”.
              {/* ⚠ Quem decide não é este número sozinho: depende de PARA QUEM a empresa vende.
                  Crédito só tem valor para adquirente do regime regular. */}
              {" "}⚠ Ele só pesa na proporção do que a empresa vende para <strong>PJ do regime
              regular</strong>: para consumidor final, crédito não vale nada.
            </p>
          ) : null}

          <p style={nota}>
            <strong>A janela é irretratável e semestral.</strong> A opção vale para os semestres
            iniciados em {OPCAO_POR_FORA.semestres.join(" e ")}, e é exercida nos meses de{" "}
            {OPCAO_POR_FORA.meses.join(" e ")} imediatamente anteriores
            (<strong>{OPCAO_POR_FORA.fundamento}</strong>).
          </p>
          {/* ⚠⚠ A FRASE MAIS IMPORTANTE DO BLOCO. O § 10 remete a forma da opção à regulamentação
              do CGSN, e não há prova neste repositório de que o ato exista. A tela diz a JANELA
              LEGAL; ela NÃO afirma que o procedimento está disponível. */}
          {OPCAO_POR_FORA.dependeDeRegulamentacao ? (
            <p style={{ ...nota, color: "var(--state-warn)" }}>
              ⚠ A lei remete a forma de exercer a opção à regulamentação do CGSN. Esta tela informa a
              janela <strong>legal</strong> — ela não confirma que o procedimento já está disponível.
              Confirme no portal do Simples Nacional antes de orientar o cliente.
            </p>
          ) : null}
          <p style={nota}>⚠ {OPCAO_POR_FORA.travaDeSaida}</p>
          <p style={nota}>
            Tabelas do Anexo com vigência de {r.vigencia.inicio.slice(0, 4)} a{" "}
            {r.vigencia.fim.slice(0, 4)} ({r.vigencia.fundamento}).
          </p>
        </>
      ) : null}
    </section>
  );
}
