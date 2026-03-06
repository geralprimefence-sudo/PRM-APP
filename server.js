require("dotenv").config()

const express = require("express")
const multer = require("multer")
const session = require("express-session")
const bcrypt = require("bcrypt")
const fs = require("fs")
const path = require("path")
const pdfParse = require("pdf-parse")
const Tesseract = require("tesseract.js")
const { Pool } = require("pg")

const app = express()
const PORT = process.env.PORT || 3000


app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static("public"))
app.use("/uploads",express.static("uploads"))

app.use(session({
secret:"prm-secret",
resave:false,
saveUninitialized:false
}))


const pool = new Pool({
connectionString:process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
})


async function criarTabelas(){

await pool.query(`
CREATE TABLE IF NOT EXISTS users(
id SERIAL PRIMARY KEY,
username TEXT UNIQUE NOT NULL,
password TEXT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)

await pool.query(`
CREATE TABLE IF NOT EXISTS registos(
id SERIAL PRIMARY KEY,
user_id INTEGER,
tipo TEXT,
fornecedor TEXT,
valor NUMERIC,
data DATE,
ficheiro TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)

const admin = await pool.query(
"SELECT * FROM users WHERE username=$1",
["admin"]
)

if(admin.rows.length===0){

const hash = await bcrypt.hash("admin123",10)

await pool.query(
"INSERT INTO users (username,password) VALUES ($1,$2)",
["admin",hash]
)

console.log("Admin criado")

}

console.log("Tabelas verificadas")

}

criarTabelas().catch(console.error)



app.get("/",(req,res)=>{
res.redirect("/login")
})



function auth(req,res,next){

if(!req.session.userId){
return res.redirect("/login")
}

next()

}



const storage = multer.diskStorage({

destination:"uploads",

filename:(req,file,cb)=>{
cb(null,Date.now()+"-"+file.originalname)
}

})

const upload = multer({storage})



async function extrairTexto(file){

const ext = path.extname(file).toLowerCase()

if(ext==".pdf"){

const dataBuffer = fs.readFileSync(file)
const data = await pdfParse(dataBuffer)

return data.text

}

const result = await Tesseract.recognize(file,"por")

return result.data.text

}



function extrairDadosFatura(texto){

let valor = 0
let data = new Date()
let empresa = "desconhecido"
let nif = ""
let tipo = "despesa"

const textoLower = texto.toLowerCase()



const totalRegex = /(total\s*(a\s*pagar)?|valor\s*total|total\s*eur)[^\d]*(\d+[.,]\d{2})/i
const totalMatch = texto.match(totalRegex)

if(totalMatch){

let v = totalMatch[3]
v = v.replace(",",".")
valor = parseFloat(v)

}else{

const valores = texto.match(/\d+[.,]\d{2}/g)

if(valores){

let v = valores[valores.length-1]
v = v.replace(",",".")
valor = parseFloat(v)

}

}

if(valor > 10000){
valor = valor / 100
}



const dataRegex = /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/
const dataMatch = texto.match(dataRegex)

if(dataMatch){

data = new Date(
dataMatch[0].split(/[\/\-\.]/).reverse().join("-")
)

}



const nifRegex = /nif[:\s]*([0-9]{9})/i
const nifMatch = texto.match(nifRegex)

if(nifMatch){
nif = nifMatch[1]
}



const linhas = texto.split("\n")

for(let linha of linhas){

linha = linha.trim()

if(linha.length > 4 && linha.length < 60){

const lower = linha.toLowerCase()

if(
!linha.match(/[0-9]/) &&
!lower.includes("fatura") &&
!lower.includes("natureza") &&
!lower.includes("nif") &&
!lower.includes("total") &&
!lower.includes("iva") &&
!lower.includes("data") &&
!lower.includes("pagamento") &&
!lower.includes("cliente") &&
!lower.includes("recibo")
){

empresa = linha
break

}

}

}



if(
textoLower.includes("fatura emitida") ||
textoLower.includes("cliente") ||
textoLower.includes("invoice") ||
textoLower.includes("recibo verde")
){
tipo = "receita"
}

return {valor,data,empresa,nif,tipo}

}



app.get("/login",(req,res)=>{
res.sendFile(path.join(__dirname,"public/login.html"))
})

app.get("/register",(req,res)=>{
res.sendFile(path.join(__dirname,"public/register.html"))
})

app.get("/dashboard",auth,(req,res)=>{
res.sendFile(path.join(__dirname,"public/dashboard.html"))
})

app.get("/relatorio",auth,(req,res)=>{
res.sendFile(path.join(__dirname,"public/relatorio.html"))
})



app.post("/login",async(req,res)=>{

const {username,password} = req.body

const result = await pool.query(
"SELECT * FROM users WHERE username=$1",
[username]
)

if(result.rows.length===0){
return res.send("Utilizador não encontrado")
}

const user = result.rows[0]

const valid = await bcrypt.compare(password,user.password)

if(!valid){
return res.send("Password errada")
}

req.session.userId = user.id

res.redirect("/dashboard")

})



app.post("/register",async(req,res)=>{

const {username,password} = req.body

const hash = await bcrypt.hash(password,10)

await pool.query(
"INSERT INTO users(username,password) VALUES($1,$2)",
[username,hash]
)

res.redirect("/login")

})



app.get("/logout",(req,res)=>{

req.session.destroy()

res.redirect("/login")

})



app.post("/upload",auth,upload.single("file"),async(req,res)=>{

try{

const file = req.file.path

const texto = await extrairTexto(file)
console.log(texto)

const dados = extrairDadosFatura(texto)

await pool.query(
`INSERT INTO registos
(user_id,tipo,fornecedor,valor,data,ficheiro)
VALUES($1,$2,$3,$4,$5,$6)`,
[
req.session.userId,
dados.tipo,
dados.empresa,
dados.valor,
dados.data,
req.file.filename
]
)

res.redirect("/dashboard")

}catch(err){

console.error(err)
res.send("Erro ao processar documento")

}

})



app.get("/api/registos",auth,async(req,res)=>{

const result = await pool.query(
"SELECT * FROM registos WHERE user_id=$1 ORDER BY data DESC",
[req.session.userId]
)

res.json(result.rows)

})



app.get("/api/dashboard",auth,async(req,res)=>{

const receitas = await pool.query(
`SELECT COALESCE(SUM(valor),0) total
FROM registos
WHERE user_id=$1 AND tipo='receita'`,
[req.session.userId]
)

const despesas = await pool.query(
`SELECT COALESCE(SUM(valor),0) total
FROM registos
WHERE user_id=$1 AND tipo='despesa'`,
[req.session.userId]
)

res.json({
receitas:receitas.rows[0].total,
despesas:despesas.rows[0].total
})

})



app.delete("/api/delete/:id",auth,async(req,res)=>{

await pool.query(
"DELETE FROM registos WHERE id=$1 AND user_id=$2",
[req.params.id,req.session.userId]
)

res.json({ok:true})

})



app.post("/api/update/:id",auth,async(req,res)=>{

const {valor} = req.body

await pool.query(
"UPDATE registos SET valor=$1 WHERE id=$2 AND user_id=$3",
[valor,req.params.id,req.session.userId]
)

res.json({ok:true})

})



app.listen(PORT,()=>{

console.log("Servidor ativo na porta",PORT)

})