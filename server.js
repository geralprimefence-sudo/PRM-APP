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


// DATABASE
const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
})


// CRIAR TABELAS AUTOMATICAMENTE
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

await pool.query(`
INSERT INTO users (username, password)
SELECT 'admin','admin123'
WHERE NOT EXISTS (
SELECT 1 FROM users WHERE username='admin'
)
`)

console.log("Tabelas verificadas")

}

criarTabelas().catch(console.error)


// MIDDLEWARE
app.use(express.urlencoded({extended:true}))
app.use(express.json())

app.use(express.static("public"))

app.get("/login", (req, res) => {
res.sendFile(__dirname + "/public/login.html")
})

app.use(session({
secret:"prm-secret",
resave:false,
saveUninitialized:false
}))



// UPLOAD
const storage = multer.diskStorage({

destination:"uploads",

filename:(req,file,cb)=>{
cb(null,Date.now()+"-"+file.originalname)
}

})

const upload = multer({storage})




// AUTH
function auth(req,res,next){

if(!req.session.userId){

return res.redirect("/login")

}

next()

}



// OCR
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



// PARSER VALOR
function extrairValor(texto){

const regex = /(\d+[.,]\d{2})/g

const valores = texto.match(regex)

if(!valores) return 0

return parseFloat(valores[valores.length-1].replace(",","."))
}




// ROTAS

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



// LOGIN
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



// REGISTO
app.post("/register",async(req,res)=>{

const {username,password} = req.body

const hash = await bcrypt.hash(password,10)

await pool.query(
"INSERT INTO users(username,password) VALUES($1,$2)",
[username,hash]
)

res.redirect("/login")

})



// LOGOUT
app.get("/logout",(req,res)=>{

req.session.destroy()

res.redirect("/login")

})




// UPLOAD FATURA
app.post("/upload",auth,upload.single("file"),async(req,res)=>{

try{

const file = req.file.path

const texto = await extrairTexto(file)

const valor = extrairValor(texto)

await pool.query(
`INSERT INTO registos
(user_id,tipo,fornecedor,valor,data,ficheiro)
VALUES($1,$2,$3,$4,$5,$6)`,
[
req.session.userId,
"despesa",
"automatico",
valor,
new Date(),
req.file.filename
]
)

res.redirect("/dashboard")

}catch(err){

console.error(err)

res.send("Erro ao processar documento")

}

})




// API REGISTOS
app.get("/api/registos",auth,async(req,res)=>{

const result = await pool.query(

"SELECT * FROM registos WHERE user_id=$1 ORDER BY data DESC",

[req.session.userId]

)

res.json(result.rows)

})



// API DASHBOARD
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




// START
app.listen(PORT,()=>{

console.log("Servidor ativo na porta",PORT)

})