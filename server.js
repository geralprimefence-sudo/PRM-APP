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
const SESSION_SECRET = process.env.SESSION_SECRET || "prm-secret"

// Render/Reverse proxy needs trust proxy so secure cookies are accepted over HTTPS.
app.set("trust proxy",1)

// Ensure runtime folders exist on fresh hosts.
fs.mkdirSync(path.join(__dirname,"uploads"),{recursive:true})
fs.mkdirSync(path.join(__dirname,"temp"),{recursive:true})


app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static("public"))
app.use("/uploads",express.static("uploads"))

app.use(session({
secret:SESSION_SECRET,
resave:false,
saveUninitialized:false,
cookie:{
httpOnly:true,
sameSite:"lax",
secure:process.env.NODE_ENV === "production"
}
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

await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tipo_entidade TEXT")
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nome TEXT")
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS contribuinte TEXT")
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS endereco TEXT")
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT")
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone TEXT")

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

function normalizarValor(raw){

if(raw===null || raw===undefined) return NaN

let s = String(raw).trim()
s = s.replace(/[^\d,.\s-]/g,"")
s = s.replace(/\s+/g,"")

const temVirgula = s.includes(",")
const temPonto = s.includes(".")

if(temVirgula && temPonto){
s = s.replace(/\./g,"").replace(",",".")
}else if(temVirgula){
s = s.replace(",",".")
}

return parseFloat(s)

}

function dataParaInput(raw){

if(raw===null || raw===undefined || raw==="") return ""

const d = raw instanceof Date ? raw : new Date(raw)
if(Number.isNaN(d.getTime())) return ""

const yyyy = d.getFullYear()
const mm = String(d.getMonth()+1).padStart(2,"0")
const dd = String(d.getDate()).padStart(2,"0")

return `${yyyy}-${mm}-${dd}`

}

function apagarUploadSilencioso(nomeFicheiro){

if(!nomeFicheiro) return

const seguro = path.basename(nomeFicheiro)
const full = path.join(__dirname,"uploads",seguro)

try{
if(fs.existsSync(full)){
fs.unlinkSync(full)
}
}catch(err){
console.error("Falha a apagar upload pendente",err)
}

}

function normalizarNif(raw){

if(raw===null || raw===undefined) return ""

return String(raw).replace(/\D/g,"")

}

function normalizarTextoComparacao(raw){

if(raw===null || raw===undefined) return ""

return String(raw)
.normalize("NFD")
.replace(/[\u0300-\u036f]/g,"")
.toLowerCase()
.replace(/[^a-z0-9]/g,"")

}

function normalizarTextoOCR(texto){

if(!texto) return ""

let t = String(texto)

// Corrige ruido tipico de OCR em recibos termicos (O->0, I/l->1 em contexto numerico)
t = t.replace(/(?<=\d)[oO](?=\d)/g,"0")
t = t.replace(/(?<=\d)[iIl](?=\d)/g,"1")
t = t.replace(/(?<=\d)[sS](?=\d)/g,"5")

// Uniformiza separadores e remove duplicacoes de espaco
t = t.replace(/\u00A0/g," ").replace(/[^\S\r\n]+/g," ")
t = t.replace(/\s*([.,])\s*/g,"$1")

// Reintroduz quebras onde normalmente existem no talao
t = t.replace(/(TOTAL|IVA|TAXA|CARTAO|BALCAO)/gi,"\n$1")

return t

}

function classificarTipoPorEntidade(dados,perfil){

const nifFatura = normalizarNif(dados.nif)
const nifRegistado = normalizarNif(perfil.contribuinte)

if(nifRegistado && nifFatura && nifRegistado===nifFatura){
return "receita"
}

const nomeRegistado = normalizarTextoComparacao(perfil.nome)
const empresaFatura = normalizarTextoComparacao(dados.empresa)

if(
nomeRegistado &&
empresaFatura &&
(empresaFatura.includes(nomeRegistado) || nomeRegistado.includes(empresaFatura))
){
return "receita"
}

return "despesa"

}

function extrairValorDoTexto(texto){

const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
const numeroRegex = /\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}|\d{3,6}/g

const candidatos = []

function pushCandidato(token,peso,contextoTotal){
if(!token) return

let v = NaN
if(/[.,]/.test(token)){
v = normalizarValor(token)
}else if(contextoTotal){
// Em OCR de taloes, "2650" em linha de total costuma significar 26,50
const intVal = Number(token)
if(!Number.isNaN(intVal) && intVal >= 100 && intVal <= 999999){
v = intVal / 100
}
}

if(!Number.isNaN(v) && v > 0){
candidatos.push({valor:v,peso})
}
}

for(let i=0;i<linhas.length;i++){
const linha = linhas[i]
const lower = linha.toLowerCase()

const totalForte =
lower.includes("total a pagar") ||
lower.includes("valor total") ||
lower.includes("total liqu") ||
lower.includes("a pagar")

const totalFraco = lower.includes("total")
const linhaNegativa = lower.includes("iva") || lower.includes("taxa") || lower.includes("base")

// Recibos termicos: a linha final costuma conter o total mais fiavel
const estaNoFim = i >= Math.max(0, linhas.length - 12)

const contexto = `${linha} ${linhas[i+1] || ""}`
const tokens = contexto.match(numeroRegex) || []

for(const token of tokens){
let peso = 1
if(totalFraco) peso += 2
if(totalForte) peso += 4
if(linhaNegativa) peso -= 2
if(estaNoFim) peso += 2
if(/eur|€/.test(contexto.toLowerCase())) peso += 1
pushCandidato(token,peso,totalForte || totalFraco)
}
}

if(candidatos.length){
const filtrados = candidatos.filter((c)=> c.valor > 0 && c.valor < 100000)

if(filtrados.length){
filtrados.sort((a,b)=> (b.peso - a.peso) || (b.valor - a.valor))
return filtrados[0].valor
}
}

return 0

}

function linhaPareceEmpresa(linha){

if(!linha) return false

const l = linha.toLowerCase().trim()
if(l.length < 4 || l.length > 60) return false

if(/[0-9]/.test(l)) return false

const bloqueadas = [
"fatura",
"recibo",
"nif",
"contribuinte",
"total",
"iva",
"data",
"pagamento",
"cliente",
"natureza",
"referencia",
"resumo",
"isento",
"artigo",
"observa",
"telefone",
"email",
"e-mail",
"site",
"www",
"iban",
"swift",
"bank",
"original",
"balcao",
"cartao",
"debito",
"talhao",
"terminal",
"operador",
"documento"
]

if(bloqueadas.some((b) => l.includes(b))) return false

return /[a-zA-Z\u00C0-\u017F]/.test(l)

}

function construirDataValida(dia,mes,ano){

const d = Number(dia)
const m = Number(mes)
let y = Number(ano)

if([d,m,y].some((n)=> Number.isNaN(n))) return null
if(y < 100) y += 2000
if(m < 1 || m > 12 || d < 1 || d > 31) return null

const data = new Date(y,m-1,d)
if(
data.getFullYear()!==y ||
data.getMonth()!==(m-1) ||
data.getDate()!==d
) return null

const anoAtual = new Date().getFullYear()
if(y < 2018 || y > anoAtual + 1) return null

return data

}

function extrairDataDoTexto(texto){

const linhas = String(texto || "").split("\n").map((l)=> l.trim()).filter(Boolean)
const candidatos = []

const regexDMY = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g
const regexYMD = /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g
const regexYYMD = /(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g

for(let i=0;i<linhas.length;i++){

const linha = linhas[i]
const l = linha.toLowerCase()

let pesoBase = 1
if(i < 35) pesoBase += 1

if(/data|emiss|emissao|factura|fatura|invoice|doc\.?/.test(l)) pesoBase += 4
if(/venc|due|pagamento limite|validade/.test(l)) pesoBase -= 3

for(const match of linha.matchAll(regexDMY)){
const data = construirDataValida(match[1],match[2],match[3])
if(data) candidatos.push({data,peso:pesoBase})
}

for(const match of linha.matchAll(regexYMD)){
const data = construirDataValida(match[3],match[2],match[1])
if(data) candidatos.push({data,peso:pesoBase + 1})
}

for(const match of linha.matchAll(regexYYMD)){
const yy = Number(match[1])
const mm = Number(match[2])
const dd = Number(match[3])

// Typical toll OCR: 26-03-05 means 2026-03-05.
if(yy >= 18 && yy <= 60){
const data = construirDataValida(dd,mm,yy)
if(data) candidatos.push({data,peso:pesoBase + 2})
}
}

}

if(!candidatos.length) return null

candidatos.sort((a,b)=>{
if(b.peso!==a.peso) return b.peso - a.peso
return b.data.getTime() - a.data.getTime()
})

return candidatos[0].data

}



function extrairDadosFatura(texto){

let valor = 0
let data = null
let empresa = "desconhecido"
let nif = ""
let tipo = "despesa"

const textoTratado = normalizarTextoOCR(texto)
const textoLower = textoTratado.toLowerCase()



valor = extrairValorDoTexto(textoTratado)

if(Number.isNaN(valor)){
valor = 0
}

data = extrairDataDoTexto(textoTratado)



const nifRegex = /nif[:\s]*([0-9]{9})/i
const nifMatch = textoTratado.match(nifRegex)

if(nifMatch){
nif = nifMatch[1]
}



const linhas = textoTratado.split("\n").map((l) => l.trim()).filter(Boolean)

let melhorScore = -1
const linhasPrioritarias = linhas.slice(0,40)
for(let i=0;i<linhasPrioritarias.length;i++){
const linha = linhasPrioritarias[i]
if(!linhaPareceEmpresa(linha)) continue

let score = 1
if(i < 10) score += 2
if(/\b(lda|sa|unipessoal|supermercado|restaurante|cafe|minimercado|loja)\b/i.test(linha)) score += 2
if(linha.split(" ").length >= 2) score += 1

if(score > melhorScore){
melhorScore = score
empresa = linha
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
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/login.html"))
})

app.get("/register",(req,res)=>{
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/register.html"))
})

app.get("/dashboard",auth,(req,res)=>{
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/dashboard.html"))
})

app.get("/relatorio",auth,(req,res)=>{
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/relatorio.html"))
})

app.get("/capturar-foto",auth,(req,res)=>{
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/capturar-foto.html"))
})

app.get("/confirmar-upload",auth,(req,res)=>{
res.set("Cache-Control","no-store")
res.sendFile(path.join(__dirname,"public/confirmar-upload.html"))
})



app.post("/login",async(req,res)=>{

const {username,password} = req.body
const usernameTrim = (username || "").trim()
const ajaxLogin = req.get("x-requested-with") === "fetch-login"
const loginErro = (msg)=>`/login?error=${encodeURIComponent(msg)}&username=${encodeURIComponent(usernameTrim)}`

const responderErro = (status,msg)=>{
if(ajaxLogin){
return res.status(status).json({ok:false,error:msg})
}
return res.redirect(loginErro(msg))
}

if(!usernameTrim || !password){
return responderErro(400,"Utilizador e password sao obrigatorios")
}

let result

try{

result = await pool.query(
"SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1",
[usernameTrim]
)

}catch(err){

console.error(err)
return responderErro(500,"Erro ao validar login")

}

if(result.rows.length===0){
return responderErro(401,"Username ou password errada")
}

const user = result.rows[0]

const valid = await bcrypt.compare(password,user.password)

if(!valid){
return responderErro(401,"Username ou password errada")
}

req.session.userId = user.id
req.session.save((err)=>{
if(err){
console.error(err)
return responderErro(500,"Erro ao criar sessao")
}

if(ajaxLogin){
return res.json({ok:true,redirect:"/dashboard"})
}

res.redirect("/dashboard")
})

})



app.post("/register",async(req,res)=>{

const {
username,
password,
tipoEntidade,
nome,
contribuinte,
endereco,
email,
telefone
} = req.body

const tipoNormalizado = (tipoEntidade || "").trim().toLowerCase()
const usernameTrim = (username || "").trim()
const nomeTrim = (nome || "").trim()
const contribuinteTrim = (contribuinte || "").trim()
const enderecoTrim = (endereco || "").trim()
const emailTrim = (email || "").trim()
const telefoneTrim = (telefone || "").trim()
const mensagemErro = (msg)=>`/register?error=${encodeURIComponent(msg)}`

if(!usernameTrim || !password){
return res.redirect(mensagemErro("Utilizador e password sao obrigatorios"))
}

if(tipoNormalizado!=="empresa" && tipoNormalizado!=="pessoal"){
return res.redirect(mensagemErro("Escolhe se e empresa ou pessoal"))
}

if(!nomeTrim || !enderecoTrim || !emailTrim || !telefoneTrim){
return res.redirect(mensagemErro("Nome, endereco, email e telefone sao obrigatorios"))
}

if(tipoNormalizado==="empresa" && !contribuinteTrim){
return res.redirect(mensagemErro("Contribuinte e obrigatorio para empresa"))
}

const hash = await bcrypt.hash(password,10)

try{

await pool.query(
`INSERT INTO users
(username,password,tipo_entidade,nome,contribuinte,endereco,email,telefone)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
[
usernameTrim,
hash,
tipoNormalizado,
nomeTrim,
tipoNormalizado==="empresa" ? contribuinteTrim : null,
enderecoTrim,
emailTrim,
telefoneTrim
]
)

}catch(err){

if(err && err.code==="23505"){
return res.redirect(mensagemErro("Utilizador ja existe"))
}

console.error(err)
return res.redirect(mensagemErro("Erro ao criar conta"))

}

res.redirect("/register?success=" + encodeURIComponent("Conta criada com sucesso. Ja podes fazer login."))

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

const userResult = await pool.query(
"SELECT nome,contribuinte FROM users WHERE id=$1",
[req.session.userId]
)

const perfil = userResult.rows[0] || {}
dados.tipo = classificarTipoPorEntidade(dados,perfil)

if(req.session.pendingUpload && req.session.pendingUpload.ficheiro){
apagarUploadSilencioso(req.session.pendingUpload.ficheiro)
}

req.session.pendingUpload = {
tipo:dados.tipo,
fornecedor:dados.empresa,
valor:dados.valor,
data:dataParaInput(dados.data),
nif:dados.nif,
ficheiro:req.file.filename
}

return res.redirect("/confirmar-upload")

}catch(err){

console.error(err)
res.send("Erro ao processar documento")

}

})

app.get("/api/pending-upload",auth,(req,res)=>{

if(!req.session.pendingUpload){
return res.status(404).json({ok:false,erro:"Sem upload pendente"})
}

res.json({ok:true,pending:req.session.pendingUpload})

})

app.post("/api/confirmar-upload",auth,async(req,res)=>{

if(!req.session.pendingUpload){
return res.status(400).json({ok:false,erro:"Sem upload pendente"})
}

const pendente = req.session.pendingUpload

const fornecedor = (req.body.fornecedor || pendente.fornecedor || "desconhecido").trim()
const tipo = (req.body.tipo || pendente.tipo || "despesa").trim().toLowerCase()==="receita" ? "receita" : "despesa"
const valorNormalizado = normalizarValor(req.body.valor ?? pendente.valor)
const dataFinal = dataParaInput(req.body.data || pendente.data)

if(Number.isNaN(valorNormalizado) || valorNormalizado<=0){
return res.status(400).json({ok:false,erro:"Valor invalido"})
}

if(!dataFinal){
return res.status(400).json({ok:false,erro:"Data invalida"})
}

await pool.query(
`INSERT INTO registos
(user_id,tipo,fornecedor,valor,data,ficheiro)
VALUES($1,$2,$3,$4,$5,$6)`,
[
req.session.userId,
tipo,
fornecedor,
valorNormalizado,
dataFinal,
pendente.ficheiro
]
)

req.session.pendingUpload = null

res.json({ok:true,redirect:"/dashboard"})

})

app.post("/api/cancelar-upload",auth,(req,res)=>{

if(req.session.pendingUpload && req.session.pendingUpload.ficheiro){
apagarUploadSilencioso(req.session.pendingUpload.ficheiro)
}

req.session.pendingUpload = null

res.json({ok:true,redirect:"/dashboard"})

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
const valorNormalizado = normalizarValor(valor)

if(Number.isNaN(valorNormalizado)){
return res.status(400).json({ok:false,erro:"Valor invalido"})
}

await pool.query(
"UPDATE registos SET valor=$1 WHERE id=$2 AND user_id=$3",
[valorNormalizado,req.params.id,req.session.userId]
)

res.json({ok:true})

})



app.listen(PORT,()=>{

console.log("Servidor ativo na porta",PORT)

})