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

Opcional para OCR com API gratuita (fallback):

```env
OCRSPACE_ENABLED=1
OCRSPACE_API_KEY=helloworld
OCRSPACE_TIMEOUT_MS=15000
```

Opcional para usar PaddleOCR (self-hosted gratis):

```env
PADDLEOCR_ENABLED=1
PADDLEOCR_API_URL=http://127.0.0.1:8081/ocr
PADDLEOCR_TIMEOUT_MS=12000
```

Microservico PaddleOCR (pasta `paddleocr-service/`):

```bash
pip install -r paddleocr-service/requirements.txt
python paddleocr-service/app.py
```

Nota: a app tenta ler QR Code da fatura (quando presente) para melhorar data, total e NIF.

3. Arrancar servidor:

```bash
npm start
```

## Guardar o que ja funciona (anti-regressao)

Para evitar voltar a quebrar a abertura de documentos, usa o smoke test com baseline versionada (`scripts/baselines/documentos-orfaos-baseline.json`):

1. Criar ou atualizar baseline atual:

```bash
npm run smoke:docs:baseline
```

2. Validar se houve regressao apos alteracoes:

```bash
npm run smoke:docs
```

3. Validacao estrita (falha se baseline nao existir):

```bash
npm run smoke:docs:strict
```

Comportamento:

- Se surgirem novos `id` com documento em falta (comparado com baseline), o comando falha.
- Se nao houver novos partidos, o comando passa.

## Reconciliacao de documentos orfaos

Para tentar religar referencias antigas de ficheiro na BD:

```bash
npm run reconcile:docs
```

Modo simulacao (sem alterar BD):

```bash
node scripts/reconcile-docs.js --dry-run
```

Notas:

- So atualiza quando encontra um unico candidato claro no `uploads/`.
- Casos ambiguos ficam sem alteracao manual para evitar ligar documento errado.

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

O build no Render valida regressoes de documentos com `npm run smoke:docs:strict`.

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
