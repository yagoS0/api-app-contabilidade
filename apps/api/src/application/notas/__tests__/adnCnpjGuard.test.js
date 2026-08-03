// A nota capturada é MESMO da empresa?
//
// O ADN Contribuinte identifica o contribuinte pelo CERTIFICADO — o path é `/DFe/{NSU}` e não
// carrega CNPJ nenhum. Consultar com o cert do escritório devolvia as notas DO ESCRITÓRIO, que
// eram gravadas debaixo da empresa cliente. Esta é a regra que recusa o documento alheio,
// independente de como o certificado foi resolvido.
//
// Réplica da guarda de `AdnNotasService.upsertNfseFromItem` — se as duas divergirem, este teste
// deixa de proteger, então mantenha-as juntas.
const so = (v) => String(v || "").replace(/\D+/g, "");

function ehDeOutraEmpresa({ companyCnpj, cnpjPrestador, cnpjTomador }) {
  const empresa = so(companyCnpj);
  const p = so(cnpjPrestador);
  const t = so(cnpjTomador);
  if (!empresa) return false;
  if (!p && !t) return false;
  return p !== empresa && t !== empresa;
}

const EMPRESA = "66233216000105";
const ESCRITORIO = "11222333000144";
const TERCEIRO = "99888777000166";

describe("guarda de CNPJ na captura de NFS-e", () => {
  test("nota EMITIDA pela empresa passa", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: EMPRESA, cnpjTomador: TERCEIRO })).toBe(false);
  });

  test("nota RECEBIDA pela empresa passa", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: TERCEIRO, cnpjTomador: EMPRESA })).toBe(false);
  });

  test("nota do ESCRITÓRIO para um terceiro é recusada — é o bug relatado", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: ESCRITORIO, cnpjTomador: TERCEIRO })).toBe(true);
  });

  test("nota entre dois terceiros é recusada", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: TERCEIRO, cnpjTomador: ESCRITORIO })).toBe(true);
  });

  test("máscara no CNPJ não muda a decisão", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: "66.233.216/0001-05", cnpjPrestador: EMPRESA, cnpjTomador: "" })).toBe(false);
  });

  test("sem NENHUM CNPJ no metadado, NÃO recusa", () => {
    // Ausência de dado não é evidência de nota alheia. Descartar aqui esconderia nota legítima
    // que o parser não conseguiu ler — o erro oposto, e igualmente caro.
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: "", cnpjTomador: "" })).toBe(false);
  });

  test("empresa sem CNPJ cadastrado não recusa nada (não há com o que comparar)", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: "", cnpjPrestador: TERCEIRO, cnpjTomador: ESCRITORIO })).toBe(false);
  });

  test("um dos lados presente e batendo basta", () => {
    expect(ehDeOutraEmpresa({ companyCnpj: EMPRESA, cnpjPrestador: "", cnpjTomador: EMPRESA })).toBe(false);
  });
});
