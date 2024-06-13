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
let userSteps = {}; // To track user steps
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
bot.onText(/\/setchannel(\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (match[2]) {
        // Directly set the channel and drop type if provided
        const [channelId, dropType] = match[2].split(' ');
        if (channelId && dropType) {
            await ChannelConfig.findOneAndUpdate(
                { chatId },
                { channelId, dropType },
                { upsert: true, new: true }
            );
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
        bot.sendMessage(chatId, messages, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error fetching posts:', error);
        bot.sendMessage(chatId, `Error fetching posts: ${error.message}`);
    }
});
const handleStepInput = async (chatId, input) => {
    const userStep = userSteps[chatId];
    if (userStep.step === 'setChannelId') {
        userSteps[chatId].channelId = input;
        bot.sendMessage(chatId, 'Please provide the drop type (new mint, auction, airdrop, any):');
        userSteps[chatId].step = 'setDropType';
    } else if (userStep.step === 'setDropType') {
        const channelId = userSteps[chatId].channelId;
        const dropType = input;
        await ChannelConfig.findOneAndUpdate(
            { chatId },
            { channelId, dropType },
            { upsert: true, new: true }
        );
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
        const posts = response.data.filter(post => post.dropType === dropType || dropType === 'any');
        if (posts.length === 0) {
            bot.sendMessage(chatId, 'No posts available.');
            return;
        }
        const latestPost = posts[0];
        const message = formatPostMessage(latestPost);
        bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error fetching posts:', error);
        bot.sendMessage(chatId, `Error fetching posts: ${error.message}`);
    }
};
const formatPostMessage = (post) => {
    let message = `<b>${escapeHtml(post.projectName)}</b>\n`;
    message += `<i>${escapeHtml(post.description || 'No description provided.')}</i>\n\n`;
    message += `<b>Drop Type:</b> ${escapeHtml(post.dropType)}\n`;
    message += `<b>Date:</b> ${post.date === 'TBA' ? 'TBA' : new Date(post.date).toLocaleDateString()}\n`;
    message += `<b>Time:</b> ${escapeHtml(post.time)}\n`;
    message += `<b>Supply:</b> ${escapeHtml(post.supply.toString())}\n`;
    message += `<b>Likes:</b> ${escapeHtml(post.likes.length.toString())}\n`;
    if (post.dropType === 'new mint') {
        message += `<b>Price:</b> ${post.price !== undefined ? escapeHtml(post.price.toString()) : 'N/A'}\n`;
        message += `<b>Whitelist Price:</b> ${post.wlPrice !== undefined ? escapeHtml(post.wlPrice.toString()) : 'N/A'}\n`;
    } else if (post.dropType === 'auction') {
        message += `<b>Starting Price:</b> ${post.startingPrice !== undefined ? escapeHtml(post.startingPrice.toString()) : 'N/A'}\n`;
        message += `<b>Marketplace Link:</b> ${post.marketplaceLink ? `<a href="${post.marketplaceLink}">Link</a>` : 'N/A'}\n`;
    } else if (post.dropType === 'airdrop') {
        message += `<b>Project Link:</b> ${post.projectLink ? `<a href="${post.projectLink}">Link</a>` : 'N/A'}\n`;
    }
    if (post.website) message += `<b>Website:</b> <a href="${post.website}">Website</a>\n`;
    if (post.xCom) message += `<b>X.com:</b> <a href="${post.xCom}">X.com</a>\n`;
    if (post.telegram) message += `<b>Telegram:</b> <a href="${post.telegram}">Telegram</a>\n`;
    if (post.discord) message += `<b>Discord:</b> <a href="${post.discord}">Discord</a>\n`;
    if (post.image) message += `\n<a href="${post.image}">Image</a>\n`;
    return message;
};
const escapeHtml = (text) => {
    return text.replace(/[&<>"']/g, function (match) {
        const escape = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escape[match];
    });
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
                        bot.sendMessage(channelId, message, { parse_mode: 'HTML' });
                    }
                }
            }
        } catch (error) {
            console.error('Error during polling:', error);
        }
    }, 60000);
};
startPolling();
