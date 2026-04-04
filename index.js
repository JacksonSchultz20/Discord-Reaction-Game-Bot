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
const gameChannels = process.env.GAME_CHANNEL_IDS.split(',')

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
}

function saveData(){
    const data = {
        players: Object.fromEntries(players),
        teams: teams
    };

    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

loadData()
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

        leaderboardText += `${i + 1}. ${data.team.padEnd(6)} | <@${username}> - ${data.score} pts\n`;
    }

    leaderboardText += `\n**Team Scores**\n`;
    leaderboardText += `Team 1: ${teams.team1.score} pts\n`;
    leaderboardText += `Team 2: ${teams.team2.score} pts\n`;
    leaderboardText += '```'; //End the block

    if (leaderboardMessage){
        leaderboardMessage.edit({ content: leaderboardText })
    }
}

let nextTeam = 'team1';

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'join_team'){
        const userId = interaction.user.id;

        if (players.has(userId)){
            return interaction.reply({ content: 'You are already on a team!', ephemeral: true });
        }

        const team = nextTeam;

        players.set(userId, {
            team,
            score: 0
        });

        teams[team].members++;

        saveData();

        //Alternate team
        nextTeam = team === 'team1' ? 'team2' : 'team1';

        await interaction.reply({
            content: `You joined ${team}!`,
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

    if (message.content === '!startround') {
        if (gameRunning){
            return message.channel.send('Game is aleady running!');
        }

        gameRunning = true

        while (gameRunning) {
            const isTrap = Math.random() < 0.25 //25% chance for trap
            let emoji = '👍'; //default 
            let trapEmoji = '👎'; 


            const randomChannelId = gameChannels[Math.floor(Math.random() * gameChannels.length)];
            const channel = await client.channels.fetch(randomChannelId);

            const gameMessage = await channel.send(isTrap ? `React with ${trapEmoji} NOW!` : 'React with 👍 NOW!');
            await gameMessage.react(isTrap ? trapEmoji : emoji);

            const filter = (reaction, user) => {
                if (isTrap) return reaction.emoji.name === trapEmoji;
                return reaction.emoji.name === '👍' && !user.bot;
            };

            try {
                const collected = await gameMessage.awaitReactions({
                    filter,
                    max: 1,
                    time: 10000,
                    errors: ['time'],
                });

                const reaction = collected.first();
                const user = reaction.users.cache.filter(u => !u.bot).first();

                //channel.send(`${user} was the fastest!`);

                const player = players.get(user.id);

                if (!player) {
                    const infoMessage = await channel.send(`${user} reacted first but is not on a team!`);
                    setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                    //Send to logs channel
                    const logsChannel = await client.channels.fetch(logChannelId);
                    await logsChannel.send(`[LOG] ${user.tag} reacted first in <#${channel.id}> but is not on a team.`);

                    const delay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
                    await sleep(delay)
                    continue;
                } else {
                    if (isTrap){
                        player.score -= 1;
                        teams[player.team].score -= 1;

                        const infoMessage = await channel.send(`${user} reacted with the trap (-1 point for ${player.team})`);
                        setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                        const logsChannel = await client.channels.fetch(logsChannelId);
                        await logsChannel.send(`[LOG] ${user.tag} reacted to the trap first in <#${channel.id}> and lost a point for ${player.team}.`);
                    } else {
                        player.score += 1;
                        teams[player.team].score += 1;
                        
                        const infoMessage = await channel.send(`${user} was the fastest! (+1 point for ${player.team})`);
                        setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

                        const logsChannel = await client.channels.fetch(logsChannelId);
                        await logsChannel.send(`[LOG] ${user.tag} reacted first in <#${channel.id}> and scored for ${player.team}.`);
                    }
                    updateLeaderboard();

                }


            } catch (err) {
                    const infoMessage = await channel.send(`No one reacted in time!`);
                    setTimeout(() => infoMessage.delete().catch(() => {}), 5000);

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