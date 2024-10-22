const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const maxPlayers = 6;
const minPlayers = 2; // Zmieniono minimalną liczbę graczy na 2
const cardsPerPlayer = 5;

let lobby = {
    players: [],
    gameStarted: false,
    currentPlayerIndex: 0,
    currentGameCard: '',
    playedCardsCount: 0
};

let shutdownTimer = null;

function broadcastToAll(message) {
    lobby.players.forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

function updateLobby() {
    const playerList = lobby.players.map(player => ({
        nick: player.nick,
        avatar: player.avatar,
        position: player.position
    }));
    broadcastToAll({ 
        type: 'lobbyUpdate', 
        players: playerList,
        playerCount: lobby.players.length 
    });
}

function startGame() {
    if (lobby.players.length < minPlayers || lobby.players.length > maxPlayers) {
        return;
    }
    lobby.gameStarted = true;
    const deck = createDeck();
    lobby.currentGameCard = chooseRandomCard();
    lobby.players.forEach((player, index) => {
        const cards = dealCards(deck, cardsPerPlayer);
        player.cards = cards;
        player.isActive = true;
        player.ws.send(JSON.stringify({ 
            type: 'gameStart', 
            cards: cards, 
            position: player.position,
            currentGameCard: lobby.currentGameCard
        }));
    });
    lobby.currentPlayerIndex = Math.floor(Math.random() * lobby.players.length);
    updateGameState();
}

function chooseRandomCard() {
    const cards = ['Q', 'K', 'A'];
    return cards[Math.floor(Math.random() * cards.length)];
}

function updateGameState() {
    if (!lobby.gameStarted) {
        return;
    }
    const activePlayers = lobby.players.filter(player => player.isActive);
    const gameState = {
        type: 'gameStateUpdate',
        currentPlayer: activePlayers[lobby.currentPlayerIndex].nick,
        currentGameCard: lobby.currentGameCard,
        players: activePlayers.map(player => ({
            nick: player.nick,
            position: player.position,
            cardCount: player.cards.length
        })),
        playedCardsCount: lobby.playedCardsCount
    };
    broadcastToAll(gameState);
}

function createDeck() {
    const values = ['Q', 'K', 'A'];
    const deck = [];
    for (let value of values) {
        for (let i = 0; i < 36; i++) {
            deck.push(value);
        }
    }
    for (let i = 0; i < 4; i++) {
        deck.push('joker');
    }
    return shuffle(deck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function dealCards(deck, count) {
    return deck.splice(0, count);
}

function getNextActivePlayerIndex(currentIndex) {
    const activePlayers = lobby.players.filter(player => player.isActive);
    return (currentIndex + 1) % activePlayers.length;
}

function checkServerShutdown() {
    if (lobby.players.length === 0) {
        if (shutdownTimer === null) {
            console.log('Wszyscy gracze opuścili serwer. Rozpoczęcie odliczania do wyłączenia...');
            shutdownTimer = setTimeout(() => {
                console.log('Serwer zostanie wyłączony za 2 minuty bezczynności.');
                server.close(() => {
                    console.log('Serwer został wyłączony.');
                    process.exit(0);
                });
            }, 2 * 60 * 1000); // 2 minuty
        }
    } else {
        if (shutdownTimer !== null) {
            clearTimeout(shutdownTimer);
            shutdownTimer = null;
            console.log('Odliczanie do wyłączenia zostało anulowane. Gracze są nadal aktywni.');
        }
    }
}

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'joinLobby':
                if (lobby.players.length < maxPlayers) {
                    const existingPlayer = lobby.players.find(p => p.nick === data.nick);
                    if (existingPlayer) {
                        existingPlayer.ws = ws;
                        existingPlayer.isActive = true;
                    } else {
                        lobby.players.push({
                            ws,
                            nick: data.nick,
                            avatar: data.avatar,
                            isActive: true,
                            position: lobby.players.length + 1
                        });
                    }
                    updateLobby();
                }
                ws.send(JSON.stringify({
                    type: 'lobbyInfo',
                    players: lobby.players.map(p => ({
                        nick: p.nick,
                        avatar: p.avatar,
                        position: p.position
                    })),
                    gameStarted: lobby.gameStarted
                }));
                checkServerShutdown();
                break;
            case 'startGame':
                if (!lobby.gameStarted && lobby.players.length >= minPlayers) {
                    startGame();
                }
                break;
            case 'playCards':
                if (lobby.gameStarted) {
                    const activePlayers = lobby.players.filter(player => player.isActive);
                    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
                    if (currentPlayer.ws === ws) {
                        currentPlayer.cards = currentPlayer.cards.filter(card => !data.cards.includes(card));
                        lobby.playedCardsCount += data.cards.length;
                        broadcastToAll({ type: 'cardPlayed', count: data.cards.length, player: currentPlayer.nick });
                        lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                        updateGameState();
                    }
                }
                break;
            case 'accuse':
                if (lobby.gameStarted) {
                    const activePlayers = lobby.players.filter(player => player.isActive);
                    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
                    if (currentPlayer.ws === ws) {
                        broadcastToAll({ type: 'accusation', player: currentPlayer.nick });
                        // Tutaj dodaj logikę sprawdzania oskarżenia i aktualizacji stanu gry
                        updateGameState();
                    }
                }
                break;
            case 'requestGameState':
                if (lobby.gameStarted) {
                    updateGameState();
                }
                break;
        }
    });

    ws.on('close', () => {
        const playerIndex = lobby.players.findIndex(p => p.ws === ws);
        if (playerIndex !== -1) {
            lobby.players[playerIndex].isActive = false;
            if (lobby.gameStarted) {
                lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                updateGameState();
            } else {
                lobby.players.splice(playerIndex, 1);
                lobby.players.forEach((p, i) => p.position = i + 1);
                updateLobby();
            }
        }
        checkServerShutdown();
    });
});

const port = 8080;
server.listen(port, () => {
    console.log(`Serwer uruchomiony na porcie ${port}`);
});
