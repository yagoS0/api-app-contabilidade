import { useEffect, useRef, useState } from 'react';

export function usePreviaFiscal(api, companyId, entrada) {
  const chave = JSON.stringify([companyId, entrada]);
  const atual = useRef(chave);
  const montado = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  atual.current = chave;
  const [estado, setEstado] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const habilitada = Boolean(api);
  useEffect(() => {
    if (!habilitada) return undefined;
    let ativo = true;
    const timer = setTimeout(async () => {
      try {
        const [id, pedido] = JSON.parse(chave);
        const dados = await api.previaEmissaoNfse(id, pedido);
        if (typeof dados?.ok !== 'boolean' || !Array.isArray(dados.pendencias)) throw new Error('Resposta de prévia inválida.');
        if (ativo) setEstado({ chave, dados });
      } catch { if (ativo) setEstado({ chave, erro: 'Prévia fiscal indisponível. Tente novamente antes de emitir.' }); }
    }, 250);
    return () => { ativo = false; clearTimeout(timer); };
  }, [api, habilitada, chave, tentativa]);
  const vigente = estado?.chave === chave ? estado : null;
  async function reconferir() {
    if (!habilitada) return true;
    try {
      const [id, pedido] = JSON.parse(chave);
      const dados = await api.previaEmissaoNfse(id, pedido);
      if (!montado.current || atual.current !== chave) return false;
      if (typeof dados?.ok !== 'boolean' || !Array.isArray(dados.pendencias)) throw new Error();
      const igual = JSON.stringify(dados) === JSON.stringify(vigente?.dados);
      setEstado({ chave, dados });
      return dados.ok && igual;
    } catch {
      if (montado.current && atual.current === chave) setEstado({ chave, erro: 'Prévia fiscal indisponível. Tente novamente antes de emitir.' });
      return false;
    }
  }
  return { habilitada, dados: vigente?.dados, erro: vigente?.erro,
    carregando: habilitada && !vigente, bloqueada: habilitada && vigente?.dados?.ok !== true,
    tentar: () => { setEstado(null); setTentativa(n => n + 1); }, reconferir };
}
