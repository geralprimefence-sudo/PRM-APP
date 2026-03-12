require("dotenv").config()

const express = require("express")
const multer = require("multer")
const session = require("express-session")
const PgSession = require("connect-pg-simple")(session)
const bcrypt = require("bcrypt")
const fs = require("fs")
const path = require("path")
const pdfParse = require("pdf-parse")
const Tesseract = require("tesseract.js")
const PDFDocument = require('pdfkit')
const { Pool } = require("pg")

let sharp = null
try{
sharp = require("sharp")
}catch(_){
// Sharp is optional at runtime; OCR still works without it.
}

let jsQR = null
try{
jsQR = require("jsqr")
}catch(_){
// jsQR is optional; OCR still works without QR decode.
}

const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY || "helloworld"
const OCRSPACE_HAS_REAL_KEY = Boolean(OCRSPACE_API_KEY) && OCRSPACE_API_KEY !== "helloworld"
const OCRSPACE_ENABLED = String(process.env.OCRSPACE_ENABLED || (OCRSPACE_HAS_REAL_KEY ? "1" : "0")) !== "0"
const OCRSPACE_TIMEOUT_MS = Number(process.env.OCRSPACE_TIMEOUT_MS || 12000)
const PADDLEOCR_ENABLED = String(process.env.PADDLEOCR_ENABLED || "0") === "1"
const PADDLEOCR_API_URL = String(process.env.PADDLEOCR_API_URL || "").trim()
const PADDLEOCR_TIMEOUT_MS = Number(process.env.PADDLEOCR_TIMEOUT_MS || 12000)

const app = express()
const PORT = process.env.PORT || 3000
const SESSION_SECRET = process.env.SESSION_SECRET || "prm-secret"
const UPLOADS_DIR = process.env.UPLOADS_DIR || (process.env.RENDER_DISK_PATH ? path.join(process.env.RENDER_DISK_PATH,"uploads") : path.join(__dirname,"uploads"))
const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname,"temp")

// Render/Reverse proxy needs trust proxy so secure cookies are accepted over HTTPS.
app.set("trust proxy",1)

// Ensure runtime folders exist on fresh hosts.
fs.mkdirSync(UPLOADS_DIR,{recursive:true})
fs.mkdirSync(TEMP_DIR,{recursive:true})


// Capture raw body for debug when JSON parsing fails
app.use(express.urlencoded({ extended: true }))
app.use(express.json({
	verify: function (req, res, buf, encoding) {
		try { req.rawBody = buf.toString(encoding || 'utf8') } catch (e) { req.rawBody = '' }
	}
}))
app.use(express.static("public"))

// Body parse error handler (logs raw body when JSON is invalid)
app.use((err, req, res, next) => {
	if (!err) return next()
	try{
		if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
			console.error('Body parse error', {
				message: err.message,
				stack: err.stack,
				rawBody: req && req.rawBody ? req.rawBody : null
			})
			return res.status(400).json({ ok: false, erro: 'JSON mal formado' })
		}
	}catch(_){ }
	return next(err)
})
app.use("/uploads",express.static(UPLOADS_DIR))


const pool = new Pool({
connectionString:process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
})

app.use(session({
secret:SESSION_SECRET,
resave:false,
saveUninitialized:false,
store:new PgSession({
pool,
tableName:"user_sessions",
createTableIfMissing:true
}),
cookie:{
httpOnly:true,
sameSite:"lax",
secure:process.env.NODE_ENV === "production"
}
}))


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
valor_sem_iva NUMERIC,
valor_iva NUMERIC,
valor_total NUMERIC,
data DATE,
ficheiro TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)

await pool.query("ALTER TABLE registos ADD COLUMN IF NOT EXISTS valor_sem_iva NUMERIC")
await pool.query("ALTER TABLE registos ADD COLUMN IF NOT EXISTS valor_iva NUMERIC")
await pool.query("ALTER TABLE registos ADD COLUMN IF NOT EXISTS valor_total NUMERIC")

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

destination:UPLOADS_DIR,

filename:(req,file,cb)=>{
cb(null,Date.now()+"-"+file.originalname)
}

})

const upload = multer({
storage,
limits:{fileSize:12 * 1024 * 1024},
fileFilter:(req,file,cb)=>{
const ext = path.extname(file.originalname || "").toLowerCase()
const mime = String(file.mimetype || "").toLowerCase()
const permitidoExt = [".pdf",".jpg",".jpeg",".png",".webp"].includes(ext)
const permitidoMime = mime.startsWith("image/") || mime === "application/pdf"
if(!permitidoExt && !permitidoMime){
return cb(new Error("Formato invalido. Usa PDF ou imagem."))
}
cb(null,true)
}
})



function pontuarTextoOCR(texto){

const t = String(texto || "")
if(!t.trim()) return 0

let score = 0
score += Math.min(120,t.length / 8)
score += (t.match(/\d/g) || []).length * 0.7
score += (t.match(/(?:total|iva|nif|fatura|data|eur|€)/gi) || []).length * 6
score += (t.match(/(?:fornecedor|emitente|cliente|mercado|supermercado|loja|tal[aã]o|recibo)/gi) || []).length * 2
score -= (t.match(/[\uFFFD]/g) || []).length * 4

return score

}

function pontuarResultadoOCR(texto){
const scoreTexto = pontuarTextoOCR(texto)
const scoreCampos = pontuarCamposExtraidos(texto)
return scoreTexto + (scoreCampos * 1.8)
}

function temCamposCriticosOCR(texto){
	const totais = extrairTotaisDoTexto(texto)
	const data = extrairDataDoTexto(texto)
	const nif = extrairNifDoTexto(texto)
	const fornecedor = extrairFornecedorDoTexto(texto,nif)
	const totalOk = Number(totais.total || 0) > 0
	const dataOk = Boolean(data)
	const fornecedorOk = Boolean(fornecedor && fornecedor !== "desconhecido")
	return totalOk && dataOk && fornecedorOk
}

function pontuarCamposExtraidos(texto){

const totais = extrairTotaisDoTexto(texto)
const data = extrairDataDoTexto(texto)
const nif = extrairNifDoTexto(texto)
const fornecedor = extrairFornecedorDoTexto(texto,nif)

let score = 0

if(Number(totais.total || 0) > 0) score += 40
if(Number(totais.iva || 0) > 0) score += 12
if(Number(totais.semIva || 0) > 0) score += 8

if(data) score += 28
if(nif && /^\d{9}$/.test(nif)) score += 14
if(fornecedor && fornecedor !== "desconhecido") score += 22

if(fornecedor && fornecedor.length > 50) score -= 6

return score

}



function textoOCRSuficientementeBom(texto,score){
	const t = String(texto || "").toLowerCase()
	if(!t.trim()) return false
	const temTotal = /\btotal\b|a pagar|valor total/.test(t)
	const temData = /\bdata\b|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(t)
	const temNumero = (t.match(/\d/g) || []).length >= 8
	return score >= 120 && temNumero && (temTotal || temData)
}

async function preprocessarImagemParaOCR(file,modo = "balanced"){

	if(!sharp) return null

	const ext = path.extname(file || "").toLowerCase()
	if(![".jpg",".jpeg",".png",".webp"].includes(ext)) return null

	const tmpName = `ocr-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
	const out = path.join(TEMP_DIR,tmpName)

	try{
		let img = sharp(file)
			.rotate()
			.resize({width:1750,height:1750,fit:"inside",withoutEnlargement:true})

		if(modo === "threshold"){
			img = img
				.grayscale()
				.normalize()
				.linear(1.35,-25)
				.threshold(178)
				.sharpen({sigma:1.05,m1:0.8,m2:0.25,x1:2,y2:10,y3:20})
		}else{
			img = img
				.grayscale()
				.normalize()
				.sharpen({sigma:1.15,m1:0.9,m2:0.35,x1:2,y2:10,y3:20})
		}

		await img.png({compressionLevel:9}).toFile(out)
		return out
	}catch(err){
		console.error("Falha no preprocessamento OCR",err?.message || err)
		return null
	}

}

function parseNumeroSeguro(raw){
	if(raw===null || raw===undefined) return NaN
	let s = String(raw).trim().replace(/\s+/g,"")
	s = s.replace(/[^\d,.-]/g,"")
	if(s.includes(",") && s.includes(".")){
		s = s.replace(/\./g,"").replace(",", ".")
	}else if(s.includes(",")){
		s = s.replace(",", ".")
	}
	return Number(s)
}

function normalizarNifQr(raw){
	const n = String(raw || "").replace(/\D/g,"")
	if(/^\d{9}$/.test(n)) return n
	return ""
}

function extrairDadosDoTextoQr(textoQr){

	const texto = String(textoQr || "")
	if(!texto.trim()) return null

	const mapa = {}
	const kv = /\b([A-Z]{1,3})\s*[:=]\s*([^*\n;|]+)/g
	for(const m of texto.matchAll(kv)){
		const k = String(m[1] || "").trim()
		const v = String(m[2] || "").trim()
		if(k && v && !mapa[k]) mapa[k] = v
	}

	let data = null
	const dataRaw = mapa.F || mapa.DATA || (texto.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0] || ""
	if(dataRaw){
		const d = new Date(dataRaw)
		if(!Number.isNaN(d.getTime())) data = d
	}

	const totalPreferencial = parseNumeroSeguro(mapa.O || mapa.TOTAL || "")
	let total = Number.isFinite(totalPreferencial) && totalPreferencial>0 ? totalPreferencial : NaN
	if(!Number.isFinite(total) || total<=0){
		const nums = [...texto.matchAll(/\d{1,6}[.,]\d{2}/g)].map((m)=> parseNumeroSeguro(m[0])).filter((n)=> Number.isFinite(n) && n>0 && n<100000)
		if(nums.length) total = Math.max(...nums)
	}

	const ivaPreferencial = parseNumeroSeguro(mapa.N || mapa.IVA || "")
	let iva = Number.isFinite(ivaPreferencial) && ivaPreferencial>=0 ? ivaPreferencial : NaN
	if((!Number.isFinite(iva) || iva<0) && Number.isFinite(total) && total>0){
		iva = NaN
	}

	const nif = normalizarNifQr(mapa.B || mapa.NIF || "")

	if(!data && !Number.isFinite(total) && !nif){
		return null
	}

	return {
		data,
		total:Number.isFinite(total) ? Math.round(total * 100) / 100 : NaN,
		iva:Number.isFinite(iva) ? Math.round(iva * 100) / 100 : NaN,
		nif
	}

}

async function lerQrCodeDaImagem(file,modo = "raw"){

	if(!jsQR || !sharp) return null

	try{
		let img = sharp(file).rotate().resize({width:1900,height:1900,fit:"inside",withoutEnlargement:true})
		if(modo === "enhanced"){
			img = img.grayscale().normalize().sharpen({sigma:1.1,m1:0.9,m2:0.3,x1:2,y2:10,y3:20})
		}

		const out = await img.ensureAlpha().raw().toBuffer({resolveWithObject:true})
		const raw = new Uint8ClampedArray(out.data.buffer,out.data.byteOffset,out.data.byteLength)
		const qr = jsQR(raw,out.info.width,out.info.height,{inversionAttempts:"attemptBoth"})
		if(!qr || !qr.data) return null
		return String(qr.data || "")
	}catch(_){
		return null
	}

}

async function extrairDadosQrDaImagem(file){

	const textoRaw = await lerQrCodeDaImagem(file,"raw")
	const dadosRaw = extrairDadosDoTextoQr(textoRaw)
	if(dadosRaw) return dadosRaw

	const textoEnhanced = await lerQrCodeDaImagem(file,"enhanced")
	const dadosEnhanced = extrairDadosDoTextoQr(textoEnhanced)
	if(dadosEnhanced) return dadosEnhanced

	return null

}

function combinarDadosComQr(dados,qr){

	if(!qr) return dados

	const out = {...dados}

	if(qr.data instanceof Date && !Number.isNaN(qr.data.getTime())){
		out.data = qr.data
	}

	if(qr.nif){
		out.nif = qr.nif
	}

	if(Number.isFinite(qr.total) && qr.total > 0){
		out.valorTotal = Math.round(Number(qr.total) * 100) / 100
		out.valor = out.valorTotal

		if(Number.isFinite(qr.iva) && qr.iva >= 0 && qr.iva <= out.valorTotal){
			out.valorIva = Math.round(Number(qr.iva) * 100) / 100
			out.valorSemIva = Math.round(Math.max(0,out.valorTotal - out.valorIva) * 100) / 100
		}else if(Number.isFinite(out.valorIva) && out.valorIva >= 0 && out.valorIva <= out.valorTotal){
			out.valorSemIva = Math.round(Math.max(0,out.valorTotal - out.valorIva) * 100) / 100
		}else{
			out.valorSemIva = out.valorTotal
			out.valorIva = 0
		}
	}

	return out

}

async function reconhecerTextoOCRImagem(file,opcoes = {}){

const modoRapido = Boolean(opcoes.fast)

const tentativas = modoRapido
? [
{name:"psm6",options:{tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"}},
{name:"psm11",options:{tessedit_pageseg_mode:"11",preserve_interword_spaces:"1"}}
]
: [
{name:"psm6",options:{tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"}},
{name:"psm4",options:{tessedit_pageseg_mode:"4",preserve_interword_spaces:"1"}},
{name:"psm11",options:{tessedit_pageseg_mode:"11",preserve_interword_spaces:"1"}},
{name:"psm12",options:{tessedit_pageseg_mode:"12",preserve_interword_spaces:"1"}}
]

let melhorTexto = ""
let melhorScoreGeral = -Infinity

for(const tentativa of tentativas){
try{
const result = await Tesseract.recognize(file,"por+eng",tentativa.options)
const texto = String(result?.data?.text || "").trim()
const score = pontuarResultadoOCR(texto)

if(score > melhorScoreGeral){
melhorScoreGeral = score
melhorTexto = texto
}
if(textoOCRSuficientementeBom(texto,score)){
break
}
}catch(err){
console.error(`Falha OCR (${tentativa.name})`,err?.message || err)
}
}

return {
texto:melhorTexto,
score:melhorScoreGeral
}

}

async function reconhecerTextoOCRApiGratis(file){

	if(!OCRSPACE_ENABLED) return {texto:"",score:-Infinity}

	const ext = path.extname(file || "").toLowerCase()
	const mimeByExt = {
		".jpg":"image/jpeg",
		".jpeg":"image/jpeg",
		".png":"image/png",
		".webp":"image/webp"
	}

	const mime = mimeByExt[ext]
	if(!mime) return {texto:"",score:-Infinity}

	const controller = new AbortController()
	const timer = setTimeout(()=> controller.abort(),OCRSPACE_TIMEOUT_MS)

	try{
		const b64 = fs.readFileSync(file).toString("base64")
		const params = new URLSearchParams()
		params.set("base64Image",`data:${mime};base64,${b64}`)
		params.set("language","por")
		params.set("isOverlayRequired","false")
		params.set("OCREngine","2")
		params.set("scale","true")

		const res = await fetch("https://api.ocr.space/parse/image",{
			method:"POST",
			headers:{
				"apikey":OCRSPACE_API_KEY,
				"Content-Type":"application/x-www-form-urlencoded"
			},
			body:params.toString(),
			signal:controller.signal
		})

		if(!res.ok) return {texto:"",score:-Infinity}

		const data = await res.json().catch(()=> null)
		const parsed = (data?.ParsedResults || [])
			.map((r)=> String(r?.ParsedText || "").trim())
			.filter(Boolean)
			.join("\n")
			.trim()

		if(!parsed) return {texto:"",score:-Infinity}

		return {
			texto:parsed,
			score:pontuarResultadoOCR(parsed)
		}
	}catch(err){
		console.error("Falha OCR API gratis",err?.message || err)
		return {texto:"",score:-Infinity}
	}finally{
		clearTimeout(timer)
	}

}

async function reconhecerTextoPaddleOCRApi(file){

	if(!PADDLEOCR_ENABLED || !PADDLEOCR_API_URL) return {texto:"",score:-Infinity}

	const ext = path.extname(file || "").toLowerCase()
	const mimeByExt = {
		".jpg":"image/jpeg",
		".jpeg":"image/jpeg",
		".png":"image/png",
		".webp":"image/webp",
		".pdf":"application/pdf"
	}

	const mime = mimeByExt[ext] || "application/octet-stream"
	const controller = new AbortController()
	const timer = setTimeout(()=> controller.abort(),PADDLEOCR_TIMEOUT_MS)

	try{
		const buffer = fs.readFileSync(file)
		const form = new FormData()
		const blob = new Blob([buffer],{type:mime})
		form.append("file",blob,path.basename(file))

		const res = await fetch(PADDLEOCR_API_URL,{method:"POST",body:form,signal:controller.signal})
		if(!res.ok) return {texto:"",score:-Infinity}

		const data = await res.json().catch(()=> null)
		const texto = String(
			data?.text ||
			(Array.isArray(data?.lines) ? data.lines.join("\n") : "") ||
			(Array.isArray(data?.result) ? data.result.join("\n") : "") ||
			""
		).trim()

		if(!texto) return {texto:"",score:-Infinity}

		return {
			texto,
			score:pontuarResultadoOCR(texto)
		}
	}catch(err){
		console.error("Falha PaddleOCR API",err?.message || err)
		return {texto:"",score:-Infinity}
	}finally{
		clearTimeout(timer)
	}

}

async function extrairTexto(file,opcoes = {}){

const modoRapido = Boolean(opcoes.fast)
const usarApisExternas = opcoes.allowExternal !== false

const ext = path.extname(file).toLowerCase()

if(ext==".pdf"){

const dataBuffer = fs.readFileSync(file)
const data = await pdfParse(dataBuffer)
const textoPdf = String(data.text || "").trim()

// Some PDFs are image-based and return almost no text via pdf-parse.
if(textoPdf.length >= 30){
return textoPdf
}

try{
const resultadoOcr = await reconhecerTextoOCRImagem(file,{fast:modoRapido})
const textoOcr = String(resultadoOcr?.texto || "")
if(textoOcr.length >= 12) return textoOcr
}catch(_){
// Keep silent and fallback to parsed text below.
}

return textoPdf

}

const candidatos = []
let tmpPreA = null
let tmpPreB = null
try{
	const base = await reconhecerTextoOCRImagem(file,{fast:modoRapido})
	candidatos.push(base)

	tmpPreA = await preprocessarImagemParaOCR(file,"balanced")
	if(tmpPreA){
		candidatos.push(await reconhecerTextoOCRImagem(tmpPreA,{fast:modoRapido}))
	}

	if(!modoRapido){
		tmpPreB = await preprocessarImagemParaOCR(file,"threshold")
		if(tmpPreB){
			candidatos.push(await reconhecerTextoOCRImagem(tmpPreB,{fast:false}))
		}
	}

	const validos = candidatos
		.map((c)=> ({texto:String(c?.texto || ""),score:Number(c?.score || -Infinity)}))
		.filter((c)=> c.texto.trim())

	if(!validos.length) return ""

	validos.sort((a,b)=> b.score - a.score)

	const melhorLocal = validos[0]
	const localBom =
		melhorLocal.score >= 180 &&
		temCamposCriticosOCR(melhorLocal.texto)

	if(localBom){
		return melhorLocal.texto
	}

	const precisaReforcoExterno = !temCamposCriticosOCR(melhorLocal.texto)

	if(!precisaReforcoExterno){
		return melhorLocal.texto
	}

	if(usarApisExternas){
		const paddle = await reconhecerTextoPaddleOCRApi(file)
		if(paddle.texto){
			validos.push(paddle)
			validos.sort((a,b)=> b.score - a.score)
			const melhorComPaddle = validos[0]
			if(temCamposCriticosOCR(melhorComPaddle.texto)){
				return melhorComPaddle.texto
			}
		}

		const remoto = await reconhecerTextoOCRApiGratis(file)
		if(remoto.texto){
			validos.push(remoto)
			validos.sort((a,b)=> b.score - a.score)
		}
	}

	return validos[0].texto
}finally{
	if(tmpPreA){ try{ fs.unlinkSync(tmpPreA) }catch(_){ } }
	if(tmpPreB){ try{ fs.unlinkSync(tmpPreB) }catch(_){ } }
}

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
const full = path.join(UPLOADS_DIR,seguro)

try{
if(fs.existsSync(full)){
fs.unlinkSync(full)
}

}catch(err){
console.error("Falha a apagar upload pendente",err)
}

}

function moverUploadParaPastaPermanente(refFicheiro,dataRef){

const origem = resolverCaminhoUploadSeguro(refFicheiro)
if(!origem) return ""

const dataBase = dataRef ? new Date(dataRef) : new Date()
const d = Number.isNaN(dataBase.getTime()) ? new Date() : dataBase

const yyyy = String(d.getFullYear())
const mm = String(d.getMonth() + 1).padStart(2,"0")
const dd = String(d.getDate()).padStart(2,"0")

const pastaDestino = path.join(UPLOADS_DIR,yyyy,mm,dd)
fs.mkdirSync(pastaDestino,{recursive:true})

const nomeOrigem = path.basename(origem)
let nomeDestino = nomeOrigem
let destino = path.join(pastaDestino,nomeDestino)

if(path.resolve(origem) === path.resolve(destino)){
return path.relative(UPLOADS_DIR,destino).replace(/\\/g,"/")
}

if(fs.existsSync(destino)){
const parsed = path.parse(nomeOrigem)
nomeDestino = `${parsed.name}-${Date.now()}${parsed.ext}`
destino = path.join(pastaDestino,nomeDestino)
}

try{
fs.renameSync(origem,destino)
}catch(err){
console.error("Falha ao mover upload para pasta permanente",err?.message || err)
return ""
}

return path.relative(UPLOADS_DIR,destino).replace(/\\/g,"/")

}

function encontrarFicheiroPorBasename(dir,nomeBase,maxDepth = 5,depth = 0){

	if(depth > maxDepth) return null

	let itens = []
	try{
		itens = fs.readdirSync(dir,{withFileTypes:true})
	}catch(_){
		return null
	}

	for(const item of itens){
		const full = path.join(dir,item.name)
		if(item.isFile() && item.name === nomeBase){
			return full
		}
	}

	for(const item of itens){
		if(!item.isDirectory()) continue
		const full = path.join(dir,item.name)
		const encontrado = encontrarFicheiroPorBasename(full,nomeBase,maxDepth,depth + 1)
		if(encontrado) return encontrado
	}

	return null

}

function resolverCaminhoUploadSeguro(refFicheiro){

	if(!refFicheiro) return null

	const uploadsRoot = UPLOADS_DIR
	const bruto = String(refFicheiro).trim()
	if(!bruto) return null

	const candidatosRef = new Set()
	const normalizado = bruto.replace(/\\/g,"/").replace(/^\/+/,"").trim()
	if(normalizado) candidatosRef.add(normalizado)

	try{
		const decodificado = decodeURIComponent(normalizado)
		if(decodificado) candidatosRef.add(decodificado)
	}catch(_){
		// Se vier mal codificado, mantemos apenas o valor original.
	}

	const nomesCandidatos = new Set()

	for(const ref of candidatosRef){
		const direto = path.join(uploadsRoot,ref)
		if(fs.existsSync(direto) && fs.statSync(direto).isFile()) return direto

		const nomeBase = path.basename(ref)
		if(!nomeBase) continue
		nomesCandidatos.add(nomeBase)

		// Compatibilidade com nomes antigos: "<timestamp>-nome-original.ext"
		const semPrefixoTempo = nomeBase.match(/^\d{10,}-(.+)$/)
		if(semPrefixoTempo && semPrefixoTempo[1]){
			nomesCandidatos.add(semPrefixoTempo[1])
		}
	}

	for(const nome of nomesCandidatos){
		const encontrado = encontrarFicheiroPorBasename(uploadsRoot,nome,8)
		if(encontrado) return encontrado
	}

	return null

}

function enviarDocumentoSeguro(req,res,fullPath){

if(!fullPath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()){
return res.status(404).send("Documento nao encontrado")
}

const ext = path.extname(fullPath).toLowerCase()
if(ext === ".pdf"){
res.setHeader("Content-Type","application/pdf")
}else if([".jpg",".jpeg"].includes(ext)){
res.setHeader("Content-Type","image/jpeg")
}else if(ext === ".png"){
res.setHeader("Content-Type","image/png")
}

const downloadNome = path.basename(fullPath)
const forcarDownload = String(req.query.download || "") === "1"
const disposition = forcarDownload ? "attachment" : "inline"
res.setHeader("Content-Disposition",`${disposition}; filename="${downloadNome}"`)

const stream = fs.createReadStream(fullPath)
stream.on("error",(err)=>{
console.error("Erro a ler documento",err)
if(!res.headersSent){
res.status(500).send("Erro ao abrir documento")
}
})
stream.pipe(res)

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
t = t.replace(/\b[1l]va\b/gi,"IVA")
t = t.replace(/\bto[a4]l\b/gi,"TOTAL")
t = t.replace(/\beur\b/gi,"EUR")

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

function extrairTotaisDoTexto(texto){

const linhas = String(texto || "").split("\n").map((l)=> l.trim()).filter(Boolean)
const numeroRegex = /\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}|\d{3,6}/g

let total = null
let iva = null
let semIva = null
const taxaPadraoIva = 0.23

for(const linha of linhas){

const l = linha
  .toLowerCase()
  .replace(/\b[1l]va\b/g,"iva")
  .replace(/\bs\/\s*iva\b/g,"sem iva")

const tokens = linha.match(numeroRegex) || []
if(!tokens.length) continue

const valores = tokens
	.map((t)=>{
		if(/[.,]/.test(t)) return normalizarValor(t)
		const n = Number(t)
		if(Number.isNaN(n)) return NaN
		// OCR termico costuma perder separador decimal: 2650 => 26.50
		return n >= 100 ? (n / 100) : n
	})
	.filter((v)=> !Number.isNaN(v) && v > 0 && v < 100000)

if(!valores.length) continue

const maior = Math.max(...valores)

const eLinhaTotal =
	/total|a pagar|valor total|total a pagar|liquido/.test(l) &&
	!/subtotal|sem iva|base|incidencia|iva/.test(l)

const eLinhaIva = /\biva\b|imposto/.test(l)
const eLinhaSemIva = /sem iva|subtotal|base tributavel|incidencia|valor liquido/.test(l)
const linhaTaxa23 = /\b23(?:[.,]0+)?\s*%/.test(l) || /\b0[.,]23\b/.test(l)

if(eLinhaTotal && (total===null || maior > total)) total = maior

if(eLinhaIva){
let candidatoIva = maior
if(linhaTaxa23 && valores.length > 1){
// In lines like "IVA 23% ...", the smallest monetary token is usually IVA amount.
candidatoIva = Math.min(...valores)
}
if(iva===null || candidatoIva > iva) iva = candidatoIva
}

if(eLinhaSemIva && (semIva===null || maior > semIva)) semIva = maior

}

if(total===null){
	total = extrairValorDoTexto(texto)
}

if(total!==null && iva!==null && semIva===null){
	semIva = Math.max(0,total - iva)
}

if(semIva!==null && iva!==null && total===null){
	total = semIva + iva
}

if(total!==null && semIva!==null && iva===null){
	iva = Math.max(0,total - semIva)
}

if(total!==null && semIva===null){
	semIva = total / (1 + taxaPadraoIva)
}

if(total!==null && iva===null && semIva!==null){
	iva = Math.max(0,total - semIva)
}

if(semIva!==null && iva===null){
	iva = semIva * taxaPadraoIva
}

if(iva!==null && semIva===null){
	if(total!==null){
		semIva = Math.max(0,total - iva)
	}else{
		semIva = iva / taxaPadraoIva
	}
}

// OCR sometimes swaps base and VAT values. If ratio suggests inversion, swap.
if(total!==null && semIva!==null && iva!==null){
	const soma = semIva + iva
	const somaValida = Math.abs(soma - total) <= 0.08
	if(somaValida && iva > semIva){
		const r1 = semIva / Math.max(iva,0.0001)
		const r2 = iva / Math.max(semIva,0.0001)
		const semPareceTaxa = r1 > 0.19 && r1 < 0.27
		const ivaPareceTaxa = r2 > 0.19 && r2 < 0.27
		if(semPareceTaxa && !ivaPareceTaxa){
			const tmp = semIva
			semIva = iva
			iva = tmp
		}
	}
}

if(total===null && semIva!==null && iva!==null){
	total = semIva + iva
}

if(total!==null && semIva!==null && iva!==null){
	const soma = semIva + iva
	if(Math.abs(soma - total) > 0.06){
		if(semIva > total){
			semIva = Math.max(0,total - iva)
		}else if(iva > total){
			iva = Math.max(0,total - semIva)
		}else{
			semIva = Math.max(0,total - iva)
		}
	}
}

const f2 = (v)=>{
	if(v===null || Number.isNaN(v)) return 0
	return Math.round(Number(v) * 100) / 100
}

return {
	total:f2(total),
	iva:f2(iva),
	semIva:f2(semIva)
}

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

function similarFornecedor(a,b){
	if(!a || !b) return false
	const norm = (s)=> String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()
	const A = norm(a)
	const B = norm(b)
	if(!A || !B) return false
	if(A === B) return true
	if(A.includes(B) || B.includes(A)) return true
	const tokensA = new Set(A.split(/\s+/).filter(Boolean))
	const tokensB = new Set(B.split(/\s+/).filter(Boolean))
	let common = 0
	for(const t of tokensA) if(tokensB.has(t)) common++
	const minTokens = Math.min(Math.max(1,tokensA.size), Math.max(1,tokensB.size))
	if(common >= 2) return true
	if(common / minTokens >= 0.6) return true
	return false
}

async function encontrarRegistoDuplicado(userId,fornecedor,dataStr,valorTotal){
	const valor = Number(valorTotal || 0)
	if(!Number.isFinite(valor) || valor <= 0) return null
	const lim = 0.02
	try{
		const res = await pool.query(
			`SELECT * FROM registos WHERE user_id=$1 AND ABS(COALESCE(valor_total,valor,0) - $2) <= $3 ORDER BY created_at DESC LIMIT 50`,
			[userId,valor,lim]
		)
		const inputDate = dataParaInput(dataStr) ? new Date(dataParaInput(dataStr)) : null
		for(const row of res.rows){
			let dateOk = false
			if(row.data && inputDate){
				const dRow = new Date(row.data)
				const diff = Math.abs(dRow.getTime() - inputDate.getTime())
				if(diff <= (3 * 24 * 60 * 60 * 1000)) dateOk = true
			}
			const nomeOk = similarFornecedor(fornecedor, row.fornecedor)
			if(dateOk || nomeOk) return row
		}
	}catch(err){
		console.error("Erro a procurar duplicados",err?.message || err)
	}
	return null
}

function limparLinhaEmpresa(linha){

if(!linha) return ""

let limpa = String(linha)
limpa = limpa.replace(/^(emitente|fornecedor|empresa|nome|merchant|seller|loja)\s*[:\-]\s*/i,"")
limpa = limpa.replace(/\s{2,}/g," ").trim()
limpa = limpa.replace(/^[\-–•\s]+/,"").replace(/[\s,;:\-]+$/g,"")

return limpa

}

function extrairTituloFornecedorDoTexto(texto){

const linhas = String(texto || "").split("\n").map((l)=> limparLinhaEmpresa(l.trim())).filter(Boolean)
if(!linhas.length) return "desconhecido"

const bloqueadas = /fatura|factura|recibo|nif|contribuinte|total|iva|imposto|data|hora|pagamento|cliente|artigo|descricao|quantidade|preco|valor|terminal|cartao|mbway|multibanco|iban|www|http|email|telefone/i

let melhor = "desconhecido"
let melhorScore = -1

for(let i=0;i<Math.min(linhas.length,18);i++){
const linha = linhas[i]
const l = linha.toLowerCase()
if(linha.length < 3 || linha.length > 70) continue
if(bloqueadas.test(l)) continue
if(!/[a-zA-Z\u00C0-\u017F]/.test(linha)) continue

let score = 1
if(i < 4) score += 5
else if(i < 10) score += 2

if(linha === linha.toUpperCase()) score += 2
if(/\b(lda|s\.?a\.?|unipessoal|sociedade|supermercado|restaurante|cafe|farmacia|combustiveis|postos?)\b/i.test(linha)) score += 3

const nPalavras = linha.split(/\s+/).length
if(nPalavras >= 1 && nPalavras <= 6) score += 1

if(score > melhorScore){
melhorScore = score
melhor = linha
}
}

return melhor

}

function linhaTemRuidoMoradaOuContacto(linha){

const l = String(linha || "").toLowerCase()

return /\b(rua|av\.?|avenida|estrada|lote|andar|apartado|telefone|telemovel|tel\.?|email|e-mail|www|http|codigo postal|cp\b|iban|swift)\b/.test(l)

}

function extrairFornecedorDoTexto(texto,nif){

const linhas = String(texto || "").split("\n").map((l)=> l.trim()).filter(Boolean)
if(!linhas.length) return "desconhecido"

const tituloFornecedor = extrairTituloFornecedorDoTexto(texto)

const linhasPrioritarias = linhas.slice(0,60)
let melhor = "desconhecido"
let melhorScore = -1

for(let i=0;i<linhasPrioritarias.length;i++){

const original = linhasPrioritarias[i]
let linha = limparLinhaEmpresa(original)
if(!linhaPareceEmpresa(linha)) continue
const anterior = String(linhasPrioritarias[i-1] || "").toLowerCase()
const atual = String(original || "").toLowerCase()

let score = 1

if(i < 8) score += 4
else if(i < 20) score += 2

if(/\b(lda|s\.?a\.?|unipessoal|sociedade|supermercado|hipermercado|restaurante|cafe|minimercado|farmacia|combustiveis|postos?)\b/i.test(linha)) score += 4
if(linha.split(" ").length >= 2) score += 1
if(linha === linha.toUpperCase()) score += 1
if(linhaTemRuidoMoradaOuContacto(original)) score -= 3
if(linha.length > 45) score -= 1
if(/emitente|fornecedor|merchant|seller|empresa/.test(atual)) score += 5
if(/emitente|fornecedor|merchant|seller|empresa/.test(anterior)) score += 4
if(tituloFornecedor!="desconhecido" && normalizarTextoComparacao(linha) === normalizarTextoComparacao(tituloFornecedor)) score += 8

if(nif){
const idxNif = linhasPrioritarias.findIndex((l)=> l.includes(nif))
if(idxNif>=0){
if(i===idxNif) score += 2
if(i===idxNif-1) score += 4
if(i===idxNif-2) score += 2
}
}

if(score > melhorScore){
melhorScore = score
melhor = linha
}

}

if(tituloFornecedor!=="desconhecido" && melhorScore < 4){
return tituloFornecedor
}

return melhor || tituloFornecedor || "desconhecido"

}

function extrairClienteDoTexto(texto){

const linhas = String(texto || "").split("\n").map((l)=> String(l || "").trim()).filter(Boolean)
if(!linhas.length) return ""

const labelRegex = /\b(cliente|adquirente|destinatario|destinat[aá]rio|comprador|bill\s*to)\b/i
const bloqueadas = /fatura|factura|recibo|nif|contribuinte|total|iva|data|pagamento|artigo|descricao|quantidade|preco|valor|terminal|cartao|mbway|multibanco|iban|www|http|email|telefone/i

for(let i=0;i<linhas.length;i++){
const linhaOriginal = linhas[i]
const linhaLower = linhaOriginal.toLowerCase()
if(!labelRegex.test(linhaLower)) continue

let candidato = ""

if(/[:\-]/.test(linhaOriginal)){
const partes = linhaOriginal.split(/[:\-]/)
candidato = String(partes.slice(1).join(" ") || "").trim()
}

if(!candidato && i + 1 < linhas.length){
candidato = String(linhas[i + 1] || "").trim()
}

candidato = limparLinhaEmpresa(candidato)
if(!candidato) continue
if(candidato.length < 2 || candidato.length > 80) continue
if(/[0-9]/.test(candidato)) continue
if(bloqueadas.test(candidato.toLowerCase())) continue

return candidato
}

return ""

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

function extrairNifDoTexto(texto){

const validarNif = (nif)=>{
	if(!/^\d{9}$/.test(nif)) return false
	if(/^0+$/.test(nif)) return false
	const digitos = nif.split("").map(Number)
	const soma = digitos
		.slice(0,8)
		.reduce((acc,d,i)=> acc + d * (9 - i),0)
	const resto = soma % 11
	const controlo = resto < 2 ? 0 : 11 - resto
	return digitos[8] === controlo
}

const t = String(texto || "")
const rotulado = [...t.matchAll(/(?:nif|contribuinte|n\.?f\.?i\.?|vat)\D*(\d{9})/gi)]
for(const m of rotulado){
	const candidato = m[1]
	if(validarNif(candidato)) return candidato
}

const soltos = [...t.matchAll(/\b\d{9}\b/g)]
for(const m of soltos){
	const candidato = m[0]
	if(validarNif(candidato)) return candidato
}

return ""

}

function extrairDataDoTexto(texto){

const linhas = String(texto || "").split("\n").map((l)=> l.trim()).filter(Boolean)
const candidatos = []

const regexDMY = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g
const regexYMD = /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g
const regexYYMD = /(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g
const regexMesTexto = /(\d{1,2})\s*(?:de\s+)?(jan(?:eiro)?|fev(?:ereiro)?|mar(?:co|ço)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\s*(?:de\s+)?(\d{2,4})/gi

const meses = {
jan:1,janeiro:1,
fev:2,fevereiro:2,
mar:3,marco:3,"março":3,
abr:4,abril:4,
mai:5,maio:5,
jun:6,junho:6,
jul:7,julho:7,
ago:8,agosto:8,
set:9,setembro:9,
out:10,outubro:10,
nov:11,novembro:11,
dez:12,dezembro:12
}

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

for(const match of linha.matchAll(regexMesTexto)){
const dia = Number(match[1])
const chaveMes = String(match[2] || "").toLowerCase()
const mes = meses[chaveMes]
const ano = Number(match[3])
if(mes){
const data = construirDataValida(dia,mes,ano)
if(data) candidatos.push({data,peso:pesoBase + 3})
}
}

}

if(!candidatos.length) return null

candidatos.sort((a,b)=>{
if(b.peso!==a.peso) return b.peso - a.peso
const agora = Date.now()
const aFuturo = a.data.getTime() > (agora + 3 * 86400000)
const bFuturo = b.data.getTime() > (agora + 3 * 86400000)
if(aFuturo!==bFuturo) return aFuturo ? 1 : -1
return b.data.getTime() - a.data.getTime()
})

return candidatos[0].data

}




function qualidadeDadosExtraidos(dados){
	const total = Number(dados?.valorTotal ?? dados?.valor ?? 0)
	const dataValida = Boolean(dataParaInput(dados?.data))
	const fornecedorValido = Boolean(
		(dados?.empresa && dados.empresa !== "desconhecido") ||
		String(dados?.cliente || "").trim()
	)
	const nifValido = Boolean(dados?.nif && /^\d{9}$/.test(String(dados.nif)))
	const ivaValido = Number(dados?.valorIva ?? 0) >= 0

	let score = 0
	if(total > 0) score += 45
	if(dataValida) score += 28
	if(fornecedorValido) score += 22
	if(nifValido) score += 10
	if(ivaValido) score += 5

	return score
}

function dadosCriticosOk(dados){
	const total = Number(dados?.valorTotal ?? dados?.valor ?? 0)
	const dataValida = Boolean(dataParaInput(dados?.data))
	const fornecedorValido = Boolean(
		(dados?.empresa && dados.empresa !== "desconhecido") ||
		String(dados?.cliente || "").trim()
	)
	return total > 0 && dataValida && fornecedorValido
}

function extrairDadosFatura(texto){

let valor = 0
let valorSemIva = 0
let valorIva = 0
let valorTotal = 0
let data = null
let empresa = "desconhecido"
let cliente = ""
let nif = ""
let tipo = "despesa"

const textoTratado = normalizarTextoOCR(texto)
const textoLower = textoTratado.toLowerCase()



const totais = extrairTotaisDoTexto(textoTratado)
valorTotal = totais.total
valorIva = totais.iva
valorSemIva = totais.semIva
valor = valorTotal

if(Number.isNaN(valor)){
	valor = 0
}

data = extrairDataDoTexto(textoTratado)

nif = extrairNifDoTexto(textoTratado)

empresa = extrairFornecedorDoTexto(textoTratado,nif)
cliente = extrairClienteDoTexto(textoTratado)



if(
textoLower.includes("fatura emitida") ||
textoLower.includes("cliente") ||
textoLower.includes("invoice") ||
textoLower.includes("recibo verde")
){
tipo = "receita"
}

return {
valor,
valorSemIva,
valorIva,
valorTotal,
data,
empresa,
cliente,
nif,
tipo
}

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

if(!req.file || !req.file.path){
return res.status(400).send("Ficheiro invalido ou em falta")
}

const fastUpload = String(req.body.fast || req.query.fast || "") === "1"

// Nao apagamos automaticamente o upload pendente anterior.
// Isto evita perder ficheiros quando ha uploads seguidos em dispositivos lentos.

if(fastUpload){
const hoje = new Date()
req.session.pendingUpload = {
tipo:"despesa",
fornecedor:"",
valor:0,
valorSemIva:0,
valorIva:0,
valorTotal:0,
data:dataParaInput(hoje),
nif:"",
ficheiro:req.file.filename,
ocrStatus:"pending",
ocrFonte:"none"
}

return res.redirect("/confirmar-upload")
}

const file = req.file.path

const texto = await extrairTexto(file)

let dados = extrairDadosFatura(texto)
const dadosQr = await extrairDadosQrDaImagem(file)
dados = combinarDadosComQr(dados,dadosQr)

const userResult = await pool.query(
"SELECT nome,contribuinte FROM users WHERE id=$1",
[req.session.userId]
)

const perfil = userResult.rows[0] || {}
dados.tipo = classificarTipoPorEntidade(dados,perfil)

const nomeParaRegisto = dados.tipo === "receita"
? (String(dados.cliente || "").trim() || dados.empresa)
: dados.empresa

req.session.pendingUpload = {
tipo:dados.tipo,
fornecedor:nomeParaRegisto,
valor:dados.valor,
valorSemIva:dados.valorSemIva,
valorIva:dados.valorIva,
valorTotal:dados.valorTotal,
data:dataParaInput(dados.data),
nif:dados.nif,
ficheiro:req.file.filename,
ocrStatus:"done",
ocrFonte:"sync"
}

return res.redirect("/confirmar-upload")

}catch(err){

console.error(err)
res.status(500).send("Erro ao processar documento")

}

})

app.get("/api/pending-upload",auth,(req,res)=>{

if(!req.session.pendingUpload){
return res.status(404).json({ok:false,erro:"Sem upload pendente"})
}

res.json({ok:true,pending:req.session.pendingUpload})

})

app.post("/api/pending-upload/ocr",auth,async(req,res)=>{

if(!req.session.pendingUpload){
return res.status(404).json({ok:false,erro:"Sem upload pendente"})
}

const pendenteAtual = req.session.pendingUpload
if(!pendenteAtual.ficheiro){
return res.status(400).json({ok:false,erro:"Upload pendente invalido"})
}

if(pendenteAtual.ocrStatus === "processing"){
return res.json({ok:true,processing:true,pending:pendenteAtual})
}

if(pendenteAtual.ocrStatus === "done"){
return res.json({ok:true,processing:false,pending:pendenteAtual})
}

req.session.pendingUpload = {
...pendenteAtual,
ocrStatus:"processing",
ocrFonte:pendenteAtual.ocrFonte || "none"
}

try{

const full = resolverCaminhoUploadSeguro(pendenteAtual.ficheiro)
if(!full){
req.session.pendingUpload = {
...pendenteAtual,
ocrStatus:"failed",
ocrErro:"Documento nao encontrado"
}
return res.status(404).json({ok:false,erro:"Documento nao encontrado",pending:req.session.pendingUpload})
}

	const textoRapido = await extrairTexto(full,{fast:true,allowExternal:false})
	let dados = extrairDadosFatura(textoRapido)
	const dadosQr = await extrairDadosQrDaImagem(full)
	dados = combinarDadosComQr(dados,dadosQr)

	if(!dadosCriticosOk(dados)){
		try{
			const textoCompleto = await Promise.race([
				extrairTexto(full,{fast:false,allowExternal:true}),
				new Promise((resolve)=> setTimeout(()=> resolve(""),16000))
			])

			if(String(textoCompleto || "").trim()){
				let dadosCompletos = extrairDadosFatura(String(textoCompleto || ""))
				dadosCompletos = combinarDadosComQr(dadosCompletos,dadosQr)

				if(qualidadeDadosExtraidos(dadosCompletos) >= qualidadeDadosExtraidos(dados)){
					dados = dadosCompletos
				}
			}
		}catch(errFull){
			console.error("Fallback OCR completo falhou",errFull?.message || errFull)
		}
	}

const userResult = await pool.query(
"SELECT nome,contribuinte FROM users WHERE id=$1",
[req.session.userId]
)
const perfil = userResult.rows[0] || {}
const tipoClassificado = classificarTipoPorEntidade(dados,perfil)

const totalExtraido = Number(dados.valorTotal ?? dados.valor ?? 0)
const ivaExtraido = Number(dados.valorIva ?? 0)
let semIvaExtraido = Number(dados.valorSemIva)

if(!Number.isFinite(semIvaExtraido)){
semIvaExtraido = Math.max(0,totalExtraido - (Number.isFinite(ivaExtraido) ? ivaExtraido : 0))
}

const totalFinal = totalExtraido > 0 ? totalExtraido : Number(pendenteAtual.valorTotal ?? pendenteAtual.valor ?? 0)
const ivaFinal = Number.isFinite(ivaExtraido) && ivaExtraido >= 0 ? ivaExtraido : Number(pendenteAtual.valorIva ?? 0)
const semIvaFinal = Number.isFinite(semIvaExtraido) && semIvaExtraido >= 0
? semIvaExtraido
: Math.max(0,totalFinal - ivaFinal)

const fornecedorFinal =
tipoClassificado === "receita"
? (
	String(dados.cliente || "").trim() ||
	((dados.empresa && dados.empresa !== "desconhecido") ? dados.empresa : (pendenteAtual.fornecedor || ""))
)
: (
	(dados.empresa && dados.empresa !== "desconhecido")
	? dados.empresa
	: (pendenteAtual.fornecedor || "")
)

const dataFinal = dataParaInput(dados.data) || pendenteAtual.data || dataParaInput(new Date())
const nifFinal = dados.nif || pendenteAtual.nif || ""

req.session.pendingUpload = {
...pendenteAtual,
tipo:tipoClassificado || pendenteAtual.tipo || "despesa",
fornecedor:fornecedorFinal,
valor:Math.round(Number(totalFinal || 0) * 100) / 100,
valorTotal:Math.round(Number(totalFinal || 0) * 100) / 100,
valorIva:Math.round(Number(ivaFinal || 0) * 100) / 100,
valorSemIva:Math.round(Number(semIvaFinal || 0) * 100) / 100,
data:dataFinal,
nif:nifFinal,
ocrStatus:"done",
ocrFonte:"async"
}

// Verificar duplicados e anexar informação ao pending para que a UI mostre aviso
try{
	const possible = await encontrarRegistoDuplicado(req.session.userId, (fornecedorFinal||""), dataFinal, totalFinal)
	if(possible){
		req.session.pendingUpload.duplicate = {
			id: possible.id,
			fornecedor: possible.fornecedor,
			data: dataParaInput(possible.data),
			valor: Number(possible.valor_total ?? possible.valor ?? 0)
		}
		req.session.pendingUpload.duplicateDetected = true
	}
}catch(_){ }

return res.json({ok:true,processing:false,pending:req.session.pendingUpload})

}catch(err){
console.error("Erro no OCR assincrono pendente",err)
req.session.pendingUpload = {
...pendenteAtual,
ocrStatus:"failed",
ocrErro:"Falha a extrair dados"
}
return res.status(500).json({ok:false,erro:"Falha a extrair dados",pending:req.session.pendingUpload})
}

})

app.post("/api/confirmar-upload",auth,async(req,res)=>{
try{

	if(!req.session.pendingUpload){
		return res.status(400).json({ok:false,erro:"Sem upload pendente"})
	}

	const pendente = req.session.pendingUpload

	const fornecedor = (req.body.fornecedor || pendente.fornecedor || "desconhecido").trim()
	const tipo = (req.body.tipo || pendente.tipo || "despesa").trim().toLowerCase()==="receita" ? "receita" : "despesa"
	const valorTotal = normalizarValor(req.body.valor ?? pendente.valorTotal ?? pendente.valor)
	const valorIva = normalizarValor(req.body.valorIva ?? pendente.valorIva ?? 0)
	let valorSemIva = normalizarValor(req.body.valorSemIva ?? pendente.valorSemIva)
	const dataFinal = dataParaInput(req.body.data || pendente.data)

	if(Number.isNaN(valorTotal) || valorTotal<=0){
		return res.status(400).json({ok:false,erro:"Valor invalido"})
	}

	const ivaSeguro = Number.isNaN(valorIva) ? 0 : Math.max(0,valorIva)
	if(Number.isNaN(valorSemIva)){
		valorSemIva = Math.max(0,valorTotal - ivaSeguro)
	}

	const totalSeguro = Math.round(Number(valorTotal) * 100) / 100
	const semIvaSeguro = Math.round(Number(valorSemIva) * 100) / 100
	const ivaFinal = Math.round(Number(ivaSeguro) * 100) / 100

	if(!dataFinal){
		return res.status(400).json({ok:false,erro:"Data invalida"})
	}

	const fullConfirmado = resolverCaminhoUploadSeguro(pendente.ficheiro)
	if(!fullConfirmado){
		return res.status(400).json({ok:false,erro:"Documento original nao encontrado. Faz novo upload."})
	}

	const ficheiroConfirmado = path.relative(UPLOADS_DIR,fullConfirmado).replace(/\\/g,"/") || path.basename(fullConfirmado)

	// Verificar duplicados antes de inserir
	const duplicado = await encontrarRegistoDuplicado(req.session.userId, fornecedor, dataFinal, totalSeguro)
	if(duplicado){
		return res.status(409).json({ok:false,erro:"Duplicado detectado",duplicate:duplicado})
	}

	await pool.query(
		`INSERT INTO registos
		(user_id,tipo,fornecedor,valor,valor_sem_iva,valor_iva,valor_total,data,ficheiro)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		[
			req.session.userId,
			tipo,
			fornecedor,
			totalSeguro,
			semIvaSeguro,
			ivaFinal,
			totalSeguro,
			dataFinal,
			ficheiroConfirmado
		]
	)

	req.session.pendingUpload = null

	return res.json({ok:true,redirect:"/dashboard"})

}catch(err){
	// Log detailed context and stack for debugging in Render logs
	try{
		console.error("Erro em /api/confirmar-upload",{
			message: err?.message || String(err),
			stack: err?.stack || null,
			body: typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || ''),
			pending: req.session && req.session.pendingUpload ? JSON.stringify(req.session.pendingUpload) : null
		})
	}catch(_){
		console.error("Erro ao registar erro em /api/confirmar-upload", err)
	}

	return res.status(500).json({ok:false,erro:"Erro interno"})

}
})

app.post("/api/cancelar-upload",auth,(req,res)=>{

if(req.session.pendingUpload && req.session.pendingUpload.ficheiro){
apagarUploadSilencioso(req.session.pendingUpload.ficheiro)
}

req.session.pendingUpload = null

res.json({ok:true,redirect:"/dashboard"})

})

app.get("/api/documento",auth,(req,res)=>{

try{

const ref = req.query.ficheiro
const full = resolverCaminhoUploadSeguro(ref)

if(!full){
return res.status(404).send("Documento nao encontrado")
}

enviarDocumentoSeguro(req,res,full)

}catch(err){
console.error("Erro em /api/documento",err)
res.status(500).send("Erro interno ao abrir documento")
}

})

app.get("/api/registos/:id/documento",auth,async(req,res)=>{

try{

const id = Number(req.params.id)
if(!Number.isInteger(id) || id<=0){
return res.status(400).send("Registo invalido")
}

const result = await pool.query(
"SELECT ficheiro FROM registos WHERE id=$1 AND user_id=$2",
[id,req.session.userId]
)

if(!result.rows.length){
return res.status(404).send("Documento nao encontrado")
}

const ref = result.rows[0].ficheiro
const full = resolverCaminhoUploadSeguro(ref)
if(!full){
return res.status(404).send("Documento nao encontrado")
}

enviarDocumentoSeguro(req,res,full)

}catch(err){
console.error("Erro em /api/registos/:id/documento",err)
res.status(500).send("Erro interno ao abrir documento")
}

})



app.get("/api/registos",auth,async(req,res)=>{

const result = await pool.query(
"SELECT * FROM registos WHERE user_id=$1 ORDER BY data DESC",
[req.session.userId]
)

const enriched = result.rows.map((row)=>{
const full = resolverCaminhoUploadSeguro(row.ficheiro)
return {
...row,
documentoDisponivel:Boolean(full)
}
})

res.json(enriched)

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

const updates = []
const params = []

if(req.body.fornecedor!==undefined){
const fornecedor = String(req.body.fornecedor || "").trim()
if(!fornecedor){
return res.status(400).json({ok:false,erro:"Fornecedor invalido"})
}
params.push(fornecedor)
updates.push(`fornecedor=$${params.length}`)
}

if(req.body.data!==undefined){
const dataNormalizada = dataParaInput(req.body.data)
if(!dataNormalizada){
return res.status(400).json({ok:false,erro:"Data invalida"})
}
params.push(dataNormalizada)
updates.push(`data=$${params.length}`)
}

const incluiCamposValor =
req.body.valor!==undefined ||
req.body.valorTotal!==undefined ||
req.body.valorSemIva!==undefined ||
req.body.valorIva!==undefined ||
req.body.taxaIva!==undefined

if(incluiCamposValor){

const valorTotal = normalizarValor(req.body.valorTotal ?? req.body.valor)
if(Number.isNaN(valorTotal) || valorTotal<=0){
return res.status(400).json({ok:false,erro:"Valor invalido"})
}

let valorSemIva = normalizarValor(req.body.valorSemIva)
let valorIva = normalizarValor(req.body.valorIva)
const taxaIva = normalizarValor(req.body.taxaIva)

if(Number.isNaN(valorSemIva) && Number.isNaN(valorIva)){
if(!Number.isNaN(taxaIva) && taxaIva>=0 && taxaIva<=100){
valorSemIva = valorTotal / (1 + (taxaIva / 100))
valorIva = valorTotal - valorSemIva
}else{
valorSemIva = valorTotal
valorIva = 0
}
}else if(Number.isNaN(valorSemIva)){
valorSemIva = Math.max(0,valorTotal - Math.max(0,valorIva))
}else if(Number.isNaN(valorIva)){
valorIva = Math.max(0,valorTotal - Math.max(0,valorSemIva))
}

const totalSeguro = Math.round(Number(valorTotal) * 100) / 100
const semIvaSeguro = Math.round(Number(valorSemIva) * 100) / 100
const ivaSeguro = Math.round(Math.max(0,totalSeguro - semIvaSeguro) * 100) / 100

params.push(totalSeguro)
updates.push(`valor=$${params.length}`)
params.push(totalSeguro)
updates.push(`valor_total=$${params.length}`)
params.push(semIvaSeguro)
updates.push(`valor_sem_iva=$${params.length}`)
params.push(ivaSeguro)
updates.push(`valor_iva=$${params.length}`)

}

if(!updates.length){
return res.status(400).json({ok:false,erro:"Sem campos para atualizar"})
}

params.push(req.params.id)
params.push(req.session.userId)

const query = `
UPDATE registos
SET ${updates.join(", ")}
WHERE id=$${params.length - 1} AND user_id=$${params.length}
RETURNING *
`

const result = await pool.query(query,params)
if(!result.rows.length){
return res.status(404).json({ok:false,erro:"Registo nao encontrado"})
}

res.json({ok:true,row:result.rows[0]})

})

app.use((err,req,res,next)=>{

if(!err) return next()

console.error("Erro de request",err)

if(err.code === "LIMIT_FILE_SIZE"){
return res.status(400).send("Ficheiro demasiado grande (max 12MB)")
}

if(err.message && /Formato invalido/.test(err.message)){
return res.status(400).send(err.message)
}

return res.status(500).send("Erro interno")

})



app.listen(PORT,()=>{

console.log("Servidor ativo na porta",PORT)

})

// Endpoint para upload OCR rápido a partir do telemóvel (sem autenticação) - apenas para testes
app.options("/api/mobile/ocr-upload",(req,res)=>{
	res.setHeader("Access-Control-Allow-Origin","*")
	res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS")
	res.setHeader("Access-Control-Allow-Headers","Content-Type, x-api-key")
	return res.sendStatus(200)
})

app.post("/api/mobile/ocr-upload", upload.single("file"), async (req,res)=>{
	res.setHeader("Access-Control-Allow-Origin","*")

	// API key protection: if API_KEY is set in env, require it
	try{
		const requiredKey = process.env.API_KEY
		if(requiredKey){
			const provided = (req.headers['x-api-key'] || req.query.api_key || (req.headers.authorization || '').split(' ')[1] || '').trim()
			if(!provided || provided !== requiredKey){
				return res.status(401).json({ok:false,erro:"API_KEY inválida ou em falta"})
			}
		}
	}catch(e){
		console.warn('Erro ao verificar API_KEY',e?.message||e)
		return res.status(500).json({ok:false,erro:'Erro interno ao validar API_KEY'})
	}

	try{
		if(!req.file || !req.file.path){
			return res.status(400).json({ok:false,erro:"Ficheiro em falta"})
		}

		const full = req.file.path

		// Extrai texto e dados (usa o pipeline existente)
		const texto = await extrairTexto(full,{fast:false,allowExternal:true})
		let dados = extrairDadosFatura(String(texto || ""))
		const dadosQr = await extrairDadosQrDaImagem(full)
		dados = combinarDadosComQr(dados,dadosQr)

		const resultado = {
			fornecedor: dados.empresa || dados.cliente || "",
			nif: dados.nif || "",
			valor: Number(dados.valorTotal ?? dados.valor ?? 0),
			valorIva: Number(dados.valorIva ?? 0),
			valorSemIva: Number(dados.valorSemIva ?? 0),
			data: dataParaInput(dados.data) || "",
			ficheiro: path.relative(UPLOADS_DIR, full).replace(/\\/g, "/"),
			ocr_text: String(texto || "")
		}

		return res.json({ok:true,resultado})

	}catch(err){
		console.error("Erro em /api/mobile/ocr-upload",err?.message || err)
		return res.status(500).json({ok:false,erro:"Falha ao processar documento"})
	}

})

// Visualizador simples que embebe o documento servido por /api/documento
app.get("/visualizador",auth,(req,res)=>{
	try{
		const ref = String(req.query.ficheiro || "").trim()
		if(!ref) return res.status(400).send("Ficheiro nao indicado")

		const ficheiro = encodeURIComponent(ref)
		const url = `/api/documento?ficheiro=${ficheiro}`

		return res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visualizador</title>
<style>html,body{height:100%;margin:0;background:#111;color:#fff;font-family:Arial,Helvetica,sans-serif} .top{padding:10px;background:#0b1220;display:flex;gap:8px;align-items:center} .btn{background:#1f2937;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none} .center{display:flex;align-items:center;justify-content:center;height:calc(100% - 48px);padding:8px}</style>
</head>
<body>
<div class="top"><a class="btn" href="/confirmar-upload">Voltar</a><a id="downloadBtn" class="btn" href="${url}&download=1">Descarregar</a><div style="flex:1"></div></div>
<div id="container" class="center">A carregar documento...</div>
<script>
	(async function(){
		try{
			const res = await fetch('${url}', { credentials: 'same-origin' })
			if(!res.ok){
				document.getElementById('container').textContent = 'Erro ao abrir documento'
				return
			}
			const contentType = res.headers.get('content-type') || ''
			const blob = await res.blob()
			const blobUrl = URL.createObjectURL(blob)
			const container = document.getElementById('container')
			container.innerHTML = ''
			if(contentType.startsWith('image/')){
				const img = document.createElement('img')
				img.src = blobUrl
				img.style.maxWidth = '100%'
				img.style.height = 'auto'
				img.alt = 'Documento'
				container.appendChild(img)
			}else if(contentType === 'application/pdf'){
				const iframe = document.createElement('iframe')
				iframe.src = blobUrl
				iframe.style.width = '100%'
				iframe.style.height = '100%'
				iframe.style.border = '0'
				container.appendChild(iframe)
			}else{
				// Fallback: abrir em nova aba usando blob URL
				window.location.href = blobUrl
			}
			// Atualizar o botão de descarregar para apontar ao blob (mantemos opção server-side também)
			const dl = document.getElementById('downloadBtn')
			if(dl){ dl.href = '${url}&download=1' }
		}catch(err){
			console.error('Visualizador erro',err)
			document.getElementById('container').textContent = 'Erro ao carregar documento'
		}
	})()
</script>
</body>
</html>`)
	}catch(err){
		console.error("Erro em /visualizador",err)
		return res.status(500).send("Erro interno")
	}
})


app.get('/api/export', auth, async (req, res) => {
	try{
		const userId = req.session.userId
		const format = String(req.query.format || 'csv').toLowerCase() // 'csv' or 'pdf' or 'excel'
		const tipoFilter = String(req.query.tipo || '').toLowerCase() // 'receita' or 'despesa' or '' for both

		const limitRaw = parseInt(req.query.limit || '0')
		const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0

		const buildQuery = (tipo) => {
			const base = `SELECT data, fornecedor, valor_sem_iva, valor_iva, COALESCE(valor_total,valor) as total FROM registos WHERE user_id=$1 AND tipo='${tipo}' ORDER BY data DESC`
			if(limit){
				// add parameterized LIMIT
				return { text: base + ` LIMIT $2`, params: [userId, limit] }
			}
			return { text: base, params: [userId] }
		}

		const receitasQ = buildQuery('receita')
		const despesasQ = buildQuery('despesa')

		const receitasRes = tipoFilter === 'despesa' ? { rows: [] } : await pool.query(receitasQ.text, receitasQ.params)
		const despesasRes = tipoFilter === 'receita' ? { rows: [] } : await pool.query(despesasQ.text, despesasQ.params)

		const fmtDate = (d) => {
			if(!d) return ''
			const dt = new Date(d)
			if(Number.isNaN(dt.getTime())) return String(d)
			const dd = String(dt.getDate()).padStart(2,'0')
			const mm = String(dt.getMonth()+1).padStart(2,'0')
			const yy = String(dt.getFullYear())
			return `${dd}/${mm}/${yy}`
		}

		const logoPath = path.join(__dirname, 'public', 'logo.png')

		// Helper: render a single section as CSV lines
		const sectionToCsvLines = (title, rows) => {
			const lines = []
			lines.push(title)
			lines.push('Data,Cliente/Fornecedor,Valor Sem IVA,IVA,Total')
			for(const r of rows){
				const data = fmtDate(r.data)
				const fornecedor = (r.fornecedor||'').replace(/"/g,'""')
				const sem = Number(r.valor_sem_iva||0).toFixed(2)
				const iva = Number(r.valor_iva||0).toFixed(2)
				const total = Number(r.total||0).toFixed(2)
				lines.push(`"${data}","${fornecedor}","${sem}","${iva}","${total}"`)
			}
			return lines
		}

		if(format === 'excel' || format === 'xlsx'){
			// Generate real XLSX workbook with vertical and transposed sheets
			const ExcelJS = require('exceljs')
			const workbook = new ExcelJS.Workbook()

			const makeSheetsFor = (title, rows) => {
				console.log('makeSheetsFor start', {title, rowsLength: Array.isArray(rows) ? rows.length : 0})
				// keep numeric values as numbers so Excel formats them correctly
				const sheetRows = rows.map(r => [fmtDate(r.data), String(r.fornecedor||''), Number(r.valor_sem_iva||0), Number(r.valor_iva||0), Number(r.total||0)])
				const headers = ['Data','Cliente/Fornecedor','Valor Sem IVA','IVA','Total']

				// Rows-style sheet
				const sheet = workbook.addWorksheet(`${title} (Rows)`, {views:[{state:'frozen',ySplit:1}]})
				sheet.addRow(headers)
				sheetRows.forEach(r => sheet.addRow(r))
				// columns styling (consistent across Receitas/Despesas)
				sheet.columns = [ {width:12},{width:40},{width:16},{width:12},{width:14} ]
				// header style
				const headerRow = sheet.getRow(1)
				headerRow.font = {bold:true}
				headerRow.alignment = {vertical:'middle', horizontal:'center'}
				try{
					headerRow.eachCell((cell)=>{
						cell.fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FF1E293B'} }
						cell.font = {bold:true, color:{argb:'FFFFFFFF'}}
						cell.border = {top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'}}
					})
				}catch(err){
					console.error('headerRow.eachCell error', {title, err: String(err)})
				}
				// enforce column-level number formats and alignment
				['3','4','5'].forEach((idx)=>{
					const col = sheet.getColumn(parseInt(idx,10))
					col.numFmt = '#,##0.00 €'
					col.alignment = {horizontal:'right'}
				})
				sheet.autoFilter = { from: 'A1', to: 'E1' }

				// apply borders to data rows
				for(let r=2;r<=sheet.rowCount;r++){
					const row = sheet.getRow(r)
					row.eachCell((cell)=>{
						cell.border = {top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'}}
					})
				}

				// add totals row (consistent)
				if(sheet.rowCount >= 2){
					console.log('makeSheetsFor sums', {sheetRowCount: sheet.rowCount, sheetRowsLength: sheetRows.length})
					let sumSem = 0, sumIva = 0, sumTot = 0
					for(let r=2;r<=sheet.rowCount;r++){
						try{
							const rowObj = sheet.getRow(r)
							const semCell = rowObj && rowObj.getCell ? rowObj.getCell(3) : null
							const ivaCell = rowObj && rowObj.getCell ? rowObj.getCell(4) : null
							const totCell = rowObj && rowObj.getCell ? rowObj.getCell(5) : null
							const sem = semCell && semCell.value !== undefined ? Number(semCell.value || 0) : 0
							const iva = ivaCell && ivaCell.value !== undefined ? Number(ivaCell.value || 0) : 0
							const tot = totCell && totCell.value !== undefined ? Number(totCell.value || 0) : 0
							sumSem += Number.isFinite(sem) ? sem : 0
							sumIva += Number.isFinite(iva) ? iva : 0
							sumTot += Number.isFinite(tot) ? tot : 0
						}catch(_){ /* ignore malformed rows */ }
					}
					const tr = sheet.addRow([ '', 'Totais', sumSem, sumIva, sumTot ])
					tr.eachCell((cell)=>{
						cell.font = {bold:true}
						cell.fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFF3F4F6'} }
						cell.border = {top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'}}
					})
				}

				// (transposed sheet removed to avoid layout/runtime edge-cases)
			}

			if(tipoFilter === 'receita' || tipoFilter === '') makeSheetsFor('Receitas', receitasRes.rows)
			if(tipoFilter === 'despesa' || tipoFilter === '') makeSheetsFor('Despesas', despesasRes.rows)

			const filename = `export-${tipoFilter || 'all'}-${(new Date()).toISOString().slice(0,10)}.xlsx`
			res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
			res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
			await workbook.xlsx.write(res)
			res.end()
			return
		}

		if(format === 'csv'){
			// If a specific tipo was requested, return only that section as a standalone file
			if(tipoFilter === 'receita' || tipoFilter === 'despesa'){
				const rows = tipoFilter === 'receita' ? receitasRes.rows : despesasRes.rows
				const lines = sectionToCsvLines(tipoFilter === 'receita' ? 'Receitas' : 'Despesas', rows)
				const filename = `export-${tipoFilter}-${(new Date()).toISOString().slice(0,10)}.csv`
				res.setHeader('Content-Type','text/csv; charset=utf-8')
				res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
				return res.send(lines.join('\n'))
			}

			// default: both sections in a single CSV
			let lines = []
			lines = lines.concat(sectionToCsvLines('Receitas', receitasRes.rows))
			lines.push('')
			lines = lines.concat(sectionToCsvLines('Despesas', despesasRes.rows))
			const filename = `export-${(new Date()).toISOString().slice(0,10)}.csv`
			res.setHeader('Content-Type','text/csv; charset=utf-8')
			res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
			return res.send(lines.join('\n'))
		}

		if(format === 'pdf'){
			const doc = new PDFDocument({margin:40, size:'A4'})
			const filenameBase = tipoFilter ? `export-${tipoFilter}` : `export`
			const filename = `${filenameBase}-${(new Date()).toISOString().slice(0,10)}.pdf`
			res.setHeader('Content-Type','application/pdf')
			res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
			doc.pipe(res)

			// compute column positions dynamically based on page margins and content width
			const computeColPositions = () => {
				const left = doc.page.margins && doc.page.margins.left ? doc.page.margins.left : 36
				const right = doc.page.margins && doc.page.margins.right ? doc.page.margins.right : 36
				const contentWidth = doc.page.width - left - right
				// relative widths: Data ~18%, Cliente ~40%, SemIVA ~16%, IVA ~12%, Total ~14%
				const rel = [0.18, 0.40, 0.16, 0.12, 0.14]
				const positions = []
				let x = left
				for(let i=0;i<rel.length;i++){
					positions.push(x)
					const w = Math.round(contentWidth * rel[i])
					x += w
				}
				return { positions, left, right, contentWidth, rel }
			}

			const addHeader = (title) => {
				try{
					if(fs.existsSync(logoPath)){
						// place logo at top-left
						doc.image(logoPath, 40, 40, {width:80})
					}
				}catch(_){ }
				// simple, light header: title centred, dark text, no dark background
				doc.fillColor('#0F172A')
				doc.fontSize(18).font('Helvetica-Bold').text(title, 0, 50, {align:'center'})
				doc.moveDown(1)
			}

			// draw a table with fixed columns and row height; returns next y
			const renderTable = (startY, headers, rows) => {
				let y = startY
				const rowHeight = 20
				doc.fontSize(10)
				// compute dynamic positions
				const colInfo = computeColPositions()
				const colPositionsLocal = colInfo.positions
				const leftPad = colInfo.left
				const contentW = colInfo.contentWidth

				// header background (light)
				const headerH = 22
				doc.save()
				doc.rect(leftPad - 4, y-6, contentW + 8, headerH).fill('#F3F4F6')
				doc.fillColor('#0F172A')
				doc.font('Helvetica-Bold')
				for(let i=0;i<headers.length;i++){
					doc.text(headers[i], colPositionsLocal[i], y)
				}
				doc.restore()
				y += headerH
				doc.font('Helvetica')

				// draw vertical separators (subtle) at column boundaries
				for(let i=0;i<colPositionsLocal.length;i++){
					const x = colPositionsLocal[i]
					doc.save()
					doc.moveTo(x - 6, startY - 6).lineTo(x - 6, doc.page.height - 60).strokeColor('#E6E7EB').lineWidth(0.5).stroke()
					doc.restore()
				}

				for(const r of rows){
					if(y > doc.page.height - 80){ doc.addPage(); y = 60; }
					// Data
					const dataWidth = Math.round(contentW * colInfo.rel[0])
					doc.text(fmtDate(r.data), colPositionsLocal[0], y, {width: dataWidth})
					// Cliente (wrap within width)
					const clienteWidth = Math.round(contentW * colInfo.rel[1])
					const clienteBoxHeight = doc.heightOfString(String(r.fornecedor||''), {width: clienteWidth, align:'left'})
					doc.text(String(r.fornecedor||''), colPositionsLocal[1], y, {width: clienteWidth})
					// numeric columns: use monospaced font for perfect decimal alignment
					const semVal = Number(r.valor_sem_iva||0)
					const ivaVal = Number(r.valor_iva||0)
					const totVal = Number(r.total||0)
					const semFmt = semVal.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					const ivaFmt = ivaVal.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					const totFmt = totVal.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					// switch to monospaced font for numbers
					doc.font('Courier').fontSize(10)
					const semWidth = Math.round(contentW * colInfo.rel[2])
					const ivaWidth = Math.round(contentW * colInfo.rel[3])
					const totWidth = Math.round(contentW * colInfo.rel[4])
					doc.text(semFmt, colPositionsLocal[2], y, {width: semWidth - 6, align:'right'})
					doc.text(ivaFmt, colPositionsLocal[3], y, {width: ivaWidth - 6, align:'right'})
					// Total: right-aligned within its column
					doc.font('Courier').fontSize(9)
					doc.text(totFmt, colPositionsLocal[4], y, {width: totWidth - 6, align:'right'})
					// restore font for next line
					doc.font('Helvetica').fontSize(10)
					// separator line
					doc.moveTo(leftPad - 4, y + rowHeight - 6).lineTo(leftPad - 4 + contentW + 8, y + rowHeight - 6).strokeColor('#E6E7EB').stroke()
					// advance y by max of rowHeight and clienteBoxHeight
					y += Math.max(rowHeight, clienteBoxHeight + 6)
				}
				// after rows, render totals row with light background and bold numbers
				let sumSem = 0, sumIva = 0, sumTot = 0
				for(const rr of rows){
					sumSem += Number(rr.valor_sem_iva || 0)
					sumIva += Number(rr.valor_iva || 0)
					sumTot += Number(rr.total || rr.valor || 0)
				}
				if(rows.length){
					// totals background
					const totalsH = 20
					doc.save()
					doc.rect(leftPad - 4, y-6, contentW + 8, totalsH).fill('#F3F4F6')
					doc.fillColor('#0F172A')
					doc.font('Helvetica-Bold')
					doc.text('Totais', colPositionsLocal[1], y)
					// totals values in monospaced, right-aligned within their columns
					const semFmt = sumSem.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					const ivaFmt = sumIva.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					const totFmt = sumTot.toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2})
					doc.font('Courier').fontSize(10)
					doc.text(semFmt, colPositionsLocal[2], y, {width: Math.round(contentW * colInfo.rel[2]) - 6, align:'right'})
					doc.text(ivaFmt, colPositionsLocal[3], y, {width: Math.round(contentW * colInfo.rel[3]) - 6, align:'right'})
					doc.text(totFmt, colPositionsLocal[4], y, {width: Math.round(contentW * colInfo.rel[4]) - 6, align:'right'})
					doc.restore()
					y += totalsH + 8
				}
				return y + 8
			}

			// Render flow
			addHeader('Export - Registos')
			let y = 80
			if(tipoFilter === 'receita' || tipoFilter === ''){
				doc.fontSize(16).font('Helvetica-Bold').text('Receitas', 40, y)
				y += 22
				y = renderTable(y, ['Data','Cliente/Fornecedor','Valor Sem IVA','IVA','Total'], receitasRes.rows)
			}
			if(tipoFilter === 'despesa' || tipoFilter === ''){
				if(y > doc.page.height - 120){ doc.addPage(); y = 60 }
				doc.fontSize(16).font('Helvetica-Bold').text('Despesas', 40, y)
				y += 22
				renderTable(y, ['Data','Cliente/Fornecedor','Valor Sem IVA','IVA','Total'], despesasRes.rows)
			}

			doc.end()
			return
		}

		return res.status(400).json({error:'Formato inválido'})

	}catch(err){
		console.error('Erro em /api/export',err)
		res.status(500).send('Erro interno')
	}
})