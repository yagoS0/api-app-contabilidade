import { useEffect, useState } from "react";
import { CampoComBusca } from "../../../notas/components/CampoComBusca";
import { buscarMunicipios, carregarMunicipiosIbge, municipioPorCodigo, rotuloMunicipio } from "../../../../lib/municipios/municipioIbge";

export function MunicipioDoPerfil({ codigo, busca, onBuscar, onEscolher }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let ativo = true;
    carregarMunicipiosIbge().then(d => { if (ativo) setLista(d); }).catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, []);
  const municipio = municipioPorCodigo(lista, codigo);
  return <CampoComBusca
    id="perfil-cLocPrestacao"
    rotulo="Município da prestação"
    valor={busca ?? (municipio ? rotuloMunicipio(municipio) : codigo || "")}
    onChangeTexto={onBuscar}
    buscar={termo => buscarMunicipios(lista, termo, { limite: 8 })}
    chaveDoItem={m => m[0]}
    rotuloDoItem={rotuloMunicipio}
    detalheDoItem={m => `IBGE ${m[0]}`}
    onEscolher={m => onEscolher(m[0])}
    placeholder="Buscar município e UF"
    textoVazio={erro ? "Não foi possível carregar os municípios. Recarregue a página." : !lista ? "Carregando municípios…" : "Nenhum município encontrado. Confira o nome e a UF."}
    ajuda={codigo ? municipio ? `IBGE ${codigo}` : lista ? `Código salvo ${codigo} não encontrado na lista. Confira o município.` : "Carregando município salvo…" : "Selecione a cidade; o código IBGE será preenchido automaticamente."}
  />;
}
