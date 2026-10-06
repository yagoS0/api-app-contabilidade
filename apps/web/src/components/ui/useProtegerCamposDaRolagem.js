import { useEffect } from 'react';

const TIPOS = new Set(['number','date','datetime-local','time','month','week']);
let usuarios = 0;
function proteger(event) {
  const campo = event.target?.closest?.('input');
  // Retira o foco antes da ação nativa de incremento. O scroll continua livre.
  if (campo && TIPOS.has(campo.type) && campo === document.activeElement) campo.blur();
}

export function useProtegerCamposDaRolagem() {
  useEffect(() => {
    if (usuarios++ === 0) document.addEventListener('wheel', proteger, {capture:true,passive:true});
    return () => {
      if (--usuarios === 0) document.removeEventListener('wheel', proteger, true);
    };
  }, []);
}
