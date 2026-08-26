// A SIMULAÇÃO DE PRÓ-LABORE — quanto falta para o Fator R, e quanto isso custa ao sócio.
//
// O dono nomeou esta conta como a mais valiosa do produto: *"quanto de pró-labore preciso para
// chegar a 28%, quanto isso custa em INSS/IRPF do sócio, e quanto economiza no DAS. Nesse caso o
// resultado fica próximo do empate — exatamente o cálculo que o contador não consegue fazer de
// cabeça e pelo qual pagaria pela ferramenta."*
//
// ⚠ A REGRA mora em `lib/proLabore.js` (25 testes) — aqui é a LIGAÇÃO. Nenhuma conta nesta tela.

import { RECUSA } from "../lib/proLabore";

const C = {
  surface: "#24253A", borda: "#44475A", texto: "#F8F8F2",
  muted: "#A7B0C0", accent: "#BD93F9", alerta: "#FFB347", ok: "#8BE9FD",
};

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

const caixa = { padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface };
const titulo = { fontSize: "0.9rem", fontWeight: 700, color: C.texto, marginBottom: 8 };

export function PainelProLabore({ simulacao }) {
  if (!simulacao) return null;

  // ⚠⚠ RECUSA COM O MESMO PESO DO NÚMERO — a regra do módulo. Um painel que some quando não sabe
  // calcular faz o contador achar que a pergunta não existe; um que mostra a recusa em cinza
  // discreto faz ausência de número virar ausência de dúvida.
  if (simulacao.recusa) {
    const jaAtinge = simulacao.recusa === RECUSA.JA_ATINGE;
    return (
      <div style={caixa}>
        <div style={titulo}>Pró-labore e o Fator R</div>
        <div style={{ fontSize: "0.86rem", color: jaAtinge ? C.ok : C.alerta, lineHeight: 1.5 }}>
          {simulacao.motivo}
        </div>
      </div>
    );
  }

  const { compensa, saldoAnual } = simulacao;

  return (
    <div style={caixa}>
      <div style={titulo}>Pró-labore e o Fator R</div>
      <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 10, lineHeight: 1.45 }}>
        O Fator R está em <strong style={{ color: C.texto }}>{pct(simulacao.fatorRAtual)}</strong> e precisa
        chegar a <strong style={{ color: C.texto }}>28%</strong> para a empresa ficar no Anexo{" "}
        {simulacao.anexoDestino}.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <Bloco rotulo="Pró-labore mensal hoje" valor={brl(simulacao.proLaboreHoje)} />
        <Bloco
          rotulo="Precisaria ser"
          valor={brl(simulacao.proLaboreDepois)}
          nota={`+ ${brl(simulacao.aumentoMensal)} por mês`}
          destaque
        />
        <Bloco
          rotulo="Custo a mais para o sócio"
          valor={brl(simulacao.custoAnualIncremental)}
          // ⚠ "no ano" e "a mais" na mesma linha: o número é INCREMENTAL, não o imposto total do
          // pró-labore. Sem o rótulo, ele seria lido como o custo inteiro e a decisão pareceria pior.
          nota="INSS + IRRF, no ano, só sobre o aumento"
        />
        <Bloco
          rotulo="Economia no DAS"
          // ⚠⚠ AUSENTE NÃO É ZERO. Sem a economia calculada, a célula DIZ isso — um "R$ 0,00" aqui
          // faria a decisão parecer sempre ruim por falta de metade da conta.
          valor={simulacao.economiaNoDas == null ? "não calculada" : brl(simulacao.economiaNoDas)}
          nota={simulacao.economiaNoDas == null ? "informe a folha e o anexo" : `por ficar no ${simulacao.anexoDestino} em vez do V`}
        />
      </div>

      {/* ⚠ O VEREDITO SÓ EXISTE COM OS DOIS LADOS DA CONTA. */}
      {saldoAnual != null ? (
        <div style={{
          marginTop: 10, padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${compensa ? C.ok : C.alerta}44`,
          background: "#1A1B26",
        }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: compensa ? C.ok : C.alerta }}>
            {compensa
              ? `Compensa: sobra ${brl(saldoAnual)} no ano`
              : `Não compensa: custa ${brl(Math.abs(saldoAnual))} a mais no ano`}
          </div>
          <div style={{ fontSize: "0.72rem", color: C.muted, marginTop: 2 }}>
            economia no DAS menos o custo a mais do sócio
          </div>
        </div>
      ) : null}

      {/* ⚠⚠ A PREMISSA QUE DECIDE O RESULTADO VAI IMPRESSA, não em rodapé recolhido: se ela não
          valer (Anexo IV), a conta inteira muda de sinal. */}
      <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: "0.68rem", color: C.muted, lineHeight: 1.5 }}>
        {simulacao.premissas.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <div style={{ fontSize: "0.68rem", color: C.alerta, marginTop: 6, lineHeight: 1.5 }}>
        ⚠ Fora desta conta: {simulacao.naoConsiderado.join(" · ")}.
      </div>
    </div>
  );
}

function Bloco({ rotulo, valor, nota, destaque }) {
  return (
    <div style={{ padding: 10, border: `1px solid ${C.borda}`, borderRadius: 8 }}>
      <div style={{ fontSize: "0.66rem", color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {rotulo}
      </div>
      <div style={{ fontSize: "1rem", fontWeight: 700, color: destaque ? C.accent : C.texto, marginTop: 2 }}>
        {valor}
      </div>
      {nota ? <div style={{ fontSize: "0.66rem", color: C.muted, marginTop: 2 }}>{nota}</div> : null}
    </div>
  );
}
