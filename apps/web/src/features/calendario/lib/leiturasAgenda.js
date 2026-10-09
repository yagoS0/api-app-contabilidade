// Cache curto e exclusivo da instância autenticada; nunca persiste dados no navegador.
export function criarLeiturasAgenda({ ttl = 30000, agora = Date.now } = {}) {
  const entradas = new Map();
  return {
    limpar() { entradas.clear(); },
    ler(chave, carregar) {
      const existente = entradas.get(chave);
      if (existente && agora() - existente.inicio < ttl) return existente.promise;
      const entrada = { inicio: agora() };
      entrada.promise = Promise.resolve().then(carregar).then(out => {
        if (out?.ok === false) throw new Error(out.message || 'Não foi possível carregar a agenda.');
        return out;
      }).catch(erro => {
        if (entradas.get(chave) === entrada) entradas.delete(chave);
        throw erro;
      });
      entradas.set(chave, entrada);
      if (entradas.size > 20) entradas.delete(entradas.keys().next().value);
      return entrada.promise;
    },
  };
}
