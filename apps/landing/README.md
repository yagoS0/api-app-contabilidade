# Landing page da Altan

Página estática em `index.html`, com CSS e JavaScript embutidos, servida pelo Caddy. Não usa Node/Vite no deploy. A Inter e os ícones são locais; Fraunces e IBM Plex Mono vêm do Google Fonts. A marca usa Inter em SVG inline, por isso a fonte da marca não deve depender de um provedor externo.

## Endereços e contato definidos em 16/09/2026

- Landing: https://altan.company
- www: redireciona permanentemente para https://altan.company, preservando caminho e query.
- Portal do contador: https://app.altan.company
- Portal do cliente: https://cliente.altan.company
- Endereço anterior da landing, mantido: https://page.altan.company
- WhatsApp comercial: (21) 99941-7196, link https://wa.me/5521999417196. Não há telefone separado.
- E-mail: contato@altan.company.

A análise fiscal inicial é gratuita. A pedido do proprietário, a landing não exibe planos, tabela de preços ou CRC. Os botões comerciais abrem o WhatsApp; o acesso ao cliente permanece no canto superior direito também no celular. Valores na ilustração do painel representam dados demonstrativos, não preços de serviços.

## Publicação

Serviço Railway `landing`, projeto `perfect-upliftment`, ambiente `production`. Root Directory **apps/landing**; Dockerfile relativo a essa pasta. A implantação é manual. Execute da raiz do repositório:

```powershell
railway up --project e54d42b0-309c-4f3e-8e21-f306bac5930d --environment production --service landing --detach
```

Não copie a configuração dos portais: eles precisam do contexto completo do monorepo, enquanto a landing é estática. Usar a raiz como Root Directory faz o Railway ler o railway.toml da API, construir o serviço errado e falhar no healthcheck. A landing não possui rota `/healthz`.

A API deve autorizar `https://app.altan.company` em `CORS_ALLOWED_ORIGINS`. A migração do site não altera os registros de e-mail nem o subdomínio `cliente`.

## Verificação

Sirva a pasta `apps/landing` por HTTP para conferir desktop e celular. Verifique o botão Portal do cliente, os links do WhatsApp, as âncoras internas e o FAQ. O JavaScript apenas anima a entrada dos blocos; o fallback `noscript` mantém o conteúdo visível.

O Caddy devolve 404 para arquivos inexistentes; não usar fallback de SPA. HTML tem `Cache-Control: no-cache`; assets com nomes fixos usam cache de uma hora com revalidação, sem `immutable`. O `www` redireciona para a URL canônica. Confirme HTTPS e o redirecionamento após alterações de DNS.
