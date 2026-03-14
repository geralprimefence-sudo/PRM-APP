# PRM-APP

Aplicação de registo de receitas e despesas com upload de faturas, OCR e autenticação.

## Funcionalidades
- Registo de receitas e despesas
- Upload e gestão de faturas
- OCR automático (PaddleOCR ou OCRSpace)
- Autenticação de utilizadores
- Dashboard com filtros e exportação

## Requisitos
- Node.js 24+
- PostgreSQL

## Instalação e execução
1. Instalar dependências:
   ```bash
   npm install
   ```
2. Criar ficheiro `.env`:
   ```env
   DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
   SESSION_SECRET=uma-chave-forte-aqui
   PORT=3000
   ```
3. (Opcional) Configurar OCR externo:
   ```env
   OCRSPACE_ENABLED=1
   OCRSPACE_API_KEY=helloworld
   OCRSPACE_TIMEOUT_MS=15000
   ```
4. (Opcional) Usar PaddleOCR (self-hosted):
   ```env
   PADDLEOCR_ENABLED=1
   ```

## Como usar
- Aceder ao dashboard via browser
- Carregar faturas (PDF ou imagem)
- Consultar receitas/despesas
- Exportar dados (Excel/PDF)

## Deploy
- Utiliza GitHub Actions para build e deploy automático
- [Documentação Render](https://render.com/docs/deploys)

## Contacto
- Para suporte, contactar o administrador do sistema

---

<!-- Não inclui badge de workflow para manter privado -->
