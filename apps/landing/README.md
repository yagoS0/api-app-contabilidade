# apps/landing — a landing page da Altan

Página **única, estática, escrita à mão** (`index.html`, sem build). Servida pelo Caddy, no mesmo
molde de deploy dos outros dois fronts.

```
apps/landing/
  index.html              a página inteira (HTML + CSS + JS embutidos)
  assets/
    altan-icone-32.png    cópia de apps/web/public/favicon-32.png       (32×32)
    altan-icone-180.png   cópia de apps/web/public/apple-touch-icon.png (180×180)
    fonts/Inter-latin.woff2 + OFL.txt   cópia de apps/web/public/fonts/
  Caddyfile · Dockerfile · railway.toml
```

---

## ⚠⚠ CINCO CAMPOS ESTÃO COM `XXX` — E ELES SÃO DECISÃO DO DONO, NÃO LACUNA TÉCNICA

Nenhum deles pode ser preenchido por dedução. **Número de CRC, telefone, WhatsApp e preço são
afirmações públicas**: inventar qualquer um deles põe no ar um dado falso assinado pela Altan —
e o do CRC é registro profissional.

| linha | o que está lá | o que é |
|---|---|---|
| `index.html:365` | `R$ XXX` | preço da **análise fiscal inicial** (bloco "extras") |
| `index.html:409` | `wa.me/55XXXXXXXXXXX` | o número do WhatsApp, com DDI 55 e **só dígitos** |
| `index.html:410` | `R$ XXX` | ⚠ o **mesmo** preço da linha 365 — os dois têm de mudar juntos |
| `index.html:418` | `CRC-XX 000000/O` | UF e número do registro no CRC |
| `index.html:419` | `(XX) XXXXX-XXXX` | o telefone |

⚠ **O preço aparece DUAS vezes** (a tabela de extras e a linha embaixo do botão de WhatsApp).
Trocar um e esquecer o outro põe dois valores diferentes para o mesmo serviço na mesma página.

### ⚠ E há um sexto campo que NÃO está marcado como pendência, mas é suspeito

`index.html:419` traz **`contato@altan.com.br`** — e o domínio do projeto é **`altan.company`**.
**Não foi alterado**: um e-mail é endereço de verdade, e trocar o TLD por conta própria poderia pôr
no ar um endereço que ninguém lê. Confira qual dos dois é o correto antes de publicar.

### O que a página NÃO tem, e é decisão sua se entra

- **Open Graph / Twitter Card.** Sem `og:title`/`og:image`, o link compartilhado no WhatsApp ou no
  LinkedIn aparece sem prévia. Não foi acrescentado porque exige **URL absoluta** — ou seja, o
  domínio final, que ainda não está decidido.
- **Formulário de contato.** Toda conversão passa pelo WhatsApp; não há backend nem captura de lead.
- **Analytics.** Nenhum script de terceiro foi incluído.

---

## As DUAS alterações feitas sobre o HTML entregue (nenhuma muda o desenho)

### 1 · A Inter passou a ser servida por nós

O HTML original carregava **Inter, Fraunces e IBM Plex Mono** do Google Fonts. A Inter saiu de lá e
passou a vir de `assets/fonts/` — é a **mesma fonte**, mesmo arquivo variável (48 KB, eixo `wght`
100–900) que os dois portais já usam desde 23/08/2026.

⚠ **O motivo é o letreiro da logo, e é literalmente o mesmo motivo já registrado no `CLAUDE.md` da
raiz:** a logo é um **SVG inline** cujo "ALTAN" é um `<text font-family="Inter,'Segoe UI',Arial">`.
Com a Inter vindo de terceiro, qualquer bloqueio a `fonts.googleapis.com` (rede corporativa,
bloqueador, queda) faz **a marca sair em Segoe UI** — e a marca é a única coisa da página que não
pode degradar. Fraunces e IBM Plex Mono continuam no Google Fonts: são texto, não identidade.

⚠ Junto entrou o `preconnect` para **`fonts.gstatic.com`**, que faltava — o CSS vem do
`googleapis.com`, mas os arquivos `.woff2` vêm do `gstatic.com`.

**Para reverter:** troque o bloco de `<link>` no `<head>` pelo original e apague o `@font-face`.

### 2 · Sem JavaScript a página abria EM BRANCO

Todo bloco de conteúdo tem `class="reveal"`, que nasce **`opacity:0`** e só aparece quando o
`IntersectionObserver` do rodapé o alcança. JS bloqueado ou quebrado ⇒ **página em branco**, não
"página sem animação". Entrou um `<noscript>` de três linhas que força `opacity:1`.

⚠ Isso **não** desliga a animação de ninguém que tenha JS. E não era hipotético: a regra CSS já
tinha o cuidado inverso (`@media(prefers-reduced-motion:no-preference)`), então quem pediu menos
movimento já estava protegido — quem não tinha JS, não.

---

## Rodar localmente

Qualquer servidor estático serve a pasta. ⚠ Abrir o `index.html` com **duplo clique** (`file://`)
também funciona, mas o `preload` da fonte e os caminhos relativos se comportam diferente do que o
Caddy fará — para conferir de verdade, sirva por HTTP.

## Deploy

**Nenhum serviço foi criado no Railway.** Os três arquivos de deploy estão prontos e seguem o molde
do `apps/portal-cliente-web`; criar o serviço, apontar o domínio e ligar o build é ato do dono.

⚠ Ao criar o serviço: **`Root Directory` = raiz do repositório**, não `apps/landing`. É a mesma
configuração dos outros dois — o `dockerfilePath` do `railway.toml` é relativo à raiz.
