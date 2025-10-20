import express from 'express';
import axios from 'axios';
import { load } from 'cheerio';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

const SCRAPER_API_KEY = 'd86f689a4e978c7cc0a76f9705bc42fd'; // Ideal: troque para variável de ambiente!

app.use(cors());
app.use(express.json());

const parsePrice = (priceStr) => {
    if (!priceStr) return null;
    const cleanedPrice = parseFloat(priceStr.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(cleanedPrice) ? null : cleanedPrice;
};

app.get('/', (req, res) => {
    res.send('Scraping microservice running. Use POST /api/scrape endpoint.');
});

// Scraping via ScraperAPI + cheerio (AJAX/HTML)
async function scrapeViaHttp(searchUrl, productLinkSelector, productPriceSelector) {
    const requestUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(searchUrl)}`;
    const response = await axios.get(requestUrl, { timeout: 45000 });
    const $ = load(response.data);
    const productUrl = $(productLinkSelector).attr('href');
    if (!productUrl) {
        return { status: 'not_found', productUrl: searchUrl, message: 'Link do produto não encontrado na busca.' };
    }

    // Busca preço na própria página de lista (se disponível)
    let priceStr = $(productPriceSelector).text();
    if (priceStr) {
        const price = parsePrice(priceStr);
        if (price !== null) {
            return { status: 'success', productUrl, price, attempts: 1, message: 'Preço encontrado na busca.' };
        }
    }
    // Se não encontrou, prepara para fallback (abrir página do produto)
    return { status: 'found', productUrl: productUrl.startsWith('http') ? productUrl : new URL(productUrl, searchUrl).toString() };
}

app.post('/api/scrape', async (req, res) => {
    const { searchTerm, secondarySearchTerm, searchUrl, productLinkSelector, productPriceSelector } = req.body;

    if (!searchTerm || !searchUrl || !productLinkSelector || !productPriceSelector) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes: searchTerm, searchUrl, productLinkSelector, productPriceSelector.' });
    }

    let result;
    let attempts = 1;

    // 1ª tentativa: busca principal
    let urlBusca = searchUrl.replace('${produtoBusca}', encodeURIComponent(searchTerm));
    try {
        result = await scrapeViaHttp(urlBusca, productLinkSelector, productPriceSelector);
        if (result.status === 'not_found' && secondarySearchTerm) {
            // Fallback: buscar usando código fabricante
            attempts++;
            urlBusca = searchUrl.replace('${produtoBusca}', encodeURIComponent(secondarySearchTerm));
            result = await scrapeViaHttp(urlBusca, productLinkSelector, productPriceSelector);
        }

        // Se sucesso direto na lista
        if (result.status === 'success') {
            result.attempts = attempts;
            return res.status(200).json(result);
        }

        // Se precisa entrar na página do produto para pegar o preço
        if (result.status === 'found' && result.productUrl) {
            const productPageUrl = result.productUrl;
            const productRequestUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(productPageUrl)}`;
            const pageResponse = await axios.get(productRequestUrl, { timeout: 45000 });
            const $ = load(pageResponse.data);
            const priceStr = $(productPriceSelector).text();
            if (priceStr) {
                const price = parsePrice(priceStr);
                if (price !== null) {
                    return res.status(200).json({
                        status: 'success',
                        productUrl: productPageUrl,
                        price,
                        attempts,
                        message: 'Preço extraído da página do produto.'
                    });
                }
            }
            return res.status(200).json({
                status: 'price_not_found',
                message: 'Preço não encontrado na página do produto.',
                productUrl: productPageUrl,
                price: null,
                attempts
            });
        }
        // Se não achou nada
        return res.status(200).json({
            status: result.status,
            message: result.message,
            productUrl: result.productUrl,
            price: null,
            attempts
        });

    } catch (error) {
        console.error('Scraping Error:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message,
            productUrl: null,
            price: null,
            attempts
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
