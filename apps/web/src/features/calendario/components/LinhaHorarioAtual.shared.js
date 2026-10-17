import { useEffect, useState } from 'react';

export const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function lerHorarioAtual() {
  const partes = Object.fromEntries(formato.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}`,
    minutos: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

export function useRelogioAgenda() {
  const [agora, setAgora] = useState(lerHorarioAtual);
  useEffect(() => {
    let timer;
    const atualizar = () => {
      clearTimeout(timer);
      setAgora(lerHorarioAtual());
      timer = setTimeout(atualizar, 60000 - Date.now() % 60000);
    };
    atualizar();
    window.addEventListener('focus', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, []);
  return agora;
}
