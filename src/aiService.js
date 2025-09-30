import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

export class AIService {
    constructor() {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
        this.model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
        this.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS) || 1000;
        this.temperature = parseFloat(process.env.CLAUDE_TEMPERATURE) || 0.7;
    }

    /**
     * Build prompt with page context (for preview before sending to AI)
     * @param {Object} pageData - Page data including url, title, currentMeta
     * @returns {Promise<Object>} Prompt and page context
     */
    async buildPromptWithContext(pageData) {
        const { url, title, currentMeta } = pageData;

        // Fetch page content for context
        let pageContext = '';
        try {
            const { WebCrawler } = await import('./webCrawler.js');
            const crawler = new WebCrawler({ usePuppeteer: true });
            const crawlResult = await crawler.fetchPageWithPuppeteer(url);

            if (crawlResult.success) {
                pageContext = this.extractPageContext(crawlResult.html);
            }
        } catch (error) {
            console.log('Could not fetch page content:', error.message);
        }

        const prompt = this.buildMetaDescriptionPrompt(url, title, currentMeta, pageContext);

        return {
            success: true,
            prompt,
            pageContext,
            url,
            title,
            currentMeta
        };
    }

    /**
     * Generate suggestions from a custom prompt
     * @param {string} prompt - The prompt to send to AI
     * @param {number} count - Number of suggestions to generate
     * @returns {Promise<Object>} AI response with suggestions
     */
    async generateFromPrompt(prompt, count = 5) {
        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const suggestions = this.parseMetaDescriptionResponse(response.content[0].text);

            return {
                success: true,
                suggestions: suggestions.slice(0, count),
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    estimatedCost: this.calculateCost(response.usage)
                }
            };
        } catch (error) {
            console.error('AI Service Error:', error);
            return {
                success: false,
                error: error.message,
                suggestions: []
            };
        }
    }

    /**
     * Generate meta description suggestions for a URL
     * @param {Object} pageData - Page data including url, title, currentMeta
     * @param {number} count - Number of suggestions to generate (default: 5)
     * @returns {Promise<Array>} Array of suggested meta descriptions
     */
    async generateMetaDescriptions(pageData, count = 5) {
        const { url, title, currentMeta } = pageData;

        // Fetch page content for context
        let pageContext = '';
        try {
            const { WebCrawler } = await import('./webCrawler.js');
            const crawler = new WebCrawler({ usePuppeteer: true });
            const crawlResult = await crawler.fetchPageWithPuppeteer(url);

            if (crawlResult.success) {
                pageContext = this.extractPageContext(crawlResult.html);
            }
        } catch (error) {
            console.log('Could not fetch page content, proceeding without it:', error.message);
        }

        const prompt = this.buildMetaDescriptionPrompt(url, title, currentMeta, pageContext);

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const suggestions = this.parseMetaDescriptionResponse(response.content[0].text);

            return {
                success: true,
                suggestions: suggestions.slice(0, count),
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    estimatedCost: this.calculateCost(response.usage)
                }
            };
        } catch (error) {
            console.error('AI Service Error:', error);
            return {
                success: false,
                error: error.message,
                suggestions: []
            };
        }
    }

    /**
     * Generate meta descriptions in bulk for multiple URLs
     * @param {Array} pagesData - Array of page data objects
     * @param {number} suggestionsPerPage - Number of suggestions per page
     * @returns {Promise<Object>} Results with suggestions for each URL
     */
    async generateBulkMetaDescriptions(pagesData, suggestionsPerPage = 3) {
        const results = {
            success: true,
            totalProcessed: 0,
            totalCost: 0,
            pages: []
        };

        for (const pageData of pagesData) {
            try {
                const result = await this.generateMetaDescriptions(pageData, suggestionsPerPage);

                results.pages.push({
                    url: pageData.url,
                    ...result
                });

                if (result.success) {
                    results.totalProcessed++;
                    results.totalCost += result.usage.estimatedCost;
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                results.pages.push({
                    url: pageData.url,
                    success: false,
                    error: error.message,
                    suggestions: []
                });
            }
        }

        return results;
    }

    /**
     * Extract concise page context from HTML (max ~500 chars to avoid token bloat)
     */
    extractPageContext(html) {
        const $ = cheerio.load(html);

        // Remove scripts, styles, and navigation
        $('script, style, nav, header, footer').remove();

        // Extract key elements
        const h1 = $('h1').first().text().trim();
        const h2s = $('h2').slice(0, 3).map((i, el) => $(el).text().trim()).get();
        const firstParagraph = $('p').first().text().trim().substring(0, 200);

        // Extract product info based on page type
        // Category pages: InfoArea h3 elements contain product names
        const categoryProducts = $('.InfoArea h3')
            .map((i, el) => $(el).text().trim()).get()
            .filter(text => text.length > 3 && text.length < 100 && /[a-zA-Z]/.test(text));

        // Product detail pages: .description class contains product info
        const productDescription = $('.description').first().text().trim().substring(0, 300);

        let products = [];
        if (categoryProducts.length > 0) {
            products = categoryProducts;
        }

        // Count total products for context
        const totalProducts = products.length;

        let context = '';
        if (h1) context += `Main Heading: ${h1}\n`;
        if (h2s.length > 0) context += `Subheadings: ${h2s.join(', ')}\n`;
        if (firstParagraph) context += `Content: ${firstParagraph}\n`;

        // Category page: list ALL products (token cost is minimal compared to accuracy)
        if (products.length > 0) {
            context += `\nThis is a category/brand page with ${products.length} products:\n`;
            context += products.join(', ');
            context += '\n';
        }

        // Product detail page: include description
        if (productDescription && products.length === 0) {
            context += `Product Description: ${productDescription}\n`;
        }

        // Allow up to 2500 chars for full product lists (still reasonable token usage)
        return context.substring(0, 2500);
    }

    /**
     * Build prompt for meta description generation
     */
    buildMetaDescriptionPrompt(url, title, currentMeta, pageContext = '') {
        return `You are an expert SEO copywriter. Generate compelling meta descriptions based on the page information below.

URL: ${url}
Page Title: ${title || 'Not provided'}
Current Meta Description: ${currentMeta || 'None'}

${pageContext ? `Page Content Summary:\n${pageContext}\n` : ''}

Instructions:
1. Analyze the page information provided above
2. Identify the main products, services, or topics
3. Extract key features, benefits, and selling points

Requirements for meta descriptions:
- Length: 120-160 characters (optimal for Google search results)
- Target keyword: "vape" - include this naturally where relevant
- Include other relevant keywords based on the actual page content you fetched
- Create urgency or curiosity to increase click-through rate
- Be specific and accurate to the page content
- Include a call-to-action when appropriate
- Avoid duplicate content from the title
- Write in an engaging, human tone
- DO NOT repeat words unnecessarily - keep language clean and concise
- Each description must be unique with varied vocabulary
- Avoid redundant phrases or filler words
- Use British English spelling (e.g., "flavour" not "flavor", "vapour" not "vapor", "customise" not "customize")

Generate 5 different meta description options with different approaches:
1. Benefit-focused (emphasize user value)
2. Action-oriented (strong call-to-action)
3. Question-based (create curiosity)
4. Feature-focused (highlight key features)
5. Urgency-driven (time-sensitive or exclusive)

Format your response as a numbered list (1-5), with ONLY the meta description text for each. No explanations or labels.`;
    }

    /**
     * Parse AI response to extract meta descriptions
     */
    parseMetaDescriptionResponse(responseText) {
        const lines = responseText.split('\n').filter(line => line.trim());
        const suggestions = [];

        for (const line of lines) {
            // Match numbered lines like "1. Description text" or "1) Description text"
            const match = line.match(/^\d+[\.\)]\s*(.+)$/);
            if (match) {
                const description = match[1].trim();
                // Remove any quotes if present
                const cleanDescription = description.replace(/^["']|["']$/g, '');

                if (cleanDescription.length >= 50 && cleanDescription.length <= 200) {
                    suggestions.push({
                        text: cleanDescription,
                        length: cleanDescription.length,
                        isOptimal: cleanDescription.length >= 120 && cleanDescription.length <= 160
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Calculate estimated cost based on token usage
     * Claude 3.5 Sonnet pricing: $3/1M input tokens, $15/1M output tokens
     */
    calculateCost(usage) {
        const inputCost = (usage.input_tokens / 1000000) * 3;
        const outputCost = (usage.output_tokens / 1000000) * 15;
        return inputCost + outputCost;
    }

    /**
     * Analyze meta description quality
     * @param {string} metaDescription - The meta description to analyze
     * @returns {Promise<Object>} Analysis results
     */
    async analyzeMetaDescription(metaDescription) {
        const prompt = `Analyze this meta description for SEO quality:

"${metaDescription}"

Provide a brief analysis (2-3 sentences) covering:
- Does it include a clear call-to-action?
- Are there relevant keywords?
- Is the tone appropriate?
- Any improvements needed?

Keep your response concise and actionable.`;

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 300,
                temperature: 0.5,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            return {
                success: true,
                analysis: response.content[0].text,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    estimatedCost: this.calculateCost(response.usage)
                }
            };
        } catch (error) {
            console.error('AI Analysis Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Extract keywords from meta description
     * @param {string} metaDescription - The meta description
     * @returns {Promise<Array>} Array of keywords
     */
    async extractKeywords(metaDescription) {
        const prompt = `Extract the main SEO keywords from this meta description. Return ONLY a comma-separated list of keywords, nothing else:

"${metaDescription}"`;

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 150,
                temperature: 0.3,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const keywordsText = response.content[0].text.trim();
            const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k);

            return {
                success: true,
                keywords,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    estimatedCost: this.calculateCost(response.usage)
                }
            };
        } catch (error) {
            console.error('Keyword Extraction Error:', error);
            return {
                success: false,
                error: error.message,
                keywords: []
            };
        }
    }

    /**
     * Test API connection
     */
    async testConnection() {
        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 50,
                messages: [{
                    role: 'user',
                    content: 'Say "API connection successful" and nothing else.'
                }]
            });

            return {
                success: true,
                message: 'Claude AI API connected successfully',
                model: this.model,
                response: response.content[0].text
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}