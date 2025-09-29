import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const parsePrice = (priceStr) => {
    if (!priceStr) return null;
    const cleanedPrice = parseFloat(priceStr.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(cleanedPrice) ? null : cleanedPrice;
};

app.get('/', (req, res) => {
    res.send('Scraping microservice is running. Use the POST /api/scrape endpoint.');
});

app.post('/api/scrape', async (req, res) => {
    const { searchUrl, productLinkSelector, productPriceSelector } = req.body;

    if (!searchUrl || !productLinkSelector || !productPriceSelector) {
        return res.status(400).json({ error: 'Missing required parameters: searchUrl, productLinkSelector, productPriceSelector.' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            // These args are crucial for running Puppeteer in containerized environments like Render/Railway
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ],
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        
        // Improve performance by blocking non-essential resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // 1. Go to search page
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        if ((await page.content()).includes('captcha')) {
            await browser.close();
            return res.status(200).json({ status: 'blocked', message: 'Scraping blocked by CAPTCHA on search page.', productUrl: searchUrl, price: null });
        }
        
        // 2. Extract product link
        const productUrl = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? (element as HTMLAnchorElement).href : null;
        }, productLinkSelector);

        if (!productUrl) {
            await browser.close();
            return res.status(200).json({ status: 'not_found', message: 'Product link selector did not find a match.', productUrl: searchUrl, price: null });
        }

        // 3. Go to product page
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        if ((await page.content()).includes('captcha')) {
            await browser.close();
            return res.status(200).json({ status: 'blocked', message: 'Scraping blocked by CAPTCHA on product page.', productUrl: productUrl, price: null });
        }

        // 4. Extract price
        const priceStr = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent : null;
        }, productPriceSelector);

        if (!priceStr) {
            await browser.close();
            return res.status(200).json({ status: 'price_not_found', message: 'Price selector did not find a match.', productUrl, price: null });
        }

        const price = parsePrice(priceStr);

        res.status(200).json({
            status: 'success',
            productUrl,
            price
        });

    } catch (error) {
        console.error('Scraping Error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            productUrl: null,
            price: null
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
