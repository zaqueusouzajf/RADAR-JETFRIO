import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';

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
        return res.status(400).json({ status: 'error', message: 'Parâmetros essenciais ausentes.' });
    }

    const primaryTerm = secondarySearchTerm || searchTerm;
    if (!primaryTerm) {
        return res.status(400).json({ status: 'error', message: 'Nenhum termo de busca fornecido.' });
    }

    const finalSearchUrl = searchUrl
        .replace('${produtoBusca}', encodeURIComponent(primaryTerm))
        .replace('${codigoFabricante}', encodeURIComponent(primaryTerm));

    try {
        // Etapa 1: Buscar a página de resultados da busca
        const searchPageApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(finalSearchUrl)}`;
        const searchResponse = await axios.get(searchPageApiUrl, { timeout: 120000 });

        if (searchResponse.status !== 200) {
            return res.status(200).json({
                status: 'error',
                message: `Falha ao buscar a página de busca. Status: ${searchResponse.status}`,
                html: searchResponse.data,
            });
        }
        
        const searchHtml = searchResponse.data;
        const $ = cheerio.load(searchHtml);

        if (searchHtml.toLowerCase().includes('captcha') || searchHtml.toLowerCase().includes('challenge')) {
            return res.status(200).json({
                status: 'blocked',
                message: 'Acesso bloqueado por CAPTCHA na página de busca.',
                html: searchHtml,
            });
        }

        const productLink = $(productLinkSelector).first().attr('href');

        if (!productLink) {
            return res.status(200).json({
                status: 'not_found',
                message: 'Seletor de link do produto não encontrou correspondência na busca.',
                html: searchHtml,
            });
        }

        const absoluteProductUrl = new URL(productLink, finalSearchUrl).toString();

        // Etapa 2: Buscar a página do produto
        const productPageApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(absoluteProductUrl)}`;
        const productPageResponse = await axios.get(productPageApiUrl, { timeout: 120000 });
        
        if (productPageResponse.status !== 200) {
             return res.status(200).json({
                status: 'error',
                message: `Falha ao buscar a página do produto. Status: ${productPageResponse.status}`,
                productUrl: absoluteProductUrl,
                html: productPageResponse.data,
            });
        }

        const productHtml = productPageResponse.data;
        const $$ = cheerio.load(productHtml);
        
        if (productHtml.toLowerCase().includes('captcha') || productHtml.toLowerCase().includes('challenge')) {
            return res.status(200).json({
                status: 'blocked',
                message: 'Acesso bloqueado por CAPTCHA na página do produto.',
                productUrl: absoluteProductUrl,
                html: productHtml,
            });
        }

        let priceText = $$(productPriceSelector).first().text().trim();
        
        if (!priceText) {
             return res.status(200).json({
                status: 'price_not_found',
                message: 'Seletor de preço não encontrou correspondência na página do produto.',
                productUrl: absoluteProductUrl,
                html: productHtml,
            });
        }

        const price = parseFloat(priceText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());

        if (isNaN(price)) {
             return res.status(200).json({
                status: 'price_not_found',
                message: `Não foi possível converter o preço extraído ('${priceText}') para um número.`,
                productUrl: absoluteProductUrl,
                html: productHtml,
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Preço extraído com sucesso.',
            price: price,
            productUrl: absoluteProductUrl,
        });

    } catch (error) {
        console.error('Erro durante o processo de scraping com Axios/Cheerio:', error.message);
        return res.status(500).json({
            status: 'error',
            message: error.message || 'Erro desconhecido durante o scraping.',
            productUrl: finalSearchUrl,
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Scraper service (axios-cheerio) is running on port ${PORT}`);
});

app.listen(PORT, () => {
    console.log(`🚀 Scraper service (axios-cheerio) is running on port ${PORT}`);
});
