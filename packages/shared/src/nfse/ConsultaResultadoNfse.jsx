import { useEffect, useRef, useState } from 'react';

// Consulta explícita da tentativa persistida. Não recebe payload nem função de emissão.
export function ConsultaResultadoNfse({ companyId, invoiceId, consultar, aoRecuperar }) {
  const [estado, setEstado] = useState({});
  const contexto = useRef(null);
  useEffect(() => {
    const atual = { companyId, invoiceId, ocupado: false };
    contexto.current = atual; setEstado({});
    return () => { if (contexto.current === atual) contexto.current = null; };
  }, [companyId, invoiceId]);
  if (!companyId || !invoiceId || typeof consultar !== 'function') return null;
  async function consultarResultado() {
    const atual = contexto.current;
    if (!atual || atual.ocupado) return;
    atual.ocupado = true; setEstado({ ocupado: true });
    try {
      const r = await consultar(atual.companyId, atual.invoiceId);
      if (contexto.current !== atual) return;
      if (!['MESMA', 'OUTRA', 'INCONCLUSIVA'].includes(r?.estado)) throw new Error('Resposta de consulta inválida. Mantenha esta tentativa bloqueada e consulte o contador.');
      setEstado({ resultado: r });
      if (r.estado === 'MESMA') aoRecuperar?.(r);
    } catch (e) {
      if (contexto.current === atual) setEstado({ erro: 'Não foi possível consultar o resultado. Tente consultar novamente ou peça ao contador para conferir esta tentativa. Nenhuma nota foi reenviada.' });
    } finally { atual.ocupado = false; }
  }
  const r = estado.resultado;
  return <div style={{ marginTop: 12 }}>
    {r?.estado === 'MESMA' ? <div role="status"><strong>Nota autorizada recuperada</strong><p>A consulta encontrou a mesma operação já autorizada. Nenhuma nova nota foi emitida nesta consulta.</p>{r.nfse?.numeroNfse && <p>Número: {r.nfse.numeroNfse}</p>}{r.nfse?.chaveAcesso && <p>Chave de acesso: {r.nfse.chaveAcesso}</p>}</div> : <>
      <button type="button" className="btn btn-primary" disabled={estado.ocupado} onClick={consultarResultado}>{estado.ocupado ? 'Consultando resultado…' : 'Consultar resultado'}</button>
      {r && <div role="status"><p>{r.message || 'A consulta não confirmou que esta nota corresponde à tentativa.'}</p><p>Mantenha a conferência com o contador. Não reenvie nem altere a numeração por conta própria.</p></div>}
    </>}
    {estado.erro && <p role="alert">{estado.erro}</p>}
  </div>;
}
