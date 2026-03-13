const https = require('https');
const key = 'rnd_XTyPWHLxiwqOrpGJCvScVFJgOkyK';
const serviceId = 'srv-d6jks29aae7s73el0n5g';
const data = JSON.stringify({ clearCache: true });

const options = {
  hostname: 'api.render.com',
  path: `/v1/services/${serviceId}/deploys`,
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  console.log('HTTPSTATUS', res.statusCode);
  console.log('HEADERS', JSON.stringify(res.headers));
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('BODY', body);
  });
});

req.on('error', (e) => {
  console.error('REQUEST_ERROR', e.message);
});

req.write(data);
req.end();
