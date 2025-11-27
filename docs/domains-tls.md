# Domínios e TLS (Vercel + AWS App Runner)

## Frontend (Vercel)
- Adicione o domínio no projeto Vercel (Settings → Domains).
- Configure o DNS apontando `CNAME` para o alvo indicado pela Vercel.
- Ative HTTPS (Vercel emite e renova certificados automaticamente).

## Backend (App Runner)
Opção 1 — usar domínio padrão do App Runner (HTTPS habilitado automaticamente).

Opção 2 — domínio customizado:
1. Em App Runner, abra o serviço → Custom domains → Add domain.
2. Siga as instruções de validação no DNS (CNAME para o `d-xxxx.apprunner.amazonaws.com`).
3. O ACM (gerenciado) emitirá o certificado; renovações são automáticas.

## Verificações
- Teste `https://frontend.example.com` e chamadas ao backend em `VITE_API_BASE_URL`.
- Em caso de CORS, verifique `origin` no navegador e o cabeçalho `Access-Control-Allow-Origin` (backend usa `cors` com origin=true).


