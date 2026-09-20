import { coletaComercialHabilitada } from "../onboarding/politicaColetaComercial.js";

// O canal comercial pode acolher qualquer pessoa sem conceder acesso fiscal.
// Esvaziar o piloto impede que essa regra altere o atendimento do canal principal.
export function entradaComercialPublica(registro) {
  return coletaComercialHabilitada(registro?.conversa?.telefoneE164, {
    piloto: [], canal: registro?.canal, canalId: registro?.conversa?.canalId,
  });
}
