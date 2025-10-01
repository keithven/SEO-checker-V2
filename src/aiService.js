import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

export class AIService {
    constructor() {
        // Determine which AI provider to use
        this.provider = process.env.AI_PROVIDER || 'claude'; // 'claude' or 'grok'
        this.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS) || 1000;
        this.temperature = parseFloat(process.env.CLAUDE_TEMPERATURE) || 0.7;

        this.initializeProvider(this.provider);
    }

    /**
     * Initialize or switch AI provider
     */
    initializeProvider(provider) {
        this.provider = provider;

        if (this.provider === 'grok') {
            this.client = new OpenAI({
                apiKey: process.env.GROK_API_KEY,
                baseURL: 'https://api.x.ai/v1'
            });
            this.model = process.env.GROK_MODEL || 'grok-2-latest';
        } else {
            this.client = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY,
            });
            this.model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
        }
    }

    /**
     * Switch AI provider dynamically
     */
    switchProvider(provider) {
        if (provider !== 'claude' && provider !== 'grok') {
            throw new Error('Invalid provider. Must be "claude" or "grok"');
        }
        this.initializeProvider(provider);
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
            console.log(`🔍 Making API request to ${this.provider}...`);
            const startTime = Date.now();

            let responseText;
            let usage;

            if (this.provider === 'grok') {
                // Grok API call (OpenAI-compatible)
                const response = await this.client.chat.completions.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                });
                responseText = response.choices[0].message.content;
                usage = {
                    input_tokens: response.usage.prompt_tokens,
                    output_tokens: response.usage.completion_tokens
                };
            } else {
                // Claude API call
                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                });
                responseText = response.content[0].text;
                usage = {
                    input_tokens: response.usage.input_tokens,
                    output_tokens: response.usage.output_tokens
                };
            }

            const endTime = Date.now();
            console.log(`✅ ${this.provider} response received in ${endTime - startTime}ms`);

            const suggestions = this.parseMetaDescriptionResponse(responseText);

            return {
                success: true,
                suggestions: suggestions.slice(0, count),
                usage: {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    estimatedCost: this.calculateCost(usage)
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

        // Use the unified generateFromPrompt method
        return this.generateFromPrompt(prompt, count);
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
1. FIRST: Use web search to find additional information about the product(s), brand(s), or category mentioned in the page title and content. Look for key features, benefits, unique selling points, and current trends.
2. Analyze the page information provided above combined with web search results
3. Identify the main products, services, or topics
4. Extract key features, benefits, and selling points from both the page content and web research

Requirements for meta descriptions:
- Length: 120-160 characters (optimal for Google search results)
- Include the main product name, brand, or category (from the page title) ONCE in a natural, compelling way
- Google highlights matching keywords in search results, so strategic placement of the product/brand name matters
- Target keyword: "vape" - include this naturally where relevant
- Include other relevant keywords based on the actual page content you fetched
- Avoid keyword stuffing - DO NOT repeat the same keywords or product names multiple times
- Create curiosity to increase click-through rate
- Be specific and accurate to the page content
- Include a call-to-action when appropriate
- Write in an engaging, human yet professional tone
- DO NOT repeat words - keep language clean and concise
- Each description must be unique with varied vocabulary
- Avoid redundant phrases or filler words
- Use British English spelling (e.g., "flavour" not "flavor", "vapour" not "vapor", "customise" not "customize")

Generate 4 different meta description options with different approaches:
1. Benefit-focused (emphasize user value)
2. Action-oriented (strong call-to-action)
3. Question-based (create curiosity)
4. Feature-focused (highlight key features)

Format your response as a numbered list (1-4), with ONLY the meta description text for each. No explanations or labels.`;
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