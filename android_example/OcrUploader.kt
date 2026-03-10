package com.example.faturas

import android.content.Context
import android.graphics.Bitmap
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

object OcrUploader {
    private val client = OkHttpClient.Builder()
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    // Compress bitmap to a temporary JPEG file and upload as multipart/form-data
    fun uploadBitmap(context: Context, bitmap: Bitmap, serverUrl: String, callback: (Int, String) -> Unit) {
        // write compressed JPEG to temp file
        val tmpFile = File.createTempFile("ocr_upload", ".jpg", context.cacheDir)
        FileOutputStream(tmpFile).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
            out.flush()
        }

        val mediaType = "image/jpeg".toMediaTypeOrNull()
        val fileBody = RequestBody.create(mediaType, tmpFile)

        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", tmpFile.name, fileBody)
            .build()

        val request = Request.Builder()
            .url(serverUrl)
            .post(multipart)
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                tmpFile.delete()
                callback(-1, e.message ?: "network error")
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val body = response.body?.string() ?: ""
                tmpFile.delete()
                callback(response.code, body)
            }
        })
    }
}
