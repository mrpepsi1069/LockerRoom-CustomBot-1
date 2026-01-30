// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Loaded command: ${command.data.name}`);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`🤖 ${client.user.tag} is online`);
    console.log(`📊 Servers: ${client.guilds.cache.size}`);
    client.user.setActivity('your team | /help', { type: ActivityType.Watching });
    await db.initialize();
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command || !command.autocomplete) return;
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(`Autocomplete error:`, error);
        }
        return;
    }
    
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('gametime_')) {
            await handleGametimeButton(interaction);
        } else if (interaction.customId.startsWith('times_')) {
            await handleTimesButton(interaction);
        }
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        if (db) {
            await db.logCommand(interaction.commandName, interaction.guildId, interaction.user.id);
        }
        await command.execute(interaction);
    } catch (error) {
        console.error(`❌ Command error:`, error);
        const errorMessage = { content: '❌ Error executing command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

client.on(Events.GuildCreate, async guild => {
    console.log(`✅ Joined: ${guild.name}`);
    await db.createGuild(guild.id, guild.name);
});

// Error handling for client
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

const PORT = 4000;


const server = http.createServer((req, res) => {
    // Set CORS headers
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = req.url;
   // Root endpoint - Basic stats
    if (url === '/api/stats') {
        const stats = {
            status: 'online',
            bot: client.user?.tag || 'Starting',
            guilds: client.guilds.cache.size,
            users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
            uptime: Math.floor(process.uptime()),
            version: '1.0.0'
        };
        res.writeHead(200);
        res.end(JSON.stringify(stats, null, 2));
        return;
    }


    // Guild list endpoint (public - shows basic info)
    if (url === '/api/guilds') {
        const guilds = Array.from(client.guilds.cache.values()).map(guild => ({
            name: guild.name,
            memberCount: guild.memberCount,
            id: guild.id.slice(0, 4) + '****' // Partial ID for privacy
        })).sort((a, b) => b.memberCount - a.memberCount); // Sort by size

        res.writeHead(200);
        res.end(JSON.stringify(guilds, null, 2));
        return;
    }

    // Health check endpoint
    if (url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ 
            status: client.user ? 'healthy' : 'starting',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // 404 for other routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});


server.listen(PORT, () => {
    console.log(`🌐 HTTP server on ${PORT}`);
});

process.on('unhandledRejection', error => console.error('❌ Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('❌ Uncaught exception:', error));

async function handleGametimeButton(interaction) {
    // Defer immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });
    
    const response = interaction.customId.split('_')[1];
    const message = interaction.message;
    const embed = message.embeds[0];
    if (!embed) {
        await interaction.editReply({ content: '❌ Error: Could not find embed data.' });
        return;
    }

    const canMakeField = embed.fields[0];
    const cantMakeField = embed.fields[1];
    const unsureField = embed.fields[2];

    let canMake = canMakeField.value === '• None yet' ? [] : canMakeField.value.split('• ').filter(u => u.trim()).map(u => u.trim());
    let cantMake = cantMakeField.value === '• None yet' ? [] : cantMakeField.value.split('• ').filter(u => u.trim()).map(u => u.trim());
    let unsure = unsureField.value === '• None yet' ? [] : unsureField.value.split('• ').filter(u => u.trim()).map(u => u.trim());

    const username = interaction.member.displayName;
    canMake = canMake.filter(u => u !== username);
    cantMake = cantMake.filter(u => u !== username);
    unsure = unsure.filter(u => u !== username);

    if (response === 'yes') canMake.push(username);
    else if (response === 'no') cantMake.push(username);
    else if (response === 'unsure') unsure.push(username);

    const formatList = (list) => list.length > 0 ? list.map(u => `• ${u}`).join('\n') : '• None yet';
    const newEmbed = EmbedBuilder.from(embed).setFields(
        { name: `✅ Can Make (${canMake.length})`, value: formatList(canMake), inline: false },
        { name: `❌ Can't Make (${cantMake.length})`, value: formatList(cantMake), inline: false },
        { name: `❓ Unsure (${unsure.length})`, value: formatList(unsure), inline: false }
    );

    await message.edit({ embeds: [newEmbed] });
    await interaction.editReply({ 
        content: `✅ Response recorded: **${response === 'yes' ? 'Can Make' : response === 'no' ? 'Can\'t Make' : 'Unsure'}**`
    });
}

async function handleTimesButton(interaction) {
    // Defer immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });
    
    const parts = interaction.customId.split('_');
    const timeIndex = parts[1];
    const selectedTime = parts.slice(2).join('_');
    const message = interaction.message;
    const embed = message.embeds[0];
    if (!embed) {
        await interaction.editReply({ content: '❌ Error: Could not find embed data.' });
        return;
    }

    const username = interaction.member.displayName;
    let description = embed.description;
    const lines = description.split('\n');
    const timeSections = [];
    let currentTime = null;
    let currentUsers = [];
    
    for (const line of lines) {
        if (line.startsWith('🕐 **')) {
            if (currentTime) timeSections.push({ time: currentTime, users: currentUsers });
            currentTime = line.replace('🕐 **', '').replace('**', '');
            currentUsers = [];
        } else if (line.startsWith('• ') && currentTime) {
            const users = line.substring(2).split('• ').map(u => u.trim()).filter(u => u && u !== 'None yet');
            currentUsers = users;
        }
    }
    if (currentTime) timeSections.push({ time: currentTime, users: currentUsers });
    
    timeSections.forEach(section => {
        section.users = section.users.filter(u => u !== username);
    });
    if (timeSections[timeIndex]) timeSections[timeIndex].users.push(username);
    
    const leagueLine = lines[0];
    let newDescription = leagueLine + '\n\n';
    timeSections.forEach(section => {
        newDescription += `🕐 **${section.time}**\n`;
        newDescription += section.users.length > 0 ? `• ${section.users.join(' • ')}\n\n` : `• None yet\n\n`;
    });
    
    const newEmbed = EmbedBuilder.from(embed).setDescription(newDescription.trim());
    await message.edit({ embeds: [newEmbed] });
    await interaction.editReply({ content: `✅ Selected time: **${selectedTime}**` });
}

// Login to Discord - with error handling
console.log('🔐 Attempting to login to Discord...');
console.log('🔍 Token exists:', !!process.env.DISCORD_TOKEN);
console.log('🔍 Token length:', process.env.DISCORD_TOKEN?.length || 0);

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in environment variables!');
    console.error('❌ Please add DISCORD_TOKEN to your Render environment variables');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('✅ Login successful, waiting for ready event...');
    })
    .catch(error => {
        console.error('❌ Failed to login to Discord:', error);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);
        console.error('❌ Check your DISCORD_TOKEN in environment variables');
        process.exit(1);
    });