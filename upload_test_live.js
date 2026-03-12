const https = require('https')
const fs = require('fs')
const path = require('path')
const FormData = require('form-data')

const TARGET = process.argv[2] || 'https://www.appcontabill.com/api/mobile/ocr-upload'
const FILE = process.argv[3] || 'uploads/1772887664479-17728876448562309712493608399391.jpg'
const API_KEY = process.env.API_KEY || process.argv[4] || ''

if(!fs.existsSync(FILE)){
  console.error('Ficheiro nao encontrado:', FILE)
  process.exit(2)
}

const form = new FormData()
form.append('file', fs.createReadStream(FILE))

const url = new URL(TARGET)
const headers = form.getHeaders()
if(API_KEY) headers['x-api-key'] = API_KEY
const options = {
  method: 'POST',
  hostname: url.hostname,
  port: url.port || 443,
  path: url.pathname + url.search,
  headers
}

const req = https.request(options, (res) => {
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
