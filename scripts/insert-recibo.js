require('dotenv').config()
const { Pool } = require('pg')

async function main(){
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } })
  try{
    const u = await pool.query('SELECT id FROM users WHERE username=$1',['admin1'])
    if(u.rows.length===0){
      console.error('utilizador admin1 nao encontrado')
      process.exit(1)
    }
    const userId = u.rows[0].id
    const ficheiro = '1773170438129-recibo_brisa.jpeg'
    const q = `INSERT INTO registos(user_id,tipo,fornecedor,valor,valor_sem_iva,valor_iva,valor_total,data,ficheiro)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`
    const vals = [userId,'despesa','Brisa Concessão Rodoviária, S.A.',2.45,2.45,0.00,2.45,'2026-03-05',ficheiro]
    const res = await pool.query(q, vals)
    console.log('Inserido id:', res.rows[0].id)
  }catch(err){
    console.error('Erro a inserir:', err.message || err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
