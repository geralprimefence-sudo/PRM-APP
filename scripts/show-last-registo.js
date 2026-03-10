require('dotenv').config()
const { Pool } = require('pg')

async function main(){
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } })
  try{
    const r = await pool.query('SELECT * FROM registos ORDER BY id DESC LIMIT 1')
    if(r.rows.length===0){
      console.log('Nenhum registo encontrado')
    } else {
      console.log(JSON.stringify(r.rows[0], null, 2))
    }
  }catch(err){
    console.error('Erro a consultar DB:', err.message || err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
