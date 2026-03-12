// Batch OCR test script (single clean copy)
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const FormData = require('form-data')

// Usage: node scripts/batch_ocr_test.js [TARGET] [UPLOADS_DIR] [OUT_FILE] [API_KEY]
const TARGET = process.argv[2] || 'https://prm-app-1.onrender.com/api/mobile/ocr-upload'
const UPLOADS_DIR = process.argv[3] || path.join(__dirname,'..','uploads')
const OUT = process.argv[4] || path.join(process.cwd(),'batch_ocr_results.json')
const API_KEY = process.env.API_KEY || process.argv[5] || ''

function listFiles(dir){
  const exts = ['.jpg','.jpeg','.png','.pdf']
  const out = []
  function walk(d){
    for(const it of fs.readdirSync(d,{withFileTypes:true})){ 
      const full = path.join(d,it.name)
      if(it.isDirectory()) walk(full)
      else if(exts.includes(path.extname(it.name).toLowerCase())) out.push(full)
    }
  }
  walk(dir)
  return out
}

function postFile(target,file){
  return new Promise((resolve)=>{
    const form = new FormData()
    form.append('file', fs.createReadStream(file))
    const url = new URL(target)
    const isHttps = url.protocol === 'https:'
    const headers = form.getHeaders()
    if(API_KEY) headers['x-api-key'] = API_KEY
    const options = { method:'POST', hostname:url.hostname, port: url.port|| (isHttps?443:80), path: url.pathname+url.search, headers }
    const req = (isHttps?https:http).request(options, res=>{
      let data = ''
      res.on('data', c=> data += c)
      res.on('end', ()=>{
        let parsed = data
        try{ parsed = JSON.parse(data) }catch(_){ }
        resolve({file, status: res.statusCode, body: parsed})
      })
    })
    req.on('error', e=> resolve({file, error: String(e)}))
    form.pipe(req)
  })
}

async function run(){
  if(!fs.existsSync(UPLOADS_DIR)){
    console.error('Uploads dir not found:', UPLOADS_DIR)
    process.exit(2)
  }
  const files = listFiles(UPLOADS_DIR)
  if(!files.length){ console.log('No image/pdf files found in uploads'); process.exit(0) }
  console.log('Found', files.length, 'files; target=', TARGET)

  const results = []
  for(const f of files){
    process.stdout.write('Posting ' + path.relative(process.cwd(),f) + ' ... ')
    try{
      const r = await postFile(TARGET,f)
      results.push(r)
      console.log(r.status || 'ERR')
    }catch(err){
      results.push({file:f,error:String(err)})
      console.log('ERR')
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({target:TARGET, runAt:new Date().toISOString(), results},null,2))
  console.log('Saved results to', OUT)
  const ok = results.filter(x=>x.status && x.status===200).length
  console.log('\nSummary: ' + ok + '/' + results.length + ' returned 200')
}

run().catch(e=>{ console.error(e); process.exit(1) })
