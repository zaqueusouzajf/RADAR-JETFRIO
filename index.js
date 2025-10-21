import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;

app.post('/api/scrape', async (req, res) => {
    const {
        searchTerm,
        secondarySearchTerm,
        searchUrl,
        productLinkSelector,
        productPriceSelector,
        scraperApiKey,
    } = req.body;

    if (!searchUrl || !productLinkSelector || !productPriceSelector || !scraperApiKey) {
        return res.status(400).json({ status: 'error', message: 'Parâmetros essenciais ausentes (incluindo scraperApiKey).' });
    }

    const primaryTerm = secondarySearchTerm || searchTerm;
    if (!primaryTerm) {
        return res.status(400).json({ status: 'error', message: 'Nenhum termo de busca fornecido.' });
    }
    
    const finalSearchUrl = searchUrl
        .replace('${produtoBusca}', encodeURIComponent(primaryTerm))
        .replace('${codigoFabricante}', encodeURIComponent(primaryTerm));

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/google-chrome-stable', // Caminho no Docker
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
                `--proxy-server=http://proxy.scraperapi.com:8001`
            ],
        });

        const page = await browser.newPage();
        
        await page.authenticate({
            username: scraperApiKey,
            password: '' 
        });

        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36'
        });

        await page.goto(finalSearchUrl, { waitUntil: 'networkidle2', timeout: 120000 });

        let pageContent = await page.content();
        if (pageContent.toLowerCase().includes('captcha') || pageContent.toLowerCase().includes('challenge')) {
            throw new Error('Acesso bloqueado por CAPTCHA na página de busca.');
        }

        const productUrl = await page.evaluate((selector) => {
            const linkElement = document.querySelector(selector);
            return linkElement ? linkElement.href : null;
        }, productLinkSelector);
        
        if (!productUrl) {
            return res.status(200).json({
                status: 'not_found',
                message: 'Seletor de link do produto não encontrou correspondência.',
                price: null,
                productUrl: finalSearchUrl,
                html: await page.content(),
            });
        }
        
        const absoluteProductUrl = new URL(productUrl, finalSearchUrl).toString();

        await page.goto(absoluteProductUrl, { waitUntil: 'networkidle2', timeout: 120000 });
        
        pageContent = await page.content();
         if (pageContent.toLowerCase().includes('captcha') || pageContent.toLowerCase().includes('challenge')) {
            throw new Error('Acesso bloqueado por CAPTCHA na página do produto.');
        }

        const priceText = await page.evaluate((selector) => {
            const priceElement = document.querySelector(selector);
            return priceElement ? priceElement.innerText : null;
        }, productPriceSelector);

        if (!priceText) {
             return res.status(200).json({
                status: 'price_not_found',
                message: 'Seletor de preço não encontrou correspondência na página do produto.',
                price: null,
                productUrl: absoluteProductUrl,
                html: await page.content(),
            });
        }
        
        const price = parseFloat(priceText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());

        if (isNaN(price)) {
            return res.status(200).json({
                status: 'price_not_found',
                message: `Não foi possível converter o preço extraído ('${priceText}') para um número.`,
                price: null,
                productUrl: absoluteProductUrl,
                html: await page.content(),
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Preço extraído com sucesso.',
            price: price,
            productUrl: absoluteProductUrl,
            html: null,
        });

    } catch (error) {
        console.error('Erro durante o processo de scraping com Puppeteer:', error.message);
        return res.status(500).json({
            status: 'error',
            message: error.message || 'Erro desconhecido durante o scraping.',
            price: null,
            productUrl: finalSearchUrl,
            html: null
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Puppeteer scraper service is running on port ${PORT}`);
});
