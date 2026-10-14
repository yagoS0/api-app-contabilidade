import { useState } from 'react';
import './comparacao-tributaria.css';
import { custoAnualSimples, folhaParaFatorR } from '../../planejamento/lib/simplesNacional';
import { custoAnualPresumido, ATIVIDADES_PRESUMIDO } from '../../planejamento/lib/lucroPresumido';
import { FATOR_R_LIMITE } from '../../planejamento/lib/tabelasFiscais';
import { PANEL, fmtMoney } from '../../notas/components/notasStyles';
import { anexosDaEmpresa } from '../lib/anexoDaEmpresa';

const numero = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
const pct = v => v == null ? '—' : `${(v * 100).toFixed(4).replace('.', ',')}%`;
const campo = { display: 'grid', gap: 6, minWidth: 0 };
const input = { width: '100%', minWidth: 0, boxSizing: 'border-box', minHeight: 44, background: PANEL.field, color: PANEL.text, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: '8px 10px', font: 'inherit' };

export function ComparacaoTributaria({ competencia, rbt12, origem, receitaMensal, receitaExterna = 0, folha12m, atividades = [] }) {
  const [folhaEditada, setFolha] = useState(null);
  const [remuneracoes, setRemuneracoes] = useState('');
  const [iss, setIss] = useState('');
  const [atividade, setAtividade] = useState('servicos');
  const folha = numero(folhaEditada === null ? folha12m : folhaEditada);
  const rbt = numero(rbt12);
  const receita = numero(receitaMensal);
  const remuneracao = numero(remuneracoes);
  const issNumero = numero(iss);
  const issInvalido = iss !== '' && (issNumero == null || issNumero < 2 || issNumero > 5);
  const aliquotaIss = issNumero == null || issInvalido ? null : issNumero / 100;
  const fator = folhaParaFatorR(folha, rbt);
  // Arredondar para cima: arredondamento comum pode deixar a folha abaixo dos 28%.
  const alvo = rbt > 0 ? Math.ceil((rbt * FATOR_R_LIMITE - 1e-8) * 100) / 100 : null;
  const falta = alvo == null || folha == null ? null : Math.max(0, Math.round((alvo - folha) * 100) / 100);
  const sujeita = atividades.some(a => a.sujeitoFatorR === true);
  const atuais = anexosDaEmpresa({ atividades, rbt12, folha12m: folha }).anexos;
  const podeComparar = rbt > 0 && receita != null && Number(receitaExterna) === 0 && !issInvalido;
  const comum = { rbt12: rbt, receitaAnual: receita * 12, folhaAnual: remuneracao, aliquotaIss };
  const linhas = podeComparar ? [
    ...['I', 'II', 'III', 'IV', 'V'].map(anexo => ({
      nome: `Simples — Anexo ${anexo}`,
      contexto: atuais.includes(anexo) ? 'Previsto nas atividades desta competência' : 'Cenário hipotético; depende da atividade',
      ...custoAnualSimples({ ...comum, anexoChave: anexo }),
    })),
    { nome: 'Lucro Presumido', contexto: ATIVIDADES_PRESUMIDO[atividade].rotulo,
      ...custoAnualPresumido({ ...comum, atividade, anoBase: Number(competencia?.slice(0, 4)) || 2026 }) },
  ] : [];
  return <details className="comparacao-tributaria" style={{ minWidth: 0, color: PANEL.text, fontSize: '0.875rem' }}>
    <summary className="comparacao-tributaria-abertura">Comparação tributária e Fator R <span>Simulação</span></summary>
    <div className="comparacao-tributaria-conteudo">
    <p className="comparacao-tributaria-aviso">Não altera a apuração nem autoriza mudança de anexo.</p>
    {origem === 'PARCIAL_LOCAL' && <p role="status" className="comparacao-tributaria-alerta">RBT12 parcial: faltam dados oficiais para confirmar toda a janela. A comparação usa a base disponível.</p>}
    <div style={{ padding: 16, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, display: 'grid', gap: 12 }}>
      <strong>Quanto falta para atingir 28%</strong>
      <p style={{ margin: 0 }}>{sujeita ? 'Nas atividades sujeitas ao Fator R: 28% ou mais leva ao Anexo III; abaixo, ao Anexo V.' : 'O Fator R não altera o anexo das atividades atuais. Os valores abaixo permitem estudar uma atividade sujeita ao fator.'}</p>
      <label style={campo}>Folha elegível dos 12 meses anteriores (R$)
        <input aria-label="Folha elegível dos 12 meses anteriores (R$)" type="number" min="0" step="0.01" style={input} value={folhaEditada === null ? folha12m ?? '' : folhaEditada} onChange={e => setFolha(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 16 }}>
        <div>Folha mínima na janela<br/><strong>{alvo == null ? 'RBT12 não disponível' : fmtMoney(alvo)}</strong></div>
        <div>Relação folha / receita<br/><strong>{pct(fator?.fatorR)}</strong></div>
        <div>Falta de folha na janela<br/><strong>{falta == null ? 'Informe a folha elegível' : falta === 0 ? 'Limite de 28% atingido' : fmtMoney(falta)}</strong></div>
      </div>
      <p style={{ margin: 0, color: PANEL.muted }}>Use salários, pró-labore e encargos elegíveis efetivamente pagos nos 12 meses anteriores. A diferença é acumulada nessa janela; pagar agora não modifica uma competência passada. Valores editados aqui são apenas uma simulação.</p>
    </div>
    <details className="comparacao-tributaria-regimes" style={{ minWidth: 0 }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, display: 'list-item', fontWeight: 600 }}>Comparar anexos I a V e Lucro Presumido</summary>
      <p>Base mensal: <strong>{receita == null ? 'não informada' : fmtMoney(receita)}</strong> · RBT12: <strong>{rbt == null ? 'não informado' : fmtMoney(rbt)}</strong>. Projeção uniforme de 12 meses com as alíquotas desta base. Não substitui a apuração nem autoriza mudança de anexo.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16, marginBottom: 16 }}>
        <label style={campo}>Atividade no Presumido<select style={input} value={atividade} onChange={e => setAtividade(e.target.value)}>{Object.entries(ATIVIDADES_PRESUMIDO).map(([key, v]) => <option key={key} value={key}>{v.rotulo}</option>)}</select></label>
        <label style={campo}>ISS do cenário (%)<input style={input} type="number" min="2" max="5" step="0.01" value={iss} onChange={e => setIss(e.target.value)}/></label>
        <label style={campo}>Remunerações anuais sem encargos (R$)<input style={input} type="number" min="0" step="0.01" value={remuneracoes} onChange={e => setRemuneracoes(e.target.value)}/></label>
      </div>
      {issInvalido && <p role="alert">Informe ISS entre 2% e 5% ou deixe em branco para indicar que não foi estimado.</p>}
      {Number(receitaExterna) > 0 && <p role="status">A receita de exportação exige segregação. Use a simulação detalhada do Planejamento para comparar este cenário.</p>}
      {!(rbt > 0) && <p role="status">Confirme o RBT12 antes de comparar os regimes.</p>}
      {linhas.length > 0 && <div className="comparacao-tributaria-tabela" tabIndex={0} role="region" aria-label="Estimativas por regime" style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left', padding: '8px 0' }}>Estimativas para {competencia} — cada anexo pressupõe toda a receita nessa atividade</caption>
        <thead><tr>{['Regime / anexo', 'Carga estimada', 'Média mensal', 'Total anual'].map(t => <th key={t} style={{ padding: 10, textAlign: 'left', borderBottom: `1px solid ${PANEL.border}` }}>{t}</th>)}</tr></thead>
        <tbody>{linhas.map(l => <tr key={l.nome}>
          <td style={{ padding: 10, borderBottom: `1px solid ${PANEL.border}` }}><strong>{l.nome}</strong><div>{l.contexto}</div></td>
          {[pct(l.cargaEfetiva), fmtMoney(l.total / 12), fmtMoney(l.total)].map((v, i) => <td key={i} style={{ padding: 10, whiteSpace: 'nowrap', borderBottom: `1px solid ${PANEL.border}` }}>{l.indisponivel || l.elegivel === false ? 'Indisponível' : v}</td>)}
        </tr>)}</tbody>
      </table></div>}
      {linhas.filter(l => l.motivo || l.naoConsiderado?.length).map(l => <p key={l.nome} style={{ color: PANEL.muted }}><strong>{l.nome}:</strong> {l.motivo || (l.naoConsiderado?.length ? `Fora desta estimativa: ${l.naoConsiderado.join('; ')}.` : 'Tributos incluídos conforme as premissas informadas.')}</p>)}
    </details>
    </div>
  </details>;
}
