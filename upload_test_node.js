const fs = require('fs')
const http = require('http')
const path = require('path')
const FormData = require('form-data')

const HOST = process.env.HOST || '192.168.1.135'
const PORT = process.env.PORT || 3000
const URL_PATH = process.env.PATHNAME || '/api/mobile/ocr-upload'
const FILE = process.argv[2] || 'uploads/1772887664479-17728876448562309712493608399391.jpg'

const filePath = path.resolve(FILE)
if(!fs.existsSync(filePath)){
  console.error('Ficheiro nao encontrado:', filePath)
  process.exit(2)
}

const form = new FormData()
form.append('file', fs.createReadStream(filePath))

const headers = form.getHeaders()

const req = http.request({
  hostname: HOST,
  port: PORT,
  path: URL_PATH,
  method: 'POST',
  headers
}, (res) => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', ()=>{
    console.log('STATUS', res.statusCode)
    try{
      console.log(JSON.stringify(JSON.parse(data), null, 2))
    }catch(_){
      console.log(data)
    }
  })
})

req.on('error', (err)=>{
  console.error('Request error', err.message || err)
})

form.pipe(req)
