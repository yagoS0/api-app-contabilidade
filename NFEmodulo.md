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

## Campos principais de retorno (unificado)
- `source`: `sistema` ou `adn`
- `sources`: origens combinadas
- `chaveAcesso`, `numeroNfse`, `idDps`
- `dataEmissao`, `competencia`
- `valorServicos`
- `cnpjPrestador`, `cnpjTomador`
- `rpsSerie`, `rpsNumero`
- `situacao`
