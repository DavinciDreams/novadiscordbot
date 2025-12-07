// main.js
require('dotenv').config({ path: 'config.env' });
const { Client, IntentsBitField } = require('discord.js');
const { saveFile, searchFiles } = require('./database');
const { saveFileToDisk, isValidHttpUrl } = require('./utils');
const axios = require('axios');
const fs = require('fs');

// Rate limit configuration
const RATE_LIMIT = {
  MAX_REQUESTS: 5,
  TIME_WINDOW_MS: 60000, // 1 minute
  requestCount: 0,
  lastRequestTime: null
};

// Prompt enhancement and NLP functions
function enhancePrompt(prompt) {
  if (!prompt) return '';
  
  let enhanced = prompt.toLowerCase();
  
  // Add descriptive details if missing
  const descriptors = ['high quality', 'detailed', 'realistic', 'sharp', 'vivid'];
  for (const desc of descriptors) {
    if (!enhanced.includes(desc)) {
      enhanced += ` ${desc}`;
    }
  }

  // Handle common abbreviations
  const abbreviations = {
    'hd': 'high definition',
    '4k': '4k resolution',
    '8k': '8k resolution',
    'ultra': 'ultra high resolution',
    'photo': 'photorealistic',
    'art': 'artistic',
    'sketch': 'sketch style',
    'watercolor': 'watercolor painting',
    'oil': 'oil painting',
    'digital': 'digital art',
  };

  for (const [abbr, full] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    enhanced = enhanced.replace(regex, full);
  }

  // Handle common misspellings
  const misspellings = {
    'realstic': 'realistic',
    'highqulity': 'high quality',
    'detaled': 'detailed',
    'sharpe': 'sharp',
    'vivid': 'vivid colors',
  };

  for (const [wrong, correct] of Object.entries(misspellings)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    enhanced = enhanced.replace(regex, correct);
  }

  // Ensure prompt has some form of style if none provided
  if (!enhanced.match(/(realistic|artistic|digital art|oil painting|watercolor|sketch style)/i)) {
    enhanced += ' digital art';
  }

  return enhanced.trim();
}

// Image generation function
async function generateImageFromPrompt(message, enhancedPrompt) {
  try {
    // Models to try in order: primary then fallbacks
    const models = [
      'stabilityai/stable-diffusion-xl-light',
      'stabilityai/stable-diffusion-xl',
      'runwayml/stable-diffusion-v2'
    ];

    for (const model of models) {
      // Rate limit check for each model attempt
      const now = Date.now();
      if (RATE_LIMIT.lastRequestTime !== null) {
        const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
        if (timeSinceLastRequest < RATE_LIMIT.TIME_WINDOW_MS) {
          if (RATE_LIMIT.requestCount >= RATE_LIMIT.MAX_REQUESTS) {
            message.reply('❌ Rate limit exceeded. Please wait a moment before trying again.');
            return;
          } else {
            RATE_LIMIT.requestCount++;
          }
        } else {
          RATE_LIMIT.requestCount = 1;
          RATE_LIMIT.lastRequestTime = now;
        }
      } else {
        RATE_LIMIT.requestCount = 1;
        RATE_LIMIT.lastRequestTime = now;
      }

      // Exponential backoff settings for each model
      const maxRetries = 3;
      let retryDelay = 1000; // Start with 1 second
      let retryCount = 0;
      let response;

      while (retryCount < maxRetries) {
        try {
          response = await axios.post(
            'https://openrouter.ai/api/v1/generate',
            {
              model: model,
              prompt: enhancedPrompt,
              num_images: 1,
              size: '1024x1024',
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
              },
              timeout: 10000, // 10 seconds timeout
            }
          );
          break; // Success, exit retry loop
        } catch (err) {
          if (err.response && [429, 500, 502, 503, 504].includes(err.response.status)) {
            retryCount++;
            if (retryCount >= maxRetries) {
              break; // Move to next model after retries exhausted
            }
            console.debug(`[API] Retrying model ${model} due to ${err.response.status} error...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay *= 2; // Exponential backoff
          } else {
            break; // Non-retryable error, try next model
          }
        }
      }
      
      // If we got a successful response for this model, process it
      if (response?.status === 200) {
        // Debug logging
        console.log('API Response:', JSON.stringify(response.data, null, 2));
        
        // Enhanced response handling with defensive checks
        if (response?.data && typeof response.data === 'object' && response.data !== null) {
          let imageUrl = null;
          
          // Type validation for critical response properties
          if (!Array.isArray(response.data.data)) {
            console.error('Invalid data structure: data.data is not an array. Full data:', JSON.stringify(response.data, null, 2));
            message.reply('❌ [INVALID_RESPONSE] Unexpected API response structure. Please try again.');
            return;
          }
  
          // Log full structure for debugging
          console.log('Debugging - Full API response structure:', JSON.stringify(response.data, null, 2));
  
          // Primary path: data.data[0].image_url
          if (response.data.data?.[0]?.image_url) {
            imageUrl = response.data.data[0].image_url;
          }
  
          // If primary not found, try fallback paths
          if (!imageUrl) {
            const FALLBACK_PATHS = [
              ['url'],
              ['image_url'],
              ['images', 0, 'url'],
              ['link'],
              ['images', 'url'],
              ['data', 'url'],
              ['response', 'url'],
              ['result', 'url'],
              ['image', 'url']
            ];
  
            const isValidHttpUrl = (string) => {
              if (typeof string !== 'string') return false;
              try {
                new URL(string);
                return true;
              } catch (err) {
                return false;
              }
            };
  
            const getNestedProperty = (obj, path) => path.reduce((acc, key) => acc?.[key], obj);
  
            for (const path of FALLBACK_PATHS) {
              const value = getNestedProperty(response.data, path);
              if (value && isValidHttpUrl(value)) {
                imageUrl = value;
                console.debug(`Fallback path ${path.join('.')} successful. Image URL: ${imageUrl}`);
                break;
              } else {
                console.debug(`Fallback path ${path.join('.')} attempted. Value: ${value}`);
              }
            }
          }
  
          // Validate and send image URL if found
          if (imageUrl) {
            if (isValidHttpUrl(imageUrl)) {
              message.reply(`🖼️ Generated Image: ${imageUrl}`);
            } else {
              console.error('Invalid image URL format in API response after fallback:', imageUrl);
              message.reply('❌ [URL_INVALID] Invalid image URL format in API response.');
            }
          } else {
            console.error('No valid image URL found in API response after trying all fallback paths. Full data:', JSON.stringify(response.data, null, 2));
            message.reply(`❌ [NO_IMAGE_URL] Could not find image URL in API response. Raw response: ${JSON.stringify(response.data)}`);
          }
        } else if (response?.data?.error || response?.data?.message) {
          const errorDetail = response.data.error || response.data.message;
          console.error('API returned error:', errorDetail);
          message.reply(`❌ [API_ERROR] ${errorDetail}. Raw response: ${JSON.stringify(response.data)}`);
        } else {
          console.error('Unexpected API response structure. Full data:', response.data);
          message.reply('❌ [UNEXPECTED_RESPONSE] Invalid response from image generation API. Raw response: ' + (response?.data ? JSON.stringify(response.data) : 'No data'));
        }
        return; // Successfully processed this model
      }
    }
    
    // If all models failed
    throw new Error('All available models failed to generate an image');
  } catch (err) {
    // Enhanced error logging with context
    const errorContext = {
      timestamp: new Date().toISOString(),
      userId: message.author.id,
      prompt: enhancedPrompt,
      errorMessage: err.message,
      errorType: err.name,
      responseData: err.response?.data,
      statusCode: err.response?.status,
      stack: err.stack
    };
    console.error('[API] Detailed error:', errorContext);

    if (err.response) {
      // Structured error handling for different status codes
      let errorMessage = `❌ [API_ERROR] Request failed with status ${err.response.status}`;
      
      switch (err.response.status) {
        case 429:
          errorMessage += ' - Rate limit exceeded. Please wait 1 minute before trying again.';
          break;
        case 401:
          errorMessage += ' - Unauthorized. Check your API key configuration.';
          break;
        case 403:
          errorMessage += ' - Forbidden. Check API permissions or quota.';
          break;
        case 404:
          errorMessage += ' - Endpoint not found. Check API URL configuration.';
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          errorMessage += ' - Server error. This may be a temporary issue.';
          break;
        default:
          const errorDetail = err.response.data?.error || err.response.data?.message || 'Unknown error';
          errorMessage += `: ${errorDetail}`;
      }
      
      // Include raw response in debug logs
      console.debug('[API] Full error response:', err.response.data);
      
      message.reply(`${errorMessage}\n\nSuggested actions:\n- Try a simpler prompt like "a cute cat"\n- Verify API key configuration\n- Check service status if error persists`);
    } else if (err.code === 'ECONNABORTED') {
      console.error('[API] Connection timeout:', errorContext);
      message.reply('❌ [TIMEOUT] Request timed out. Check internet connection and try again.');
    } else if (err.request) {
      // Network errors
      console.error('[API] Network error:', errorContext);
      message.reply('❌ [NETWORK] Network error. Check internet connection and try again.');
    } else {
      // Other errors
      console.error('[API] Unexpected error:', errorContext);
      message.reply(`❌ [UNHANDLED] Error processing request: ${err.message}. Try again later.`);
    }
  }
}
    
    // If we got a successful response for this model, process it
    if (response?.status === 200) {
      // Debug logging
      console.log('API Response:', JSON.stringify(response.data, null, 2));
      
      // Enhanced response handling with defensive checks
      if (response?.data && typeof response.data === 'object' && response.data !== null) {
        let imageUrl = null;
        
        // Type validation for critical response properties
        if (!Array.isArray(response.data.data)) {
          console.error('Invalid data structure: data.data is not an array. Full data:', JSON.stringify(response.data, null, 2));
          message.reply('❌ [INVALID_RESPONSE] Unexpected API response structure. Please try again.');
          return;
        }

        // Log full structure for debugging
        console.log('Debugging - Full API response structure:', JSON.stringify(response.data, null, 2));

        // Primary path: data.data[0].image_url
        if (response.data.data?.[0]?.image_url) {
          imageUrl = response.data.data[0].image_url;
        }

        // If primary not found, try fallback paths
        if (!imageUrl) {
          const FALLBACK_PATHS = [
            ['url'],
            ['image_url'],
            ['images', 0, 'url'],
            ['link'],
            ['images', 'url'],
            ['data', 'url'],
            ['response', 'url'],
            ['result', 'url'],
            ['image', 'url']
          ];

          const isValidHttpUrl = (string) => {
            if (typeof string !== 'string') return false;
            try {
              new URL(string);
              return true;
            } catch (err) {
              return false;
            }
          };

          const getNestedProperty = (obj, path) => path.reduce((acc, key) => acc?.[key], obj);

          for (const path of FALLBACK_PATHS) {
            const value = getNestedProperty(response.data, path);
            if (value && isValidHttpUrl(value)) {
              imageUrl = value;
              console.debug(`Fallback path ${path.join('.')} successful. Image URL: ${imageUrl}`);
              break;
            } else {
              console.debug(`Fallback path ${path.join('.')} attempted. Value: ${value}`);
            }
          }
        }

        // Validate and send image URL if found
        if (imageUrl) {
          if (isValidHttpUrl(imageUrl)) {
            message.reply(`🖼️ Generated Image: ${imageUrl}`);
          } else {
            console.error('Invalid image URL format in API response after fallback:', imageUrl);
            message.reply('❌ [URL_INVALID] Invalid image URL format in API response.');
          }
        } else {
          console.error('No valid image URL found in API response after trying all fallback paths. Full data:', JSON.stringify(response.data, null, 2));
          message.reply(`❌ [NO_IMAGE_URL] Could not find image URL in API response. Raw response: ${JSON.stringify(response.data)}`);
        }
      } else if (response?.data?.error || response?.data?.message) {
        const errorDetail = response.data.error || response.data.message;
        console.error('API returned error:', errorDetail);
        message.reply(`❌ [API_ERROR] ${errorDetail}. Raw response: ${JSON.stringify(response.data)}`);
      } else {
        console.error('Unexpected API response structure. Full data:', response.data);
        message.reply('❌ [UNEXPECTED_RESPONSE] Invalid response from image generation API. Raw response: ' + (response?.data ? JSON.stringify(response.data) : 'No data'));
      }
      return; // Successfully processed this model
    }

// Initialize bot
const bot = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

const PREFIX = '!';

bot.on('ready', () => {
  console.log(`Logged in as ${bot.user.tag}!`);
});

bot.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Bot mention detection and prompt extraction
  if (message.mentions.users.has(bot.user.id) && !message.content.startsWith(PREFIX)) {
    // Extract prompt by removing bot mention
    const botId = bot.user.id;
    let prompt = message.content.replace(`<@${botId}>`, '').trim();
    
    // Handle @username mentions if needed
    if (!prompt) {
      prompt = message.content.replace(`@${bot.user.username}`, '').trim();
    }
    
    if (!prompt) {
      try {
        message.reply(`👋 Hello! To generate an image, mention me followed by your prompt. Example: <@${botId}> a cute cat\n\n**Commands:**\n- \`!upload\` - Upload a file (attach the file to your message)\n- \`!recall <keyword>\> - Search and retrieve uploaded files by keyword\n- \`!generate <prompt>\` - Generate an image based on your prompt`);
      } catch (err) {
        console.error('Error responding to bot mention:', err);
      }
      return;
    }

    try {
      const enhancedPrompt = enhancePrompt(prompt);
      await generateImageFromPrompt(message, enhancedPrompt);
    } catch (err) {
      console.error('Error processing mention prompt:', err);
      message.reply('❌ Failed to process your request.');
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // === COMMAND: Upload ===
  if (command === 'upload') {
    if (!message.attachments.size) {
      return message.reply('❌ No file attached!');
    }

    const messageLink = message.url;
    for (const [_, attachment] of message.attachments) {
      try {
        const filePath = await saveFileToDisk(attachment, attachment.name);
        saveFile(
          message.author.id,
          attachment.name,
          filePath,
          messageLink
        );
        message.reply(`✅ Saved: \`${attachment.name}\``);
      } catch (err) {
        console.error(err);
        message.reply('❌ Failed to save file.');
      }
    }
  }

  // === COMMAND: Recall ===
  if (command === 'recall') {
    const keyword = args.join(' ');
    if (!keyword) return message.reply('📝 Provide a search term!');

    try {
      const results = await searchFiles(keyword);
      if (!results.length) {
        return message.reply('🔍 No files found.');
      }

      for (const file of results) {
        const fileExists = await fs.promises.access(file.file_path, fs.constants.F_OK)
          .then(() => true)
          .catch(() => false);
        if (fileExists) {
          await message.reply({
            files: [file.file_path],
            content: `📄 Found: \`${file.filename}\` (Uploaded by <@${file.user_id}>)`,
          });
        } else {
          await message.reply(`❌ File \`${file.filename}\` not found on disk.`);
        }
      }
    } catch (err) {
      console.error(err);
      message.reply('❌ Error searching files.');
    }
  }

  // === COMMAND: Generate (Image) ===
  if (command === 'generate') {
    const prompt = args.join(' ');
    if (!prompt) return message.reply('🖼️ Provide a prompt!');

    try {
      const enhancedPrompt = enhancePrompt(prompt);
      await generateImageFromPrompt(message, enhancedPrompt);
    } catch (err) {
      console.error('Error generating image:', err);
      message.reply('❌ Failed to generate image.');
    }
  }
});

bot.login(process.env.DISCORD_BOT_TOKEN);