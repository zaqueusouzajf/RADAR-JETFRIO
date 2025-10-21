import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import cheerio from 'cheerio';

// Aplica o plugin Stealth para tornar o Puppeteer menos detectável
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;

// Função de delay para humanizar o scraping
const delay = (ms) => new Promise(res => setTimeout(res, ms));

app.post('/api/scrape', async (req, res) => {
    const {
        searchTerm,
        secondarySearchTerm,
        searchUrl,
        productLinkSelector,
        productPriceSelector,
        scraperApiKey, // Chave da ScraperAPI recebida
    } = req.body;

    if (!searchUrl || !productLinkSelector || !productPriceSelector) {
        return res.status(400).json({ status: 'error', message: 'Parâmetros essenciais ausentes.' });
    }

    const primaryTerm = secondarySearchTerm || searchTerm;
    if (!primaryTerm) {
        return res.status(400).json({ status: 'error', message: 'Nenhum termo de busca fornecido.' });
    }

    const finalSearchUrl = searchUrl.replace('${produtoBusca}', encodeURIComponent(primaryTerm))
                                     .replace('${codigoFabricante}', encodeURIComponent(primaryTerm));

    try {
        const scraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(finalSearchUrl)}`;

        const response = await axios.get(scraperApiUrl, { timeout: 120000 });

        if (response.status !== 200) {
            return res.status(200).json({
                status: 'error',
                message: `Falha ao buscar a página de busca. Status: ${response.status}`,
                price: null,
                productUrl: finalSearchUrl,
                html: response.data,
            });
        }
        
        const html = response.data;
        const $ = cheerio.load(html);

        if (html.toLowerCase().includes('captcha') || html.toLowerCase().includes('challenge')) {
            return res.status(200).json({
                status: 'blocked',
                message: 'Acesso bloqueado por CAPTCHA na página de busca.',
                price: null,
                productUrl: finalSearchUrl,
                html: html,
            });
        }

        const productLink = $(productLinkSelector).first().attr('href');

        if (!productLink) {
            return res.status(200).json({
                status: 'not_found',
                message: 'Seletor de link do produto não encontrou correspondência.',
                price: null,
                productUrl: finalSearchUrl,
                html: html, // Retorna o HTML para diagnóstico
            });
        }

        const absoluteProductUrl = new URL(productLink, finalSearchUrl).toString();
        const productPageScraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(absoluteProductUrl)}`;
        
        const productPageResponse = await axios.get(productPageScraperApiUrl, { timeout: 120000 });
        
        const productHtml = productPageResponse.data;
        const $$ = cheerio.load(productHtml);

        let priceText = $$(productPriceSelector).first().text().trim();
        
        if (!priceText) {
             return res.status(200).json({
                status: 'price_not_found',
                message: 'Seletor de preço não encontrou correspondência na página do produto.',
                price: null,
                productUrl: absoluteProductUrl,
                html: productHtml, // Retorna o HTML para diagnóstico
            });
        }

        const price = parseFloat(priceText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());

        if (isNaN(price)) {
             return res.status(200).json({
                status: 'price_not_found',
                message: `Não foi possível converter o preço extraído ('${priceText}') para um número.`,
                price: null,
                productUrl: absoluteProductUrl,
                html: productHtml,
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
        console.error('Erro durante o processo de scraping:', error.message);
        let errorMessage = 'Erro desconhecido durante o scraping.';
        if (error.response) {
            errorMessage = `Erro do servidor de scraping: ${error.response.status} - ${error.response.statusText}`;
        } else if (error.request) {
            errorMessage = 'Nenhuma resposta recebida do serviço de scraping (possível timeout).';
        } else {
            errorMessage = error.message;
        }

        return res.status(500).json({
            status: 'error',
            message: errorMessage,
            price: null,
            productUrl: finalSearchUrl,
            html: error.response?.data || null
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
