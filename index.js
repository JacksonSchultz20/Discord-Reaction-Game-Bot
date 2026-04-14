const { Client, GatewayIntentBits, Partials, Guild } = require('discord.js');
require('dotenv').config();
const fs = require('fs')

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

const TOKEN = process.env.TOKEN;
client.login(TOKEN);

const leaderboardChannelId = process.env.LEADERBOARD_CHANNEL_ID;
const logsChannelId = process.env.LOGS_CHANNEL_ID;
const TEAM_LEADER_ROLE_ID = process.env.TEAM_LEADER_ROLE_ID;
const TEAM1_ROLE_ID = process.env.TEAM1_ROLE_ID
const TEAM2_ROLE_ID = process.env.TEAM2_ROLE_ID
const BOT_COMMANDS_CHANNEL_ID = process.env.BOT_COMMANDS_CHANNEL_ID
const gameChannels = process.env.GAME_CHANNEL_IDS.split(',')

let team1Name = 'Gardeners';
let team2Name = 'Beekeepers';

let players = new Map();
let teams = {
    team1: { score: 0, members: 0},
    team2: { score: 0, members: 0}
}

function loadData(){
    if (!fs.existsSync('data.json')) return;

    const raw = fs.readFileSync('data.json');
    const data = JSON.parse(raw);

    players = new Map(Object.entries(data.players));
    teams = data.teams;
    updateLeaderboard();
}

function saveData(){
    const data = {
        players: Object.fromEntries(players),
        teams: teams
    };

    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

let gameRunning = false;

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

let leaderboardMessage;

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const channel = await client.channels.fetch(leaderboardChannelId)

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId('join_team')
        .setLabel('Join Team')
        .setStyle(ButtonStyle.Primary)
    );

    leaderboardMessage = await channel.send({
        content: 'Click to join a team!',
        components: [row]
    });

});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateLeaderboard(){
    const sortedPlayers = [...players.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0,10)
    
    let leaderboardText = '```\n'; //Start the block
    leaderboardText += '** Leaderboard (Top 10) **\n\n';

    for (let i = 0; i < sortedPlayers.length; i++){
        const [id, data] = sortedPlayers[i];

        let username = id;
        try {
            const member = await client.users.fetch(id);
            username = member.username;
        } catch (err) {
            console.log(`Could not fetch username for ${id}:`, err);
        }

        leaderboardText += `${i + 1}. ${data.teamName.padEnd(6)} | <@${username}> - ${data.score} pts\n`;
    }

    leaderboardText += `\n**Team Scores**\n`;
    leaderboardText += `${team1Name}: ${teams.team1.score} pts\n`;
    leaderboardText += `${team2Name}: ${teams.team2.score} pts\n`;
    leaderboardText += '```'; //End the block

    if (leaderboardMessage){
        leaderboardMessage.edit({ content: leaderboardText })
    }
}

let nextTeam = 'team1';
loadData()

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'join_team'){
        const userId = interaction.user.id;

        if (players.has(userId)){
            return interaction.reply({ content: 'You are already on a team!', ephemeral: true });
        }

        const team = nextTeam;
        const teamName = team === 'team1' ? team1Name : team2Name;

        const member = await interaction.guild.members.fetch(userId);

        const roleId = team === 'team1'
            ? TEAM1_ROLE_ID
            : TEAM2_ROLE_ID;
        
        await member.roles.add(roleId).catch(err => {
            console.log('Failed to add role:', err);
        });

        players.set(userId, {
            team,
            score: 0,
            teamName
        });

        teams[team].members++;

        saveData();

        //Alternate team
        nextTeam = team === 'team1' ? 'team2' : 'team1';

        await interaction.reply({
            content: `You joined ${teamName}!`,
            ephemeral: true
        });

        updateLeaderboard();
    }
})

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const teamLeadCommands = ['!startround', '!stopround', '!resetgame']
    const member = message.member;
    const isTeamLead = member.roles.cache.has(TEAM_LEADER_ROLE_ID)

    if (teamLeadCommands.includes(message.content)){
        if (!isTeamLead){
            return;
        }
    }

    if (message.content === '!myscore'){
        if (message.channel.id !== BOT_COMMANDS_CHANNEL_ID){
            return;
        }

        const userId = message.author.id;
        const player = players.get(userId);

        if (!player){
            return message.reply('You are not on a team!');
        }

        return message.reply(
            `You are on ${player.teamName} and have ${player.score} points.`
        )
    }

    if (message.content === '!startround') {
        if (gameRunning){
            return message.channel.send('Game is aleady running!');
        }

        gameRunning = true

        while (gameRunning) {
            //const isTrap = Math.random() < 0.25 //25% chance for trap
            const roll = Math.random()
            //console.log(`Rolled a ${roll}`);

            const isTrap = roll < 0.25; //25 % chance for trap
            const isBonus = roll >= 0.25 && roll < 0.35; // next 10%
            let emoji = '🌻'; //default 
            let trapEmoji = '🐝'; 
            let bonusEmoji = '🦋';
            let messageText;
            let reactionEmoji;


            const randomChannelId = gameChannels[Math.floor(Math.random() * gameChannels.length)];
            const channel = await client.channels.fetch(randomChannelId);

            if (isTrap){
                messageText = `React with ${trapEmoji} NOW!`;
                reactionEmoji = trapEmoji;
            } else if (isBonus) {
                messageText = `React with ${bonusEmoji} NOW! (+5 points!)`;
                reactionEmoji = bonusEmoji;
            } else {
                messageText = `React with ${emoji} NOW!`;
                reactionEmoji = emoji;
            }
            
            const gameMessage = await channel.send(messageText);
            const startTime = Date.now();
            await gameMessage.react(reactionEmoji);            

            //const gameMessage = await channel.send(isTrap ? `React with ${trapEmoji} NOW!` : 'React with 👍 NOW!');
            //await gameMessage.react(isTrap ? trapEmoji : emoji);

            const filter = (reaction, user) => {
                if (isTrap) return reaction.emoji.name === trapEmoji;
                if (isBonus) return reaction.emoji.name === bonusEmoji;
                return reaction.emoji.name === emoji && !user.bot;
            };

            try {
                const collected = await gameMessage.awaitReactions({
                    filter,
                    max: 1,
                    time: 30000,
                    errors: ['time'],
                });

                const reaction = collected.first();
                const user = reaction.users.cache.filter(u => !u.bot).first();
                const reactionSpeed = Date.now() - startTime;

                //channel.send(`${user} was the fastest!`);

                const player = players.get(user.id);

                if (!player) {
                    await gameMessage.delete();
                    const infoMessage = await channel.send(`${user} reacted first but is not on a team!`);
                    setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                    //Send to logs channel
                    const logsChannel = await client.channels.fetch(logsChannelId);
                    await logsChannel.send(`[LOG] ${user.tag} reacted first in <#${channel.id}> but is not on a team.`);

                    const delay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
                    await sleep(delay)
                    continue;
                } else {
                    if (isTrap){
                        player.score -= 1;
                        teams[player.team].score -= 1;

                        const infoMessage = await channel.send(`${user} reacted with the trap in ${reactionSpeed}ms (-1 point for ${player.teamName})`);
                        setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                        const logsChannel = await client.channels.fetch(logsChannelId);
                        await logsChannel.send(`[LOG] ${user.tag} reacted to the trap first in <#${channel.id}> and lost a point for ${player.teamName}. Reaction time: ${reactionSpeed}ms.`);
                    } else if (isBonus){
                        player.score += 5;
                        teams[player.team].score += 5;

                        const infoMessage = await channel.send(`${user} got the bonus in ${reactionSpeed}ms! (+5 points for ${player.teamName})`);
                        setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                        const logsChannel = await client.channels.fetch(logsChannelId);
                        await logsChannel.send(`[LOG] ${user.tag} reacted to the bonus first in <#${channel.id}> and got +5 points for ${player.teamName}. Reaction time: ${reactionSpeed}ms.`);
                    } else {
                        player.score += 1;
                        teams[player.team].score += 1;
                        
                        const infoMessage = await channel.send(`${user} was the fastest in ${reactionSpeed}ms! (+1 point for ${player.teamName})`);
                        setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                        const logsChannel = await client.channels.fetch(logsChannelId);
                        await logsChannel.send(`[LOG] ${user.tag} reacted first in <#${channel.id}> and scored for ${player.teamName}. Reaction time: ${reactionSpeed}ms.`);
                    }
                    saveData();
                    updateLeaderboard();
                }


            } catch (err) {
                //console.log(err);
                //const infoMessage = await channel.send(`No one reacted in time!`);
                //setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                const logsChannel = await client.channels.fetch(logsChannelId);
                await logsChannel.send(`[LOG] Message Missed in <#${channel.id}>.`);
            }

            try {
                await gameMessage.delete();
            } catch (err) {
                console.log('Could not delete game message:', err);
            }

            const delay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;

            await sleep(delay)
        }
    }

    if (message.content === '!stopround'){
        if (!gameRunning){
            return message.channel.send('Game is not running!');
        }

        gameRunning = false;

        return message.channel.send('Stopping game');
    }

    if (message.content === '!resetgame'){
        players = new Map();
        teams = {
            team1: { score: 0, members: 0},
            team2: { score: 0, members: 0}
        }

        saveData();
        message.channel.send('Game has been reset!');

        const channel = await client.channels.fetch(leaderboardChannelId); 
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
            .setCustomId('join_team')
            .setLabel('Join Team')
            .setStyle(ButtonStyle.Primary)
        );

        leaderboardMessage = await channel.send({
            content: 'Click to join a team!',
            components: [row]
        });

        updateLeaderboard(); 
    }
});