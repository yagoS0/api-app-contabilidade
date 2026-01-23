## Guia de preenchimento da DPS/NFS-e (Padrão Nacional)

Este guia resume o que preencher para emitir a NFS-e pelo padrão nacional, com base na emissão bem-sucedida que retornou `status: "issued"` (homolog).

### 1) Ambiente e envio
- Ambiente: Homolog (`tpAmb=2`) ou Produção (`tpAmb=1`). O código ajusta `tpAmb` a partir de `NFSE_ENV` (`homolog` => 2, caso contrário 1).
- Endpoint homolog: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse`.
- Endpoint produção (ajuste conforme provedor): normalmente `https://sefin.nfse.gov.br/SefinNacional/nfse` ou URL oficial informada pelo município/portal nacional. Se `NFSE_ENV=producao` e `NFSE_BASE_URL` apontar para `producaorestrita`/`homolog`, o código lançará erro de mismatch.
- Envio: JSON com `dpsXmlGZipB64` (XML assinado, GZip, Base64).
- Certificado ICP-Brasil (A1/A3) com mutual TLS em todas as chamadas (emissão e consulta).

### 2) Identificação da DPS
- `Id (infDPS)`: `DPS{cLocEmi(7)}{tpInsc(1)}{inscFed(14)}{serie(5)}{nDPS(15)}`. Ex.: `DPS330455723925424300019100001000000000000001`.
- `tpAmb`: `2` (homolog).
- `dhEmi`: data/hora ISO 8601 com fuso. Ex.: `2026-01-23T19:49:52-03:00`.
- `verAplic`: `SefinNacional_1.5.0` (fixado no código).
- `serie`: numérica com 5 dígitos, ex.: `00001`.
- `nDPS`: número sequencial, pode ir sem padding no XML, ex.: `1` (mas entra com padding no Id).
- `dCompet`: data da competência, ex.: `2026-01-23`.
- `tpEmit`: `1` (prestador).
- `cLocEmi`: IBGE do município emissor, ex.: `3304557` (Rio de Janeiro).

### 3) Prestador (empresa)
- `CNPJ`: do prestador, ex.: `39254243000191`.
- `IM`: para Rio (`cLocEmi=3304557`), omitir IM (regra implementada).
- `regTrib`:
  - `opSimpNac`: `3` (Simples Nacional ME/EPP, fixo).
  - `regApTribSN`: `1` (fixo).
  - `regEspTrib`: use `0` se não houver regime especial.

### 4) Tomador
- Documento: `<CPF>` ou `<CNPJ>`. Ex.: `<CPF>12219079724</CPF>`.
- `xNome`: nome/razão social do tomador. Ex.: `yago silva`.
- `email`: opcional, recomendável.
- Endereço do tomador: informe sempre que possível; é obrigatório se houver retenção de ISS (`tpRetISSQN=1`) e alguns provedores podem exigir mesmo sem retenção. Campos: `cMun` (IBGE, 7 dígitos), `CEP` (numérico), `xLgr`, `nro`, `xBairro`, opcional `xCpl`.

### 5) Serviço
- `cLocPrestacao`: IBGE do local da prestação. Ex.: `3304557`.
- `cTribNac`: código nacional (6 dígitos numéricos). Ex.: `171201`.
- `cTribMun`: código municipal (últimos 3 dígitos). Ex.: `001`.
- `xDescServ`: descrição. Ex.: `serviços contabeis`.

### 6) Valores
- `vServ`: valor do serviço. Ex.: `100.00`.
- Descontos: enviar `<vDescCondIncond>` apenas se houver valores > 0.
- Deduções/Reduções: enviar `<vDedRed>` apenas se houver `pDR`/`vDR`.

### 7) Tributos
- `tribMun` (ISSQN):
  - `tribISSQN`: `1` (há ISS).
  - `tpRetISSQN`: `1` (não retido).
  - `pAliq`: enviado se informado; `vISSQN` enviado se informado.
- `tribFed` (PIS/COFINS):
  - Para Simples, se nada for enviado no payload, o bloco é omitido.
  - Se enviar, `CST`, base e alíquotas devem ser coerentes.
  - Retenção (`tpRetPisCofins=1`): base > 0 e < `vServ`; enviar `vBcRetPisCofins` e `vRetPisCofins`.
  - Sem retenção (`tpRetPisCofins=2` ou omitido): base é ajustada para ser > 0 e < `vServ` para evitar E0680.
- `totTrib`:
  - Estrutura exigida: `<totTrib><vTotTrib><vTotTribFed>0.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>0.00</vTotTribMun></vTotTrib></totTrib>`.

### 8) Assinatura e compactação
- Assinatura XMLDSIG no nó `infDPS` (RSA-SHA256, enveloped, exc-c14n), inclui `X509Certificate`.
- Depois de assinar, GZip + Base64 para enviar em `dpsXmlGZipB64`.

### 9) Passo a passo de emissão
1. Montar o payload de negócio (dados da empresa e da nota).
2. Gerar o XML DPS conforme acima.
3. Assinar o `infDPS`.
4. GZip + Base64 → `dpsXmlGZipB64`.
5. POST `/nfse` no endpoint do ambiente com mutual TLS.
6. Resposta 201 traz `idDps` e chave de acesso (se disponível) ou permite consultar pelo Id.

### 10) Consultas pós-emissão
- HEAD `/dps/{idDps}`: verifica se há NFS-e para o Id (usar mesmo ambiente e certificado).
- GET `/dps/{idDps}`: retorna chave de acesso.
- GET `/nfse/{chaveAcesso}`: retorna XML GZip Base64 da NFS-e.

### 11) Campos mínimos para evitar erros comuns
- Prestador: `CNPJ`, `cLocEmi`, `opSimpNac=3`, `regApTribSN=1`, `regEspTrib` definido, IM omitido para RJ.
- Tomador: CPF/CNPJ, nome, email.
- Serviço: `cLocPrestacao`, `cTribNac`, `cTribMun`, `xDescServ`.
- Valores: `vServ`.
- Tributos: `tribMun` obrigatório; `tribFed` omitido se Simples e sem dados; `totTrib` com subcampos federais/estaduais/municipais zerados.

### 12) Exemplo bem-sucedido (homolog, resumido)
- `tpAmb`: 2
- `cLocEmi`: 3304557
- Prestador: CNPJ `39254243000191`, IM omitido (RJ), `opSimpNac=3`, `regApTribSN=1`, `regEspTrib=0`
- Tomador: CPF `12219079724`, nome `yago silva`, email `yagoas120@gmail.com`
- Serviço: `cTribNac=171201`, `cTribMun=001`, `xDescServ=serviços contabeis`, `cLocPrestacao=3304557`
- `vServ=100.00`
- `tribMun`: `tribISSQN=1`, `tpRetISSQN=1`
- `tribFed`: omitido (Simples, sem dados extras)
- `totTrib` presente com `vTotTribFed/Est/Mun = 0.00`
- Resultado: `status: issued`, `numeroNfse=33045572239254243000191000000000000126019987379520`
