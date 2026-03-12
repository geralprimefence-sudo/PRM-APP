const puppeteer = require('puppeteer')
const fs = require('fs')

;(async ()=>{
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']})
  const page = await browser.newPage()
  page.setViewport({width:1200,height:900})

  // Go to login
  await page.goto('http://localhost:3000/login', {waitUntil:'networkidle2'})

  // Fill credentials and submit (page has JS handler)
  await page.type('#usernameInput','admin')
  await page.type('#passwordInput','admin123')
  await page.click('#loginForm button[type=submit]')

  // Wait for dashboard
  await page.waitForNavigation({waitUntil:'networkidle2', timeout: 10000}).catch(()=>{})

  // Ensure dashboard loaded
  await page.goto('http://localhost:3000/dashboard', {waitUntil:'networkidle2'})

  // Open export modal via page function
  await page.evaluate(()=>{
    if(window.openExportModal) window.openExportModal()
    else {
      const m = document.getElementById('exportModal')
      if(m) m.style.display = 'flex'
    }
  })

  // Wait a bit for modal render
  await new Promise((r)=>setTimeout(r,600))

  // Select modal content element
  const modal = await page.$('#exportModal > div')
  const outDir = 'screenshots'
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir)
  const outPath = `${outDir}/export-modal.png`
  if(modal){
    await modal.screenshot({path: outPath})
    console.log('Saved', outPath)
  }else{
    // fallback full page screenshot
    await page.screenshot({path: outPath, fullPage:false})
    console.log('Saved full page', outPath)
  }

  await browser.close()
})().catch(e=>{ console.error(e); process.exit(1) })
