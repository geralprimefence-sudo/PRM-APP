require("dotenv").config()

const fs = require("fs")
const path = require("path")
const { Pool } = require("pg")

function listarFicheiros(dir,maxDepth = 8,depth = 0,acc = []){
  if(depth > maxDepth) return acc

  let itens = []
  try{
    itens = fs.readdirSync(dir,{withFileTypes:true})
  }catch(_){
    return acc
  }

  for(const item of itens){
    const full = path.join(dir,item.name)
    if(item.isFile()) acc.push(full)
  }

  for(const item of itens){
    if(!item.isDirectory()) continue
    listarFicheiros(path.join(dir,item.name),maxDepth,depth + 1,acc)
  }

  return acc
}

function normalizarRef(raw){
  if(!raw) return ""
  return String(raw).replace(/\\/g,"/").replace(/^\/+/,"").trim()
}

function nomeSemPrefixoTempo(nome){
  const m = String(nome || "").match(/^\d{10,}-(.+)$/)
  return m && m[1] ? m[1] : ""
}

function relativoUploads(uploadsRoot,fullPath){
  const rel = path.relative(uploadsRoot,fullPath)
  return rel.replace(/\\/g,"/")
}

async function main(){
  const dryRun = process.argv.includes("--dry-run")
  const uploadsRoot = path.join(process.cwd(),"uploads")

  const todos = listarFicheiros(uploadsRoot,8)
  const indice = new Map()

  for(const full of todos){
    const base = path.basename(full)
    if(!indice.has(base)) indice.set(base,[])
    indice.get(base).push(full)
  }

  const pool = new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:{rejectUnauthorized:false}
  })

  let tentativas = 0
  let atualizados = 0
  let ambiguos = 0
  let semMatch = 0

  try{
    const result = await pool.query("SELECT id,ficheiro FROM registos ORDER BY id DESC")

    for(const row of result.rows){
      const id = Number(row.id)
      const ref = normalizarRef(row.ficheiro)
      if(!ref) continue

      const direto = path.join(uploadsRoot,ref)
      if(fs.existsSync(direto) && fs.statSync(direto).isFile()) continue

      tentativas += 1

      const base = path.basename(ref)
      const semTempo = nomeSemPrefixoTempo(base)

      const candidatos = []
      if(indice.has(base)) candidatos.push(...indice.get(base))
      if(semTempo && indice.has(semTempo)) candidatos.push(...indice.get(semTempo))

      const unicos = [...new Set(candidatos)]

      if(unicos.length === 0){
        semMatch += 1
        continue
      }

      if(unicos.length > 1){
        ambiguos += 1
        continue
      }

      const novoRel = relativoUploads(uploadsRoot,unicos[0])
      if(!novoRel || novoRel === ref) continue

      if(!dryRun){
        await pool.query("UPDATE registos SET ficheiro=$1 WHERE id=$2",[novoRel,id])
      }

      atualizados += 1
    }

    console.log("Reconciliacao concluida")
    console.log("Tentativas:",tentativas)
    console.log("Atualizados:",atualizados)
    console.log("Ambiguos:",ambiguos)
    console.log("Sem match:",semMatch)
    if(dryRun) console.log("Modo dry-run: sem alteracoes na BD")
  } finally {
    await pool.end()
  }
}

main().catch((err)=>{
  console.error(err)
  process.exit(1)
})
