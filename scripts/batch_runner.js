const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const FormData = require('form-data')

const TARGET = process.argv[2] || 'https://prm-app-1.onrender.com/api/mobile/ocr-upload'
const OUTFILE = process.argv[3] || 'ocr_batch_results.json'
const UPLOAD_DIR = process.argv[4] || 'uploads'
const API_KEY = process.env.API_KEY || process.argv[5] || ''

function listFiles(dir){
  const exts = ['.jpg','.jpeg','.png','.pdf']
  let out = []
  const items = fs.readdirSync(dir,{withFileTypes:true})
  for(const it of items){
    const full = path.join(dir,it.name)
    if(it.isDirectory()) out = out.concat(listFiles(full))
    else if(exts.includes(path.extname(it.name).toLowerCase())) out.push(full)
  }
  return out
}

function postFile(target, file){
  return new Promise((resolve)=>{
    const form = new FormData()
    form.append('file', fs.createReadStream(file))
    const url = new URL(target)
    const isHttps = url.protocol === 'https:'
    const headers = form.getHeaders()
    if(API_KEY) headers['x-api-key'] = API_KEY
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (isHttps?443:80),
      path: url.pathname + url.search,
      headers
    }
    const req = (isHttps?https:http).request(options, (res)=>{
      let data = ''
      res.on('data', d=> data += d)
      res.on('end', ()=>{
        let body = data
        try{ body = JSON.parse(data) }catch(_){ }
        resolve({file, status: res.statusCode, body})
      })
    })
    req.on('error', (err)=> resolve({file, error: String(err)}))
    form.pipe(req)
  })
}

async function run(){
  try{
    if(!fs.existsSync(UPLOAD_DIR)) throw new Error('uploads dir not found: ' + UPLOAD_DIR)
    const files = listFiles(UPLOAD_DIR)
    console.log('Found', files.length, 'files')
    const results = []
    for(const f of files){
      process.stdout.write('Posting ' + path.relative('.',f) + ' ... ')
      const r = await postFile(TARGET,f)
      results.push(r)
      console.log(r.status || 'ERR')
    }
    fs.writeFileSync(OUTFILE, JSON.stringify({target:TARGET, runAt: new Date().toISOString(), results}, null, 2))
    console.log('Wrote', OUTFILE)
    const ok = results.filter(r=>r.status===200).length
    console.log('\nSummary:', ok + '/' + results.length, 'returned 200')
  }catch(err){
    console.error('Fatal error:', err.message || err)
    process.exit(1)
  }
}

run()
