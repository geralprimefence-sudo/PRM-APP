require("dotenv").config()

const fs = require("fs")
const path = require("path")
const { Pool } = require("pg")

const BASELINE_PATH = process.env.DOCS_BASELINE_PATH
  ? path.resolve(process.env.DOCS_BASELINE_PATH)
  : path.join(__dirname,"baselines","documentos-orfaos-baseline.json")

function encontrarFicheiroPorBasename(dir,nomeBase,maxDepth = 8,depth = 0){
  if(depth > maxDepth) return null

  let itens = []
  try{
    itens = fs.readdirSync(dir,{withFileTypes:true})
  }catch(_){
    return null
  }

  for(const item of itens){
    const full = path.join(dir,item.name)
    if(item.isFile() && item.name === nomeBase) return full
  }

  for(const item of itens){
    if(!item.isDirectory()) continue
    const full = path.join(dir,item.name)
    const encontrado = encontrarFicheiroPorBasename(full,nomeBase,maxDepth,depth + 1)
    if(encontrado) return encontrado
  }

  return null
}

function resolverCaminhoUploadSeguroLocal(refFicheiro){
  if(!refFicheiro) return null

  const uploadsRoot = path.join(process.cwd(),"uploads")
  const bruto = String(refFicheiro).trim()
  if(!bruto) return null

  const candidatosRef = new Set()
  const normalizado = bruto.replace(/\\/g,"/").replace(/^\/+/ ,"").trim()
  if(normalizado) candidatosRef.add(normalizado)

  try{
    const decodificado = decodeURIComponent(normalizado)
    if(decodificado) candidatosRef.add(decodificado)
  }catch(_){
    // Ignora refs mal codificadas e continua com a versao normalizada.
  }

  const nomesCandidatos = new Set()

  for(const ref of candidatosRef){
    const direto = path.join(uploadsRoot,ref)
    if(fs.existsSync(direto) && fs.statSync(direto).isFile()) return direto

    const nomeBase = path.basename(ref)
    if(!nomeBase) continue
    nomesCandidatos.add(nomeBase)

    const semPrefixoTempo = nomeBase.match(/^\d{10,}-(.+)$/)
    if(semPrefixoTempo && semPrefixoTempo[1]) nomesCandidatos.add(semPrefixoTempo[1])
  }

  for(const nome of nomesCandidatos){
    const encontrado = encontrarFicheiroPorBasename(uploadsRoot,nome,8)
    if(encontrado) return encontrado
  }

  return null
}

function carregarBaseline(){
  if(!fs.existsSync(BASELINE_PATH)) return []

  try{
    const raw = fs.readFileSync(BASELINE_PATH,"utf8")
    const json = JSON.parse(raw)
    if(Array.isArray(json?.knownMissingIds)){
      return json.knownMissingIds.filter((v)=> Number.isInteger(v))
    }
  }catch(err){
    console.error("Nao foi possivel ler baseline:",err.message || err)
  }

  return []
}

function guardarBaseline(ids){
  const payload = {
    generatedAt: new Date().toISOString(),
    knownMissingIds: [...ids].sort((a,b)=> a - b)
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH),{recursive:true})
  fs.writeFileSync(BASELINE_PATH,JSON.stringify(payload,null,2) + "\n","utf8")
}

async function main(){
  const writeBaseline = process.argv.includes("--write-baseline")
  const requireBaseline = process.argv.includes("--require-baseline")

  const pool = new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:{rejectUnauthorized:false}
  })

  try{
    const result = await pool.query("SELECT id,user_id,ficheiro FROM registos ORDER BY id DESC")

    const missingRows = result.rows.filter((r)=> !resolverCaminhoUploadSeguroLocal(r.ficheiro))
    const missingIds = missingRows.map((r)=> Number(r.id)).filter((v)=> Number.isInteger(v))

    if(writeBaseline){
      guardarBaseline(missingIds)
      console.log(`Baseline gravada em ${BASELINE_PATH} com ${missingIds.length} ids.`)
      return
    }

    const baselineExiste = fs.existsSync(BASELINE_PATH)
    const baselineIds = carregarBaseline()

    if(requireBaseline && !baselineExiste){
      console.error(`Baseline obrigatoria em falta: ${BASELINE_PATH}`)
      process.exitCode = 1
      return
    }

    if(!requireBaseline && !baselineExiste){
      console.log(`Aviso: baseline ainda nao existe em ${BASELINE_PATH}.`)
      console.log("Corre `npm run smoke:docs:baseline` para criar baseline inicial.")
      return
    }
    const baselineSet = new Set(baselineIds)
    const missingSet = new Set(missingIds)

    const novosPartidos = missingIds.filter((id)=> !baselineSet.has(id)).sort((a,b)=> b - a)
    const recuperados = baselineIds.filter((id)=> !missingSet.has(id)).sort((a,b)=> b - a)

    console.log("Total registos:",result.rows.length)
    console.log("Sem ficheiro resolvido:",missingIds.length)
    console.log("Novos partidos vs baseline:",novosPartidos.length)
    console.log("Recuperados vs baseline:",recuperados.length)

    if(novosPartidos.length){
      console.log("Novos ids com problema:",novosPartidos.slice(0,50))
      process.exitCode = 1
      return
    }

    console.log("OK: sem regressao de documentos em falta.")
  } finally {
    await pool.end()
  }
}

main().catch((err)=>{
  console.error(err)
  process.exit(1)
})
