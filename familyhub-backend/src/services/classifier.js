const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const CLASSIFICATION_PROMPT = `You are a family document and photo classifier. Analyze this file and return a JSON object with the following fields:

{
  "title": "A short descriptive title for this item",
  "description": "A 2-3 sentence description of what this file contains",
  "category": "One of: photo, document, receipt, letter, certificate, medical, legal, financial, other",
  "people": ["Array of any people descriptions visible, e.g. 'young boy', 'elderly woman'"],
  "date_estimate": "Best estimate of when this was created/taken (ISO date or 'unknown')",
  "tags": ["Array of relevant keywords for search"],
  "sentiment": "One of: joyful, neutral, formal, somber"
}

Return ONLY the JSON object, no additional text.`;

async function classifyFile(fileBuffer, mimeType, fileName) {
  const base64Data = fileBuffer.toString('base64');

  const contentBlock = mimeType === 'application/pdf'
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64Data,
        },
      };

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: `File name: "${fileName}"\n\n${CLASSIFICATION_PROMPT}`,
          },
        ],
      },
    ],
  });

  const responseText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error('Failed to parse classification response:', responseText);
    return {
      title: fileName,
      description: 'Classification failed - raw file',
      category: 'other',
      people: [],
      date_estimate: 'unknown',
      tags: [],
      sentiment: 'neutral',
    };
  }
}

module.exports = { classifyFile };
