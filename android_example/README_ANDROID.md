
Android example - ML Kit Text Recognition (Kotlin)
===============================================

Resumo:
- Exemplo simples usando Google ML Kit Text Recognition on-device como fallback.
- Quando o dispositivo tem rede, o app deve enviar a imagem para a API (`/ocr`) para melhor precisão.

Dependências (Gradle)
---------------------

Adiciona ao `build.gradle` do módulo:

```gradle
dependencies {
	// ML Kit on-device text recognition
	implementation 'com.google.mlkit:text-recognition:16.1.0'

	// OkHttp para upload multipart
	implementation 'com.squareup.okhttp3:okhttp:4.11.0'

	// (opcional) Retrofit se preferires um cliente mais alto nível
	// implementation 'com.squareup.retrofit2:retrofit:2.9.0'
}
```

Permissões (AndroidManifest.xml)
-------------------------------

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
```

Fluxo recomendado
-----------------
1. Captura a imagem com a câmara (ou escolhe da galeria).
2. Redimensiona para largura ~1000–1600px e comprime JPEG (70–85%).
3. Primeiro tenta `runLocalOcr(bitmap)` (ML Kit) para obter texto imediatamente.
4. Se o resultado não for suficiente, chama `OcrUploader.uploadBitmap(context, bitmap, "https://api.seu-dominio/ocr")`.

Exemplo de uso (pseudocódigo)
----------------------------

```kotlin
// após captura da imagem como Bitmap
runLocalOcr(bitmap) { localText ->
	if (localText.isNotBlank() && localConfidenceIsGood(localText)) {
		// usa resultado local
	} else {
		// envia para servidor para resultado mais preciso
		OcrUploader.uploadBitmap(context, bitmap, "http://yourserver:8000/ocr") { code, body ->
			runOnUiThread {
				if (code == 200) {
					// parse JSON e mostrar resultado ao utilizador
				} else {
					// mostrar erro/feedback
				}
			}
		}
	}
}
```

Notas
-----
- Compacta e reduz resolução no dispositivo antes de enviar para poupar banda e acelerar upload.
- Usa HTTPS para o servidor em produção e implementa autenticação.
- Mostra um ecrã de consentimento para o utilizador quando envias imagens para o servidor (privacidade).

Ficheiros nesta pasta
---------------------
- `MainActivity.kt` — snippet de ML Kit local.
- `OcrUploader.kt` — utilitário para compressão e upload usando OkHttp.

