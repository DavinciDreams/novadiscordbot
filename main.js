// main.js
require('dotenv').config({ path: 'config.env' });
const { Client, IntentsBitField } = require('discord.js');
const { saveFile, searchFiles } = require('./database');
const { saveFileToDisk } = require('./utils');
const axios = require('axios');
const fs = require('fs');

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
    const response = await axios.post(
      'https://openrouter.ai/api/v1/generate',
      {
        model: 'stabilityai/stable-diffusion-xl-base',
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
        retry: { times: 3 } // 3 retry attempts
      }
    );
 
    if (response.status !== 200) {
      console.error('API returned non-200 status:', response.status, response.data);
      message.reply(`❌ API error: ${response.status}`);
      return;
    }
 
    if (response.data?.error) {
      console.error('API returned error in data:', response.data.error);
      message.reply(`❌ API error: ${response.data.error}`);
      return;
    }
 
    if (!response?.data?.data) {
      console.error('Invalid API response structure. Full data:', response.data);
      message.reply('❌ Invalid response from image generation API. Please check logs.');
      return;
    }
    if (!Array.isArray(response.data.data) || response.data.data.length === 0) {
      console.error('Unexpected data format. Expected array but got:', response.data.data);
      message.reply('❌ No images generated.');
      return;
    }
    const imageUrl = response.data.data[0].image_url;
    message.reply(`🖼️ Generated Image: ${imageUrl}`);
  } catch (err) {
    console.error('Error generating image:', err.response ? err.response.data : err.message);
    message.reply('❌ Failed to generate image. Please try again later.');
  }
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