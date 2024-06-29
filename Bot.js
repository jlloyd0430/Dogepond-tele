const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// MongoDB setup
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const channelSchema = new mongoose.Schema({
    chatId: String,
    channelId: String,
    dropType: String,
});

const ChannelConfig = mongoose.model('ChannelConfig', channelSchema);

let latestPostId = null;

// Add handler to get the channel ID when a message is forwarded
bot.on('message', (msg) => {
    if (msg.forward_from_chat) {
        console.log('Forwarded message from channel. Channel ID:', msg.forward_from_chat.id);
        bot.sendMessage(msg.chat.id, `Channel ID: ${msg.forward_from_chat.id}`);
    }
});

bot.onText(/\/setchannel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const [channelId, dropType] = match[1].split(' ');

    try {
        await ChannelConfig.findOneAndUpdate(
            { chatId },
            { channelId, dropType },
            { upsert: true, new: true }
        );
        bot.sendMessage(chatId, `Set the post channel to ${channelId} for ${dropType} drops`);
    } catch (error) {
        console.error('Error setting channel:', error);
        bot.sendMessage(chatId, 'Failed to set the post channel.');
    }
});

bot.onText(/\/latest (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const dropType = match[1];

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

                    const channelConfigs = await ChannelConfig.find();
                    for (const config of channelConfigs) {
                        const { chatId, channelId, dropType } = config;

                        if (dropType !== 'any' && latestPost.dropType !== dropType) {
                            console.log(`Skipping post of type ${latestPost.dropType} for chat ${chatId} with configured type ${dropType}`);
                            continue;
                        }

                        const message = formatPostMessage(latestPost);
                        console.log(`Sending post to channel ${channelId}`);
                        bot.sendMessage(channelId, message).catch(err => {
                            console.error(`Failed to send message to channel ${channelId}:`, err.message);
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error during polling:', error);
        }
    }, 60000);
};

startPolling();
