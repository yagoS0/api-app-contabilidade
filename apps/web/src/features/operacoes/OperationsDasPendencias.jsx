import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { operationInstant } from './operationsDetails';
import './OperationsDasPendencias.css';

const pageSize = 12;
export function OperationsDasPendencias({ api, companies, competencia, unavailable = false }) {
  const [open, setOpen] = useState(false), [companyId, setCompanyId] = useState('');
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const generation = useRef(0), pending = useRef(false);
  const token = api?.getAccessToken?.();
  const carteira = JSON.stringify(companies.map(c => c.companyId).sort());
  const context = useRef(null);
  const current = { api, token, carteira, competencia, companyId, open, unavailable };
  context.current = current;
  const invalidate = () => { generation.current += 1; pending.current = false; setResult(null); setError(''); setBusy(false); setPage(0); };
  useLayoutEffect(() => { invalidate(); }, [api, token, carteira, competencia, companyId, open, unavailable]);
  useLayoutEffect(() => { setOpen(false); setCompanyId(''); }, [api, token, carteira, competencia, unavailable]);
  useLayoutEffect(() => () => { generation.current += 1; }, []);
  const selected = companies.find(c => c.companyId === companyId);
  async function consultar() {
    if (pending.current || !selected || unavailable) return;
    const version = ++generation.current, requested = current;
    pending.current = true; setBusy(true); setResult(null); setError(''); setPage(0);
    const valid = () => generation.current === version && Object.keys(requested).every(k => context.current[k] === requested[k]) && api?.getAccessToken?.() === requested.token;
    try {
      if (!api?.getCompanyDasPendencias) throw new Error('Consulta indisponível neste ambiente.');
      const response = await api.getCompanyDasPendencias(companyId, competencia);
      if (!valid()) return;
      if (response?.ok !== true || response.contrato !== 'pendencias-das-leitura-4.4.6' || response.companyId !== companyId || response.competencia !== competencia || !Array.isArray(response.achados) || !Array.isArray(response.fontes) || !Array.isArray(response.limitacoes)) throw new Error('Resposta de leitura indisponível ou incompatível com a seleção.');
      setResult(response);
    } catch (failure) {
      if (valid()) setError(failure?.status === 403 ? 'Leitura desta empresa não autorizada. A presença na carteira não concede acesso a estas evidências.' : failure?.status === 401 ? 'Sessão expirada. Autentique-se para consultar.' : 'Não foi possível consultar as evidências locais. Nenhuma retentativa automática foi realizada.');
    } finally { if (valid()) { pending.current = false; setBusy(false); } }
  }
  return <div className="das-pendencias-access">
    <Button type="button" variant="secondary" size="sm" disabled={unavailable} onClick={() => setOpen(true)}>Pendências DAS/SERPRO</Button>
    {open && !unavailable && <Modal titulo="Pendências DAS/SERPRO" tamanho="lg" aoFechar={() => { invalidate(); setOpen(false); }}>
      <div className="das-pendencias">
        <p>Consulta de evidências locais de uma empresa. Nenhuma chamada ao SERPRO ou alteração de estado.</p>
        <div className="das-pendencias-controls">
          <label>Empresa<select value={companyId} onChange={e => { invalidate(); setCompanyId(e.target.value); }}><option value="">Selecione uma empresa</option>{companies.map(c => <option key={c.companyId} value={c.companyId}>{c.razao || c.razaoSocial || c.nome || c.companyId}</option>)}</select></label>
          <span>Competência: <strong>{competencia}</strong></span>
          <Button type="button" disabled={!selected || busy} onClick={consultar}>{busy ? 'Consultando…' : 'Consultar evidências locais'}</Button>
        </div>
        {!companies.length && <p>Nenhuma empresa disponível na carteira.</p>}
        {busy && <p role="status">Consultando as fontes locais…</p>}
        {error && <p role="alert">{error}</p>}
        {result && <section aria-label="Resultado da consulta DAS">
          <p><strong>{selected?.razao || selected?.razaoSocial || selected?.nome || companyId} · {result.competencia}</strong><br />Consulta: {operationInstant(result.consultadoEm)}</p>
          {(result.truncado || result.falhasParciais) && <p role="status">{result.truncado && 'Leitura truncada. '}{result.falhasParciais && 'Há fontes indisponíveis. '}O resultado não representa todas as evidências.</p>}
          <details open={result.truncado || result.falhasParciais}><summary>Fontes e limitações da leitura</summary>
            <ul>{result.fontes.map(f => <li key={f.id}><strong>{f.nome}</strong>: {f.estado}{f.quantidade !== null ? ` · ${f.quantidade} registros retornados` : ''} · limite {f.limit ?? result.limit}.</li>)}</ul>
            <ul>{result.limitacoes.map(text => <li key={text}>{text}</li>)}</ul>
          </details>
          <p>{result.achados.length} achados neste retorno local; não é um total global de pendências.</p>
          {!result.achados.length && <p>Nenhum achado retornado. Isso não comprova regularidade ou conciliação.</p>}
          <ol className="das-pendencias-findings" start={page * pageSize + 1}>{result.achados.slice(page * pageSize, (page + 1) * pageSize).map(a => <li key={a.id}>
            <h3>{a.dimensao} · {a.classificacao}</h3><p>{a.evidencia}</p>
            <dl><dt>Origem</dt><dd>{a.origem}</dd><dt>Limitação</dt><dd>{a.limitacao}</dd></dl>
          </li>)}</ol>
          {result.achados.length > pageSize && <nav aria-label="Paginação local de achados" className="das-pendencias-pagination"><Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Página anterior de achados">Anterior</Button><span>Página {page + 1} de {Math.ceil(result.achados.length / pageSize)}</span><Button type="button" variant="secondary" disabled={(page + 1) * pageSize >= result.achados.length} onClick={() => setPage(p => p + 1)} aria-label="Próxima página de achados">Próxima</Button></nav>}
        </section>}
      </div>
    </Modal>}
  </div>;
}
