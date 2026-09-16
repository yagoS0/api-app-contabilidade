import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { RecursosComerciais } from "../components/RecursosComerciais";

export function BibliotecaComercialPage({ api, onBack }) {
  const [recursos, setRecursos] = useState([]), [erro, setErro] = useState(""), [carregando, setCarregando] = useState(true);
  const vivo = useRef(false), sequencia = useRef(0);
  const carregar = useCallback(async () => {
    const atual = ++sequencia.current; setErro(""); setCarregando(true);
    try { const r = await api.comercial("/recursos"); if (vivo.current && atual === sequencia.current) setRecursos(r.recursos || []); }
    catch(e) { if (vivo.current && atual === sequencia.current) setErro(e.message); }
    finally { if (vivo.current && atual === sequencia.current) setCarregando(false); }
  }, [api]);
  useEffect(() => { vivo.current = true; carregar(); return () => { vivo.current = false; sequencia.current++; }; }, [carregar]);
  return <PageShell title="Biblioteca compartilhada" subtitle="Mensagens rápidas, dados do escritório, honorários e contratos" onBack={onBack} actions={<Button variant="secondary" onClick={carregar} disabled={carregando}>Atualizar biblioteca</Button>} contentStyle={{ maxWidth: "var(--content-max)", width: "100%", margin: "0 auto", padding: 24 }}>
    <p>As mensagens aprovadas ficam disponíveis em <strong>Mensagens rápidas</strong> no chat. Ao voltar à aba da conversa, a lista é atualizada.</p>
    {erro && <p role="alert">{erro}</p>}{carregando && <p role="status">Carregando biblioteca…</p>}
    <RecursosComerciais api={api} recursos={recursos} onAtualizar={carregar} inicialmenteAberto />
  </PageShell>;
}
