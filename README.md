# PRM-APP

Aplicacao de registo de receitas e despesas com upload de faturas, OCR e autenticacao.

## Requisitos

- Node.js 18+
- PostgreSQL

## Executar localmente

1. Instalar dependencias:

```bash
npm install
```

2. Criar ficheiro `.env`:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
SESSION_SECRET=uma-chave-forte-aqui
PORT=3000
```

3. Arrancar servidor:

```bash
npm start
```

4. Abrir:

```text
http://localhost:3000/login.html
```

## Deploy no Render

Este projeto inclui `render.yaml` para facilitar a criacao do servico.

1. Fazer push do projeto para GitHub.
2. No Render, criar `New +` -> `Blueprint` e selecionar o repositorio.
3. Definir variavel `DATABASE_URL` no Render (PostgreSQL externo ou Render Postgres).
4. Confirmar deploy.

Variaveis usadas em producao:

- `NODE_ENV=production`
- `SESSION_SECRET` (gerado automaticamente no `render.yaml`)
- `DATABASE_URL` (definir manualmente no Render)

## Dominio customizado (appcontabill.com)

1. No Render, abrir o servico e adicionar `www.appcontabill.com` em `Settings` -> `Custom Domains`.
2. No gestor DNS do dominio, criar registo `CNAME`:
	- `Host`: `www`
	- `Value/Target`: hostname indicado pelo Render (ex.: `xxxx.onrender.com`)
3. Opcional (recomendado): adicionar tambem `appcontabill.com` no Render e configurar redirect para `www.appcontabill.com`.
4. Aguardar propagacao DNS.
5. Depois da verificacao, abrir:

```text
https://www.appcontabill.com/login.html
```

## Nota importante sobre uploads

Atualmente os ficheiros em `uploads/` sao locais ao servidor. Em plataformas cloud, estes ficheiros podem perder-se em redeploy/restart.

Para ambiente definitivo, recomenda-se guardar uploads em storage externo (ex.: Cloudinary, S3, Supabase Storage).
