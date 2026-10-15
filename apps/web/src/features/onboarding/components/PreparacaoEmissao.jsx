import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';

export function PreparacaoEmissao({ api, portalClientId }) {
  const [estado, setEstado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const pedido = useRef(0);
  const carregar = useCallback(async () => {
    const atual = ++pedido.current;
    setCarregando(true); setEstado(null);
    try {
      const dados = await api.getPerfisEmissao(portalClientId);
      if (atual === pedido.current) setEstado({ companyId: portalClientId, dados });
    } catch { if (atual === pedido.current) setEstado({ companyId: portalClientId, erro: true }); }
    finally { if (atual === pedido.current) setCarregando(false); }
  }, [api, portalClientId]);
  useEffect(() => {
    if (!portalClientId) return;
    carregar();
    window.addEventListener('focus', carregar);
    return () => { pedido.current += 1; window.removeEventListener('focus', carregar); };
  }, [carregar, portalClientId]);
  if (!portalClientId) return null;
  const dados = estado?.companyId === portalClientId ? estado.dados : null;
  const liberada = dados?.emissaoCliente?.liberada;
  const ativos = (dados?.perfis || []).filter(p => p.ativo).length;
  return <section className="onboarding-panel" aria-label="Preparação da emissão de notas">
    <h2>Emissão de notas</h2>
    {carregando ? <p role="status">Consultando configuração e liberação…</p> : !dados ? <p role="alert">Não foi possível consultar a preparação da emissão. Atualize para conferir.</p> : <ul>
      <li>{dados.perfisDisponiveis === false ? 'Perfis: consulta indisponível.' : ativos === 0 ? 'Nenhum perfil ativo.' : `${ativos} ${ativos === 1 ? 'perfil ativo' : 'perfis ativos'}.`}</li>
      <li>{liberada === true ? 'Emissão pelo cliente: liberada pelo escritório.' : liberada === false ? 'Emissão pelo cliente: aguardando liberação do escritório.' : 'Emissão pelo cliente: estado da liberação indisponível.'}</li>
      {dados.integracaoLigada === false && <li>Integração dos perfis desativada neste ambiente.</li>}
    </ul>}
    <p>A liberação de acesso não comprova que todas as configurações fiscais estejam prontas.</p>
    <div className="onboarding-actions">
      <a className="btn btn-primary btn-md" href={`/companies/${encodeURIComponent(portalClientId)}/emissao-nfse`}>Abrir configuração</a>
      <Button type="button" variant="secondary" disabled={carregando} onClick={carregar}>Atualizar preparação</Button>
    </div>
  </section>;
}
