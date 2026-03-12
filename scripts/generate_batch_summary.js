const fs = require('fs');
const path = require('path');

const inPath = path.join(process.cwd(), 'batch_ocr_results.json');
const outCsv = path.join(process.cwd(), 'batch_ocr_results.csv');
const summaryJson = path.join(process.cwd(), 'batch_ocr_summary.json');
const summaryMd = path.join(process.cwd(), 'batch_ocr_summary.md');

if (!fs.existsSync(inPath)) {
  console.error('Input file not found:', inPath);
  process.exit(1);
}

const raw = fs.readFileSync(inPath, 'utf8');
const data = JSON.parse(raw);
const results = data.results || [];

const summary = {
  target: data.target || null,
  runAt: data.runAt || null,
  total: results.length,
  success: 0,
  fail: 0,
  missingNif: 0,
  missingDate: 0,
  totalValorCount: 0,
  totalValorSum: 0,
  minValor: null,
  maxValor: null
};

const csvLines = [
  'file,status,fornecedor,nif,valor,valorIva,valorSemIva,data,ficheiro,ocr_text_preview'
];

for (const r of results) {
  const status = r.status || (r.body && r.body.status) || 0;
  if (status === 200) summary.success++;
  else summary.fail++;

  const resultado = r.body && r.body.resultado ? r.body.resultado : {};
  const nif = resultado.nif || '';
  const dataField = resultado.data || '';

  if (!nif || nif === '') summary.missingNif++;
  if (!dataField || dataField === '') summary.missingDate++;

  const valor = Number(resultado.valor || 0);
  if (!isNaN(valor) && valor !== 0) {
    summary.totalValorCount++;
    summary.totalValorSum += valor;
    if (summary.minValor === null || valor < summary.minValor) summary.minValor = valor;
    if (summary.maxValor === null || valor > summary.maxValor) summary.maxValor = valor;
  }

  const ocrText = (resultado.ocr_text || '').replace(/\s+/g, ' ').slice(0, 120).replace(/"/g, "'");

  const row = [
    '"' + (r.file || '') + '"',
    status,
    '"' + (resultado.fornecedor || '').replace(/"/g, "'") + '"',
    '"' + nif + '"',
    valor,
    Number(resultado.valorIva || 0),
    Number(resultado.valorSemIva || 0),
    '"' + dataField + '"',
    '"' + (resultado.ficheiro || '') + '"',
    '"' + ocrText + '"'
  ].join(',');

  csvLines.push(row);
}

summary.successRate = summary.total === 0 ? 0 : (summary.success / summary.total) * 100;
summary.meanValor = summary.totalValorCount === 0 ? 0 : summary.totalValorSum / summary.totalValorCount;

// Write CSV
fs.writeFileSync(outCsv, csvLines.join('\n'), 'utf8');
// Write JSON summary
fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2), 'utf8');

// Write human markdown summary
const md = [];
md.push('# Batch OCR Summary');
md.push('');
md.push(`- Target: ${summary.target}`);
md.push(`- Run at: ${summary.runAt}`);
md.push(`- Total files: ${summary.total}`);
md.push(`- Success: ${summary.success}`);
md.push(`- Fail: ${summary.fail}`);
md.push(`- Success rate: ${summary.successRate.toFixed(2)}%`);
md.push(`- Files with missing NIF: ${summary.missingNif}`);
md.push(`- Files with missing date: ${summary.missingDate}`);
md.push(`- Values counted: ${summary.totalValorCount}`);
md.push(`- Sum of values: ${summary.totalValorSum}`);
md.push(`- Mean value: ${summary.meanValor.toFixed(2)}`);
md.push(`- Min value: ${summary.minValor === null ? 0 : summary.minValor}`);
md.push(`- Max value: ${summary.maxValor === null ? 0 : summary.maxValor}`);

fs.writeFileSync(summaryMd, md.join('\n'), 'utf8');

console.log('Wrote:', outCsv);
console.log('Wrote:', summaryJson);
console.log('Wrote:', summaryMd);
