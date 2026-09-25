import { useEffect, useState } from "react";

export function useTelaPequena() {
  const [pequena, setPequena] = useState(() => Boolean(window.matchMedia?.("(max-width: 760px)").matches));
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const atualizar = () => setPequena(media.matches);
    atualizar(); media.addEventListener?.("change", atualizar);
    return () => media.removeEventListener?.("change", atualizar);
  }, []);
  return pequena;
}
