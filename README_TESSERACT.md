Instalar o binário Tesseract (Windows)
=====================================

Passos rápidos:

1) Verifica se tens privilégios de Administrador (necessário para Chocolatey). Se preferires não usar admin, usa o instalador MSI manualmente e adiciona o caminho ao PATH.

2) Opção Chocolatey (recomendada se tens o choco instalado e em modo Administrador):

```powershell
# abre PowerShell como Administrador
choco install -y tesseract
```

3) Opção winget / instalador manual:

- Tenta `winget install UB-Mannheim.Tesseract` (pode não encontrar se a fonte/região não estiver configurada).
- Alternativamente descarrega o MSI do UB Mannheim: https://github.com/UB-Mannheim/tesseract/wiki

4) Verificar a instalação:

```powershell
# novo terminal (ou reinicia o terminal)
where tesseract
# ou
tesseract --version
```

5) Se `tesseract` não for encontrado, adiciona a pasta do executável ao `PATH`:

- Geralmente fica em `C:\Program Files\Tesseract-OCR` ou similar. Adiciona essa pasta às Variáveis de Ambiente → Path.

6) Teste final: com o `venv` ativado e o servidor a correr, envia uma imagem de teste:

```powershell
# curl.exe vem com Git for Windows; em PowerShell podes usar Invoke-RestMethod (exemplo usando curl.exe):
curl.exe -F "file=@test_receipt.png" http://127.0.0.1:8001/ocr
```

Notas
-----
- O projecto já tem um endpoint `/health` que devolve o estado das bibliotecas Python e do binário Tesseract:

```powershell
curl.exe http://127.0.0.1:8001/health
```

- Se tiveres dificuldades com permissões de instalação (Chocolatey), usa o instalador MSI manual e actualiza o `PATH`.
