const normalizar = (valor) => String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function filtrarEmpresas(empresas, busca) {
  const termo = normalizar(busca.trim());
  const digitos = busca.replace(/\D/g, "");
  return empresas.filter((empresa) => !termo
    || normalizar(empresa.razao).includes(termo)
    || (/^[\d\s./-]+$/.test(busca) && digitos.length > 0 && String(empresa.cnpj || "").replace(/\D/g, "").includes(digitos)));
}
