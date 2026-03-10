require('dotenv').config()
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

async function main(){
  const limit = Number(process.argv[2]) || 20
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } })
  try{
    const q = `SELECT id,user_id,tipo,fornecedor,nif,valor,valor_sem_iva as valorSemIva,valor_iva as valorIva,valor_total as valorTotal,data,ficheiro,created_at FROM registos ORDER BY id DESC LIMIT $1`
    const res = await pool.query(q,[limit])
    const rows = res.rows
    const outDir = path.join(process.cwd(),'exports')
    fs.mkdirSync(outDir,{recursive:true})
    const jsonPath = path.join(outDir,`registos_last_${limit}.json`)
    const csvPath = path.join(outDir,`registos_last_${limit}.csv`)
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8')

    if(rows.length){
      const headers = Object.keys(rows[0])
      const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => {
        const v = r[h]
        if(v === null || v === undefined) return ''
        const s = String(v).replace(/"/g,'""')
        if(s.includes(',') || s.includes('"') || s.includes('\n')) return '"'+s+'"'
        return s
      }).join(','))).join('\n')
      fs.writeFileSync(csvPath, csv, 'utf8')
    } else {
      fs.writeFileSync(csvPath, '', 'utf8')
    }

    console.log('Exported', rows.length, 'registos to:')
    console.log('JSON ->', jsonPath)
    console.log('CSV  ->', csvPath)
  }catch(err){
    console.error('Erro ao exportar:', err.message || err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
