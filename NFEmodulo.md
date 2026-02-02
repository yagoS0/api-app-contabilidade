# Modulo NFS-e (NFSe)

## Visao geral
Este modulo centraliza a emissao, consulta e sincronizacao de NFS-e usando:
- **Sistema**: registros internos de NFS-e (tabela `ServiceInvoice`).
- **ADN (Ambiente Nacional)**: documentos oficiais obtidos via API com certificado.

O endpoint unificado agrega **sistema + ADN**, remove notas **canceladas** e **rejeitadas**
e retorna uma lista consolidada por `chaveAcesso/numeroNfse/idDps/rps`.

## Rotas

### 1) Emitir NFS-e
`POST /nfse/issue`

**Body obrigatorio**
```
{
  companyId: "uuid",
  tomador: {
    doc: "CPF/CNPJ",
    nome: "Nome",
    email: "email@dominio.com",
    endereco: {
      cMun: "codigoMunicipio",
      CEP: "cep",
      xLgr: "logradouro",
      nro: "numero",
      xBairro: "bairro",
      xCpl: "complemento"
    }
  },
  servico: {
    descricao: "descricao do servico",
    valorServicos: 123.45,
    aliquota: 0.02,
    issRetido: false
  },
  competencia: "YYYY-MM-DD",
  totTrib: { pTotTribSN: 10 },
  referencia: "texto livre"
}
```

**Retornos**
- `201` quando emitida (`status: "issued"`)
- `202` quando pendente (`status: "pending"`)
- `422` quando rejeitada (`error: "nfse_rejected"`, `message` com detalhe do provedor)

---

### 1.1) Cancelamento / Substituicao (evento)
`POST /nfse/{chaveAcesso}/eventos`

**Body obrigatorio**
- `tipoEvento` (`e101101` cancelamento, `e105102` cancelamento por substituicao)
- `justificativa`

**Body opcional**
- `cnpjAutor` (se a nota nao existir no sistema)
- `cMotivo` (codigo do motivo)
- `chaveSubstituta` (quando for substituicao)
- `numeroSubstituta` (quando for substituicao)

**Observacoes**
- NFS-e precisa estar autorizada.
- Endpoint oficial do padrão nacional: `/nfse/{chaveAcesso}/eventos`.

---

### 2) Listar NFS-e do sistema
`GET /nfse`

**Query obrigatoria**
- `companyId`

**Query opcional**
- `status`, `numeroNfse`, `chaveAcesso`, `idDps`
- `cnpjPrestador`, `cnpjTomador`, `situacao`
- `from`, `to`, `dateField` (`competencia` ou `createdAt`)
- `sync` (`true/false`) para sincronizar com provedor antes de listar
- `limit`, `offset`

**Observacoes**
- Por padrao, nao retorna notas **canceladas** ou **rejeitadas**.

---

### 3) Consultar NFS-e (POST)
`POST /nfse/consulta`

**Body obrigatorio**
- `companyId`

**Body opcional**
- Mesmos campos do `GET /nfse`
- `sync`: por padrao ativa quando `from` e `to` sao enviados

---

### 4) Sincronizar ADN
`POST /api/nfse/sync`

**Body opcional**
```
{
  loop: true,
  cnpjConsulta: "CNPJ",
  lote: true,
  maxIterations: 50
}
```

**Observacoes**
- `loop=true` sincroniza em lote ate nao haver mais documentos.

---

### 5) Atualizar NSU do ADN
`POST /api/nfse/nsu`

**Body obrigatorio**
```
{ "nsu": 123 }
```

---

### 6) Listar documentos ADN
`GET /api/nfse`

**Query obrigatoria**
- `cnpj`
- `tipo` (`emitidas` ou `recebidas`)

**Query opcional**
- `inicio`, `fim`, `limit`, `offset`

**Observacoes**
- Por padrao, nao retorna **canceladas** ou **rejeitadas**.

---

### 7) Unificado (sistema + ADN)
`GET /api/nfse/unified`

**Query obrigatoria**
- `cnpj`

**Query opcional**
- `tipo` (`emitidas`, `recebidas`, `todas`)
- `inicio`, `fim`, `limit`, `offset`

**Observacoes**
- Remove **canceladas** e **rejeitadas**.
- Se existir evento de cancelamento no ADN, a nota correspondente nao aparece no resultado.
- Retorna `empresaNome` quando identificado pelo CNPJ consultado.

---

### 8) Resumo unificado
`GET /api/nfse/unified/summary`

**Query obrigatoria**
- `cnpj`

**Query opcional**
- `tipo` (`emitidas`, `recebidas`, `todas`)
- `inicio`, `fim`
- `tomadorDoc` (filtra por documento do tomador)

**Retorno**
- `totalNotas`
- `totalValorServicos`
- `porTomador` (lista agregada por tomador)

---

### 9) Download PDF (gera a partir do XML)
`GET /api/nfse/pdf`

**Query obrigatoria (um deles)**
- `chave` **ou** `numeroNfse` **ou** `idDps`

**Observacoes**
- Gera PDF a partir do XML armazenado no sistema/ADN.

## Campos principais de retorno (unificado)
- `source`: `sistema` ou `adn`
- `sources`: origens combinadas
- `chaveAcesso`, `numeroNfse`, `idDps`
- `dataEmissao`, `competencia`
- `valorServicos`
- `cnpjPrestador`, `cnpjTomador`
- `rpsSerie`, `rpsNumero`
- `situacao`
