import fs from 'fs'
import path from 'path'

const URL = process.argv[2] || 'http://192.168.1.135:3000/api/mobile/ocr-upload'
const FILE = process.argv[3] || 'uploads/1772887664479-17728876448562309712493608399391.jpg'

async function main(){
  const filePath = path.resolve(FILE)
  if(!fs.existsSync(filePath)){
    console.error('Ficheiro nao encontrado:', filePath)
    process.exit(2)
  }

  const buffer = fs.readFileSync(filePath)
  const fileName = path.basename(filePath)

  const form = new FormData()
  const blob = new Blob([buffer], { type: 'image/jpeg' })
  form.append('file', blob, fileName)

  try{
    const res = await fetch(URL, { method: 'POST', body: form })
    const text = await res.text()
    console.log('STATUS', res.status)
    console.log(text)
  }catch(err){
    console.error('Erro no fetch:', err.message || err)
    process.exit(1)
  }
}

main()
