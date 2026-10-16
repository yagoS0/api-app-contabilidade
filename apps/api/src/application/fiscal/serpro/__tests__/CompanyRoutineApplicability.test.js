import { aplicarRegimeRotinas } from '../CompanyRoutineApplicability.js';

test.each([
  ['SIMPLES', ['das', 'extrato', 'parcelamento', 'inss', 'pagamento', 'conferencia']],
  ['LUCRO_PRESUMIDO', ['presumido', 'inss', 'pagamento', 'conferencia']],
  ['LUCRO_REAL', ['inss', 'pagamento', 'conferencia']],
])('regime %s limita rotinas conforme os executores existentes', (regime, expected) => {
  expect(aplicarRegimeRotinas({ regimeTributario: regime })).toEqual({ regime, applicableKeys: expected, unavailableReason: null });
});

test('usa campo canônico antes do legado, sem adivinhar aliases ou corrigir conflito', () => {
  expect(aplicarRegimeRotinas({ regimeTributario: ' lucro_presumido ', tipoTributario: 'SIMPLES' }).regime).toBe('LUCRO_PRESUMIDO');
  expect(aplicarRegimeRotinas({ tipoTributario: 'SIMPLES' }).regime).toBe('SIMPLES');
  expect(aplicarRegimeRotinas({ regimeTributario: 'SN', tipoTributario: 'SIMPLES' })).toMatchObject({ regime: null, applicableKeys: [], unavailableReason: expect.any(String) });
  expect(aplicarRegimeRotinas(null)).toMatchObject({ regime: null, applicableKeys: [], unavailableReason: expect.any(String) });
});
