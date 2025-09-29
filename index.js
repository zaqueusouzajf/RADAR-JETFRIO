
import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const parsePrice = (priceStr) => {
    if (!priceStr) return null;
    // Tenta remover 'R$', pontos de milhar e substituir vírgula por ponto decimal
    const cleanedPrice = parseFloat(priceStr.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(cleanedPrice) ? null : cleanedPrice;
};

app.get('/', (req, res) => {
    res.send('Scraping microservice is running. Use the POST /api/scrape endpoint.');
});


const scrapeAttempt = async (browser, searchTerm, searchUrl, productLinkSelector) => {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    const finalSearchUrl = searchUrl.replace('${produtoBusca}', encodeURIComponent(searchTerm));
    console.log(`Navigating to: ${finalSearchUrl}`);

    try {
        await page.goto(finalSearchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        if ((await page.content()).toLowerCase().includes('captcha')) {
             console.log('CAPTCHA detected.');
             await page.close();
             return { status: 'blocked', productUrl: finalSearchUrl, message: 'Acesso bloqueado por CAPTCHA na página de busca.' };
        }
        
        const productUrl = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? element.href : null;
        }, productLinkSelector);
        
        await page.close();
        
        if (!productUrl) {
            console.log('Product link not found with selector:', productLinkSelector);
            return { status: 'not_found', productUrl: finalSearchUrl, message: 'Link do produto não encontrado na busca.' };
        }

        console.log('Product URL found:', productUrl);
        return { status: 'found', productUrl };

    } catch (error) {
        console.error(`Error during scrape attempt for term "${searchTerm}":`, error.message);
        await page.close();
        if (error instanceof puppeteer.errors.TimeoutError) {
            return { status: 'timeout', productUrl: finalSearchUrl, message: 'Timeout ao carregar a página de busca.' };
        }
        return { status: 'error', productUrl: finalSearchUrl, message: `Erro na busca: ${error.message}` };
    }
};


app.post('/api/scrape', async (req, res) => {
    const { searchTerm, secondarySearchTerm, searchUrl, productLinkSelector, productPriceSelector } = req.body;

    if (!searchTerm || !searchUrl || !productLinkSelector || !productPriceSelector) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes: searchTerm, searchUrl, productLinkSelector, productPriceSelector.' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new', // 'new' é o recomendado atualmente
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // Pode não ser ideal para estabilidade, mas economiza recursos
                '--disable-gpu'
            ],
        });

        // --- Tentativa 1: Termo de Busca Principal (Descrição) ---
        console.log(`Attempt 1: Searching for "${searchTerm}"`);
        let result = await scrapeAttempt(browser, searchTerm, searchUrl, productLinkSelector);
        let attempts = 1;

        // --- Tentativa 2: Termo de Busca Secundário (Cód. Fabricante) ---
        if (result.status === 'not_found' && secondarySearchTerm) {
            console.log(`Attempt 1 failed. Trying secondary term: "${secondarySearchTerm}"`);
            result = await scrapeAttempt(browser, secondarySearchTerm, searchUrl, productLinkSelector);
            attempts = 2;
        }
        
        if (result.status !== 'found') {
             await browser.close();
             return res.status(200).json({ status: result.status, message: result.message || `Produto não encontrado após ${attempts} tentativa(s).`, productUrl: result.productUrl, price: null, attempts });
        }
        
        const { productUrl } = result;

        // --- Agora, vai para a página do produto para pegar o preço ---
        const productPage = await browser.newPage();
         await productPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        await productPage.setRequestInterception(true);
        productPage.on('request', (req) => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Navigating to product page: ${productUrl}`);
        await productPage.goto(productUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        if ((await productPage.content()).toLowerCase().includes('captcha')) {
            console.log('CAPTCHA detected on product page.');
            await browser.close();
            return res.status(200).json({ status: 'blocked', message: 'Acesso bloqueado por CAPTCHA na página do produto.', productUrl, price: null, attempts });
        }

        const priceStr = await productPage.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent : null;
        }, productPriceSelector);

        await productPage.close();

        if (!priceStr) {
            console.log('Price not found with selector:', productPriceSelector);
            await browser.close();
            return res.status(200).json({ status: 'price_not_found', message: 'Seletor de preço não encontrou uma correspondência.', productUrl, price: null, attempts });
        }
        
        console.log('Raw price string found:', priceStr);
        const price = parsePrice(priceStr);
        console.log('Parsed price:', price);

        if (price === null) {
            return res.status(200).json({ status: 'price_not_found', message: `O texto do preço "${priceStr}" não pôde ser convertido para número.`, productUrl, price: null, attempts });
        }

        res.status(200).json({
            status: 'success',
            productUrl,
            price,
            attempts,
            message: 'Preço extraído com sucesso.'
        });

    } catch (error) {
        console.error('Scraping Error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            productUrl: null,
            price: null,
            attempts: 0
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

