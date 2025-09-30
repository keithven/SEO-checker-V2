import Anthropic from '@anthropic-ai/sdk';
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
     * Generate meta description suggestions for a URL
     * @param {Object} pageData - Page data including url, title, currentMeta
     * @param {number} count - Number of suggestions to generate (default: 5)
     * @returns {Promise<Array>} Array of suggested meta descriptions
     */
    async generateMetaDescriptions(pageData, count = 5) {
        const { url, title, currentMeta } = pageData;

        const prompt = this.buildMetaDescriptionPrompt(url, title, currentMeta);

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt
                        },
                        {
                            type: 'url',
                            url: url
                        }
                    ]
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
     * Build prompt for meta description generation
     */
    buildMetaDescriptionPrompt(url, title, currentMeta) {
        return `You are an expert SEO copywriter. I will provide you with a URL to analyze, and you need to fetch the page content and generate compelling meta descriptions.

Page Title: ${title || 'Not provided'}
Current Meta Description: ${currentMeta || 'None'}

Instructions:
1. Fetch and analyze the webpage content from the URL I'm providing
2. Identify the main products, services, or topics on the page
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