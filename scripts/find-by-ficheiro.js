require('dotenv').config()
const { Pool } = require('pg')

async function main(){
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } })
  try{
    const q = await pool.query("SELECT id,user_id,tipo,fornecedor,nif,valor,valor_iva,valor_sem_iva,valor_total,data,ficheiro FROM registos WHERE ficheiro ILIKE '%recibo_brisa%' ORDER BY id DESC")
    if(q.rows.length===0){
      console.log('Nenhum registo encontrado para ficheiro contendo "recibo_brisa"')
    } else {
      console.log(JSON.stringify(q.rows, null, 2))
    }
  }catch(err){
    console.error('Erro a consultar DB:', err.message || err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
