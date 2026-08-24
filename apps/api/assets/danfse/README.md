# Logomarca oficial da NFS-e — para o DANFSe

⚠⚠ **ESTE ARQUIVO MORA AQUI, E NÃO EM `docs/leiaute-nfse/`, POR CAUSA DO DOCKER.** O
`.dockerignore` ignora `docs/` inteiro; a logo ficaria fora da imagem e o DANFSe de PRODUÇÃO cairia
no placeholder com aviso — em silêncio, e só lá. O critério geral: `docs/leiaute-nfse/` guarda o que
é lido por **teste e script** (o PDF da NT, os XSD, a amostra de XML); o que é lido em **runtime**
mora com o runtime.

| | |
|---|---|
| arquivo | `logo-nfse-horizontal.png` |
| SHA-256 | `ab57fa34887929a10ee3b9b4d666084ec9b9465e62bbcc3523b99b23ccac1063` |
| dimensões | 1920 × 389 px, RGBA, 8 bits/canal, não entrelaçado · 99.427 bytes |
| baixado em | 24/08/2026 |
| origem | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/Logo - NFS-e - Horizontal.png` |

## Por que este arquivo existe

A **NT 008 §2.4.3** manda, com esta letra:

> *"o cabeçalho deverá conter: no canto esquerdo, a **logomarca da NFS-e**, disponível em:
> https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/Logo%20-%20NFS-e%20-%20Horizontal.png/view"*

Até 24/08/2026 o arquivo não estava no repositório, e o gerador imprimia o texto
`[LOGOMARCA NFS-e]` num quadro, com um aviso em `conformidade.avisos`. Isso era o certo enquanto
faltava o arquivo — o comentário de `gerarDanfse.js` diz por quê:

> *"NÃO DESENHAMOS UM LOGO IMITANDO O OFICIAL. (…) um desenho 'parecido' seria marca fabricada num
> documento fiscal."*

**O que faltava era o download, não a decisão.**

## ⚠⚠ É A LOGO DA NFS-e, NUNCA A DO PRESTADOR

A NT nomeia **um** arquivo, e é este. A palavra "logo" aparece 5 vezes no PDF da NT, todas no mesmo
contexto, e **não há nenhuma menção a logomarca do prestador**. Some-se a regra-mãe do §2.1
(*"não poderão ser impressas informações que não constem do arquivo da NFS-e"*): a logo do
prestador não consta do XML.

⚠ Um mockup de layout novo pediu "logo do prestador, 30 × 18 mm" no cabeçalho. **Isso é proibido**,
e não por escolha nossa. Se um dia a NT mudar, este README é o lugar de registrar a mudança — não
o código.

## Onde ele é consumido

`apps/api/src/application/nfse/danfse/gerarDanfse.js` o carrega **por padrão**, sem que o chamador
precise passar nada (`logoPng` continua aceito e vence, para teste). A célula do §2.4.5 é
**0,85 × 4,00 cm**, em `esq 0,49 / sup 0,44`, e o desenho usa `fit` — a proporção não é distorcida.

⚠ O PNG tem **canal alfa**, e isso é diferente do QR Code (que é `DeviceGray` sem `SMask`, de
propósito, medido: 153 ms → 7 ms). Aqui o alfa é legítimo — a logo tem fundo transparente e o
cabeçalho é sombreado em cinza 5%. O custo é pago uma vez por PDF.

## Como reconferir

```bash
curl -sL -o /tmp/logo.png "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/Logo%20-%20NFS-e%20-%20Horizontal.png"
sha256sum /tmp/logo.png
```

⚠ A URL da NT termina em `/view` (é uma página do Plone). O arquivo cru é a mesma URL **sem** o
`/view` — foi assim que este download foi feito.

## ⚠ O custo, medido — e por que ele não foi "otimizado"

| | sem a logo | com a logo oficial |
|---|---|---|
| PDF | 7,4 KB | **84,0 KB** |
| geração | ~90 ms | **327 ms** |

**O custo é o CANAL ALFA, não a resolução.** Foi medido: reamostrar o PNG de 1920×389 para 945×191
(600 dpi na célula de 4,00 cm, que é o que uma laser usa) leva o arquivo de 99 KB para 65 KB — 34%,
não a ordem de grandeza. Com alfa, o pdfkit decodifica a imagem em JS (`splitAlphaChannel`) em vez
de repassar o IDAT — exatamente o que a seção do QR Code documenta (153 ms → 7 ms ao remover o alfa).

**Duas saídas foram consideradas e as duas foram recusadas:**

- **Achatar o alfa sobre branco** — a célula da logo é sombreada em **cinza 5%** (§2.2.3). Um fundo
  branco apareceria como um retângulo claro dentro do cabeçalho cinza.
- **Achatar sobre o cinza `#F2F2F2`** — casaria hoje, e criaria um acoplamento **invisível**: mudado
  o sombreado, a logo passaria a carregar o cinza antigo dentro dela, e nada apontaria para cá.

⚠ Então o arquivo fica **como o gov.br o publica**, byte a byte — o que também é o que torna o
SHA-256 acima uma prova de procedência. 327 ms para um documento que uma pessoa pede e baixa é
aceitável. **Se um dia o lote de DANFSe (`loteDanfseDoPortal.js`) ficar lento, é aqui que se olha**
— e a saída certa lá seria embutir a imagem uma vez por ZIP, não degradar a arte.
