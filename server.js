const express = require("express");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(session({
    secret: "segredo_simples",
    resave: false,
    saveUninitialized: false
}));

// ================= BASE DADOS =================

const dataFile = path.join(__dirname, "data.json");

if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([]));
}

function readData() {
    return JSON.parse(fs.readFileSync(dataFile));
}

function saveData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// ================= EXTRAÇÃO =================

function extractDate(text) {
    const regex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/g;
    const match = text.match(regex);
    return match ? match[0] : "";
}

function extractValue(text) {
    const regex = /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/g;
    const matches = text.match(regex);
    if (!matches) return "";

    let values = matches.map(v =>
        parseFloat(v.replace(/\./g, "").replace(",", "."))
    ).filter(v => !isNaN(v));

    if (values.length === 0) return "";
    return Math.max(...values).toFixed(2);
}

// ================= LOGIN =================

const users = [
    { username: "admin", password: bcrypt.hashSync("1234", 10) }
];

app.get("/", (req, res) => {

   (!req.session.user) {
 return res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body {
    margin:0;
    font-family:Arial;
    background:#0f172a;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
    color:white;
}

.box {
    width:90%;
    max-width:400px;
    background:#1e293b;
    padding:30px;
    border-radius:20px;
    text-align:center;
}

input {
    width:100%;
    padding:15px;
    margin-top:15px;
    font-size:18px;
    border-radius:10px;
    border:none;
}

button {
    width:100%;
    padding:15px;
    margin-top:20px;
    font-size:18px;
    border-radius:12px;
    border:none;
    background:#16a34a;
    color:white;
    font-weight:bold;
}

img {
    max-width:120px;
    margin-bottom:20px;
}
</style>
</head>

<body>
<div class="box">
    <img src="/logo.png">
    <form method="POST" action="/login">
        <input name="username" placeholder="Utilizador" required>
        <input type="password" name="password" placeholder="Password" required>
        <button>Entrar</button>
    </form>
</div>
</body>
</html>
`);

}

    const registos = readData();

    const agora = new Date();
    const mesAtual = agora.getMonth() + 1;
    const anoAtual = agora.getFullYear();

    let receitasMes = 0;
    let despesasMes = 0;

    registos.forEach(r => {
        if (!r.data) return;

        const partes = r.data.replace(/-/g,"/").split("/");
        let ano = partes[2] || partes[0];
        let mes = partes[1];

        if (parseInt(ano) === anoAtual && parseInt(mes) === mesAtual) {
            if (r.tipo === "Receita") receitasMes += r.valor;
            if (r.tipo === "Despesa") despesasMes += r.valor;
        }
    });

    const resultado = receitasMes - despesasMes;
    const corResultado = resultado >= 0 ? "#16a34a" : "#dc2626";

    res.send(`
    <html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body { font-family:Arial; background:#0f172a; color:white; padding:20px; }
    .card { background:#1e293b; padding:25px; border-radius:15px; max-width:650px; margin:auto; }
    .topo { display:flex; justify-content:space-between; margin-bottom:20px; }
    .box { flex:1; margin:5px; padding:15px; border-radius:12px; text-align:center; }
    .receita { background:#14532d; }
    .despesa { background:#7f1d1d; }
    .resultado { background:${corResultado}; font-weight:bold; }
    input, select { width:100%; padding:12px; margin-top:10px; border-radius:8px; border:none; }
    button { width:100%; padding:14px; margin-top:15px; border-radius:10px; border:none; font-weight:bold; cursor:pointer; }
    .save { background:#16a34a; color:white; }
    .report { background:#2563eb; color:white; }
    .logout { background:#dc2626; color:white; }
    img { max-width:130px; display:block; margin:auto; margin-bottom:20px; }
    </style>
    </head>
    <body>

    <div class="card">
    <img src="/logo.png">

    <div class="topo">
        <div class="box receita">
            <h4>Receitas Mês</h4>
            ${receitasMes.toFixed(2)} €
        </div>
        <div class="box despesa">
            <h4>Despesas Mês</h4>
            ${despesasMes.toFixed(2)} €
        </div>
        <div class="box resultado">
            <h4>Resultado</h4>
            ${resultado.toFixed(2)} €
        </div>
    </div>

    <h3>Novo Registo</h3>

    <form method="POST" action="/analisar" enctype="multipart/form-data">
    <select name="tipo" required>
        <option value="">Selecionar Tipo</option>
        <option value="Despesa">Despesa</option>
        <option value="Receita">Receita</option>
    </select>

    <input type="text" name="fornecedor" placeholder="Fornecedor" required>

    <input type="file" name="ficheiro" accept="image/*,application/pdf" capture="environment" required>

    <button class="save">Analisar Documento</button>
    </form>

    <a href="/relatorio"><button class="report">Ver Relatório</button></a>
    <a href="/logout"><button class="logout">Sair</button></a>

    </div>
    </body>
    </html>
    `);
});

// ================= LOGIN POST =================

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = username;
        return res.redirect("/");
    }
    res.send("Login inválido");
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ================= ANALISAR =================

const upload = multer({ dest: "temp/" });

app.post("/analisar", upload.single("ficheiro"), async (req, res) => {

    const filePath = req.file.path;
    let text = "";

    try {
        if (req.file.mimetype === "application/pdf") {
            const buffer = fs.readFileSync(filePath);
            const pdf = await pdfParse(buffer);
            text = pdf.text;
        } else {
            const result = await Tesseract.recognize(filePath, "eng");
            text = result.data.text;
        }
    } catch (err) {
        console.log(err);
    }

    const detectedDate = extractDate(text);
    const detectedValue = extractValue(text);

    res.send(`
    <html>
    <body style="font-family:Arial;padding:20px;text-align:center;">
    <h2>Confirmar Dados</h2>

    <form method="POST" action="/guardar">

    <input type="hidden" name="tempPath" value="${filePath}">
    <input type="hidden" name="originalName" value="${req.file.originalname}">
    <input type="hidden" name="tipo" value="${req.body.tipo}">
    <input type="hidden" name="fornecedor" value="${req.body.fornecedor}">

    <p>Data:</p>
    <input name="data" value="${detectedDate}"><br><br>

    <p>Valor (€):</p>
    <input name="valor" value="${detectedValue}"><br><br>

    <button>Confirmar e Guardar</button>

    </form>
    </body>
    </html>
    `);
});

// ================= GUARDAR =================

app.post("/guardar", (req, res) => {

    let saveDir;

    if (req.body.data) {
        const partes = req.body.data.replace(/-/g,"/").split("/");
        const year = partes[2] || partes[0];
        const month = partes[1];
        saveDir = path.join("uploads", year, month);
    } else {
        saveDir = path.join("uploads", "sem_data");
    }

    fs.mkdirSync(saveDir, { recursive: true });

    const newPath = path.join(saveDir, req.body.originalName);
    fs.renameSync(req.body.tempPath, newPath);

    const registos = readData();

    registos.push({
        tipo: req.body.tipo,
        fornecedor: req.body.fornecedor,
        valor: parseFloat(req.body.valor),
        data: req.body.data,
        ficheiro: "/" + newPath.replace(/\\/g, "/")
    });

    saveData(registos);

    res.redirect("/");
});

// ================= RELATÓRIO =================

res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body {
    font-family: Arial;
    padding: 15px;
    background: #0f172a;
    color: white;
}

h2 {
    text-align: center;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 15px;
    font-size: 18px;
}

th, td {
    padding: 16px;
    border: 1px solid #334155;
    text-align: left;
}

button {
    font-size: 18px;
    padding: 16px;
}
th {
    background: #1e293b;
}

a {
    color: #60a5fa;
}

button {
    width: 100%;
    padding: 14px;
    margin-top: 20px;
    border-radius: 10px;
    border: none;
    background: #2563eb;
    color: white;
    font-weight: bold;
}

/* MOBILE */
@media (max-width: 768px) {

    table, thead, tbody, th, td, tr {
        display: block;
    }

    tr {
        margin-bottom: 15px;
        background: #1e293b;
        padding: 10px;
        border-radius: 12px;
    }

    th {
        display: none;
    }

    td {
        border: none;
        padding: 6px 0;
    }

    td:before {
        font-weight: bold;
        display: block;
    }
}
</style>
</head>

<body>
<h2>Relatório</h2>

<table>
<tr>
    <th>Tipo</th>
    <th>Fornecedor</th>
    <th>Valor</th>
    <th>Data</th>
    <th>Documento</th>
</tr>
${lista}
</table>

<a href="/"><button>Voltar</button></a>

</body>
</html>
`):

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.listen(PORT, () => {
    console.log("Servidor a correr em http://localhost:3000");
});