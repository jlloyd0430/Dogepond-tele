const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

let latestPostId = null;
let channelConfig = {};
let userSteps = {}; // To track user steps

// Load channelConfig from file
const fs = require('fs');
const path = require('path');
const channelConfigPath = path.join(__dirname, 'channelConfig.json');

if (fs.existsSync(channelConfigPath)) {
    const data = fs.readFileSync(channelConfigPath);
    channelConfig = JSON.parse(data);
}

const saveChannelConfig = () => {
    fs.writeFileSync(channelConfigPath, JSON.stringify(channelConfig, null, 2));
};

// Add handler to get the channel ID when a message is forwarded
bot.on('message', (msg) => {
    if (msg.forward_from_chat) {
        console.log('Forwarded message from channel. Channel ID:', msg.forward_from_chat.id);
        bot.sendMessage(msg.chat.id, `Channel ID: ${msg.forward_from_chat.id}`);
    }

    const chatId = msg.chat.id;
    if (userSteps[chatId]) {
        handleStepInput(chatId, msg.text);
    }
});

bot.onText(/\/setchannel(\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    if (match[2]) {
        // Directly set the channel and drop type if provided
        const [channelId, dropType] = match[2].split(' ');

        if (channelId && dropType) {
            channelConfig[chatId] = { channelId, dropType };
            saveChannelConfig();
            bot.sendMessage(chatId, `Set the post channel to ${channelId} for ${dropType} drops`);
            return;
        }
    }

    // Prompt for channel ID if not provided
    bot.sendMessage(chatId, 'Please provide the channel ID:');
    userSteps[chatId] = { step: 'setChannelId' };
});

bot.onText(/\/latest/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Please provide the drop type (new mint, auction, airdrop, any):');
    userSteps[chatId] = { step: 'latestDropType' };
});

bot.onText(/\/alldrops/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const url = `${process.env.BACKEND_URL}/api/nftdrops/approved`;
        const response = await axios.get(url);
        const posts = response.data;

        if (posts.length === 0) {
            bot.sendMessage(chatId, 'No posts available.');
            return;
        }

        const messages = posts.map((post) => formatPostMessage(post)).join('\n\n');
        bot.sendMessage(chatId, messages);
    } catch (error) {
        console.error('Error fetching posts:', error);
        bot.sendMessage(chatId, `Error fetching posts: ${error.message}`);
    }
});

const handleStepInput = (chatId, input) => {
    const userStep = userSteps[chatId];
    if (userStep.step === 'setChannelId') {
        userSteps[chatId].channelId = input;
        bot.sendMessage(chatId, 'Please provide the drop type (new mint, auction, airdrop, any):');
        userSteps[chatId].step = 'setDropType';
    } else if (userStep.step === 'setDropType') {
        const channelId = userSteps[chatId].channelId;
        const dropType = input;
        channelConfig[chatId] = { channelId, dropType };
        saveChannelConfig();
        bot.sendMessage(chatId, `Set the post channel to ${channelId} for ${dropType} drops`);
        delete userSteps[chatId];
    } else if (userStep.step === 'latestDropType') {
        const dropType = input;
        fetchLatestDrop(chatId, dropType);
        delete userSteps[chatId];
    }
};

const fetchLatestDrop = async (chatId, dropType) => {
    try {
        const url = `${process.env.BACKEND_URL}/api/nftdrops/approved?droptype=${dropType}`;
        const response = await axios.get(url);
        const posts = response.data;

        if (posts.length === 0) {
            bot.sendMessage(chatId, 'No posts available.');
            return;
        }

        const latestPost = posts[0];
        const message = formatPostMessage(latestPost);
        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error fetching posts:', error);
        bot.sendMessage(chatId, `Error fetching posts: ${error.message}`);
    }
};

const formatPostMessage = (post) => {
    let message = `*${post.projectName}*\n`;
    message += `_${post.description || 'No description provided.'}_\n\n`;
    message += `*Drop Type:* ${post.dropType}\n`;
    message += `*Date:* ${post.date === 'TBA' ? 'TBA' : new Date(post.date).toLocaleDateString()}\n`;
    message += `*Time:* ${post.time}\n`;
    message += `*Supply:* ${post.supply}\n`;
    message += `*Likes:* ${post.likes.length}\n`;

    if (post.dropType === 'new mint') {
        message += `*Price:* ${post.price !== undefined ? post.price : 'N/A'}\n`;
        message += `*Whitelist Price:* ${post.wlPrice !== undefined ? post.wlPrice : 'N/A'}\n`;
    } else if (post.dropType === 'auction') {
        message += `*Starting Price:* ${post.startingPrice !== undefined ? post.startingPrice : 'N/A'}\n`;
        message += `*Marketplace Link:* ${post.marketplaceLink ? `[Link](${post.marketplaceLink})` : 'N/A'}\n`;
    } else if (post.dropType === 'airdrop') {
        message += `*Project Link:* ${post.projectLink ? `[Link](${post.projectLink})` : 'N/A'}\n`;
    }

    if (post.website) message += `*Website:* [Website](${post.website})\n`;
    if (post.xCom) message += `*X.com:* [X.com](${post.xCom})\n`;
    if (post.telegram) message += `*Telegram:* [Telegram](${post.telegram})\n`;
    if (post.discord) message += `*Discord:* [Discord](${post.discord})\n`;

    if (post.image) message += `\n![Image](${post.image})\n`;

    return message;
};

const startPolling = () => {
    setInterval(async () => {
        try {
            const url = `${process.env.BACKEND_URL}/api/nftdrops/approved`;
            console.log(`Polling data from: ${url}`);
            const response = await axios.get(url);
            const posts = response.data;

            if (posts.length > 0) {
                const latestPost = posts[0];

                if (latestPost._id !== latestPostId) {
                    console.log(`New post found: ${latestPost._id}`);
                    latestPostId = latestPost._id;

                    for (const chatId in channelConfig) {
                        const config = channelConfig[chatId];
                        const channelId = config.channelId;
                        const dropType = config.dropType;

                        if (dropType !== 'any' && latestPost.dropType !== dropType) {
                            console.log(`Skipping post of type ${latestPost.dropType} for chat ${chatId} with configured type ${dropType}`);
                            continue;
                        }

                        const message = formatPostMessage(latestPost);
                        console.log(`Sending post to channel ${channelId}`);
                        bot.sendMessage(channelId, message);
                    }
                }
            }
        } catch (error) {
            console.error('Error during polling:', error);
        }
    }, 60000);
};

startPolling();
