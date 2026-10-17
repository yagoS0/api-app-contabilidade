
import { linhasDaConferenciaMunicipal } from "../PreviaFiscal.shared.js";
test('alíquota municipal é referência, sem substituir Simples', () => {
 const linhas = linhasDaConferenciaMunicipal({ estado: 'HISTORICO_LOCALIZADO', aliquotaIss: 0, vigenciaInicio: '2026-01-01' });
 expect(linhas[0]).toContain('0%'); expect(linhas[1]).toContain('não substitui a alíquota do Simples');
 expect(linhas[1]).toContain('nem comprova convênio');
});
test.each(['INFORMAR_DIA_PRESTACAO','HISTORICO_MUNICIPAL_INDISPONIVEL','ESCOPO_MUNICIPAL_INCOMPLETO'])('pendência %s é legível', motivo => {
 expect(linhasDaConferenciaMunicipal({ estado: 'PENDENTE', motivo }).join(' ')).not.toContain(motivo);
 expect(linhasDaConferenciaMunicipal({ estado: 'PENDENTE', motivo })).toHaveLength(1);
});
