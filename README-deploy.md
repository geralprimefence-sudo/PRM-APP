Deploy rapido — passos para empurrar e activar CI
===============================================

1) Testar localmente as alterações recentes (opcional):

```bash
# Ver alterações
git status
git diff

# Testar app local (sem Docker) — já tens OCR a correr via Waitress: 
# .\venv\Scripts\python.exe .\scripts\request_health.py
```

2) Fazer commit & push seguro usando token (recomendado para CI)

Windows PowerShell (exemplo):

```powershell
# definir token no ambiente (exemplo)
$env:GITHUB_TOKEN = 'ghp_XXXXXXXXXXXXXXXXXXXX'
.\scripts\git_push_with_token.ps1 -Branch main -Repo "<owner>/<repo>"
```

Linux / macOS:

```bash
# GITHUB_TOKEN=ghp_XXXXXXXXXXXXXXXXXXXX ./scripts/git_push_with_token.sh main <owner/repo>
```

3) No GitHub → Settings → Secrets do repositório, adiciona:
- `RENDER_API_KEY` = (API key do Render)
- `RENDER_SERVICE_ID` = (ID do serviço Render que vais criar)

4) Ligar o repo no Render

- No Render, cria um Web Service e escolhe a opção Docker; aponta para este repo.
- Alternativamente usa o `render-ocr.yaml` (Render auto-detectará se suportado).
- Define `API_KEY` e `CORS_ORIGINS` nas Environment Variables do serviço.

Quando fizeres push, o workflow `.github/workflows/deploy-ocr.yml` irá construir a imagem, publicar no GHCR e (se existirem os secrets) acionar um deploy no Render.
