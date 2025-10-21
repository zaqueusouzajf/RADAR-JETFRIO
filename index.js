import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Aplica o plugin Stealth para tornar o Puppeteer menos detectável
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;

// Função de delay para aguardar um tempo específico
const delay = (ms) => new Promise(res => setTimeout(res, ms));

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
        // Lança o navegador configurado para usar o proxy do ScraperAPI
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                `--proxy-server=http://proxy.scraperapi.com:8001`
            ],
        });

        const page = await browser.newPage();
        
        // Autentica no proxy do ScraperAPI
        await page.authenticate({
            username: scraperApiKey,
            password: '' 
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

        // Garante que a URL é absoluta
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
            html: null // HTML não disponível em erros de conexão/timeout
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
