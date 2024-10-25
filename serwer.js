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
    startingCard: '', // Ta zmienna będzie przechowywać wylosowaną kartę
    playedCardsCount: 0,
    lastPlayedCards: [],
    lastPlayerWhoPlayedCards: '',
    playersWithoutCards: 0 // Zmienna przechowująca liczbę graczy bez kart
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
    lobby.startingCard = chooseRandomCard(); // Losujemy kartę na początku gry
    lobby.players.forEach((player, index) => {
        const cards = dealCards(deck, cardsPerPlayer);
        player.cards = cards;
        player.isActive = true;
        player.isAlive = true; // Nowa zmienna określająca czy gracz jest żywy
        player.randomNumber = Math.floor(Math.random() * 6) + 1; // Losowa liczba od 1 do 6
        player.roundNumber = 0; // Inicjalizacja roundNumber dla każdego gracza
        player.ws.send(JSON.stringify({ 
            type: 'gameStart', 
            cards: cards, 
            position: player.position,
            startingCard: lobby.startingCard, // Wysyłamy wylosowaną kartę do klienta
            roundNumber: player.roundNumber, // Wysyłamy roundNumber jako liczbę tylko na początku gry
            players: lobby.players.map(p => ({
                nick: p.nick,
                avatar: p.avatar,
                position: p.position
            }))
        }));
    });
    lobby.currentPlayerIndex = Math.floor(Math.random() * lobby.players.length);
    lobby.lastPlayedCards = [];
    lobby.lastPlayerWhoPlayedCards = '';
    lobby.playersWithoutCards = 0; // Resetowanie liczby graczy bez kart na początku gry
    updateGameState();
    startNextTurn();
}

function chooseRandomCard() {
    const cards = ['A', 'Q', 'K'];
    return cards[Math.floor(Math.random() * cards.length)];
}

function updateGameState() {
    if (!lobby.gameStarted) {
        return;
    }
    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
    const gameState = {
        type: 'gameStateUpdate',
        currentPlayer: activePlayers[lobby.currentPlayerIndex].nick,
        startingCard: lobby.startingCard, // Upewniamy się, że ta wartość jest poprawnie ustawiona
        players: lobby.players.map(player => ({
            nick: player.nick,
            position: player.position,
            cardCount: player.cards.length,
            isActive: player.isActive && player.cards.length > 0,
            isAlive: player.isAlive // Dodajemy informację o tym, czy gracz jest żywy
        })),
        playedCardsCount: lobby.playedCardsCount,
        lastPlayedCards: lobby.lastPlayedCards,
        lastPlayerWhoPlayedCards: lobby.lastPlayerWhoPlayedCards,
        playersWithoutCards: lobby.playersWithoutCards
    };
    broadcastToAll(gameState);
}

function createDeck() {
    const values = ['Q', 'K', 'A'];
    const deck = [];
    for (let value of values) {
        for (let i = 0; i < 8; i++) {
            deck.push(value);
        }
    }
    for (let i = 0; i < 6; i++) {
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
    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
    return (currentIndex + 1) % activePlayers.length;
}

function startNextTurn() {
    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
    if (activePlayers.length === 0) {
        endGame();
        return;
    }
    if (activePlayers.length === 1) {
        currentPlayer.roundNumber++; // Zwiększamy numer rundy dla aktualnego gracza
        console.log(` ${currentPlayer.roundNumber}`);
        const accusedPlayer = lobby.players.find(p => p.nick === lobby.lastPlayerWhoPlayedCards);
        if (accusedPlayer && currentPlayer.roundNumber + 1 === accusedPlayer.randomNumber) {
            accusedPlayer.isAlive = false; // Gracz staje się martwy
            broadcastToAll({
                type: 'playerDied',
                player: accusedPlayer.nick
            });
        }
        broadcastToAll({ 
            type: 'accusation', 
            player: currentPlayer.nick,
            lastPlayedCards: lobby.lastPlayedCards,
            lastPlayerWhoPlayedCards: lobby.lastPlayerWhoPlayedCards,
            startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
        });
        updateGameState();
        lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
        endGame();
        return;
    }

    currentPlayer.ws.send(JSON.stringify({ 
        type: 'yourTurn',
        startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
    }));
    broadcastToAll({ 
        type: 'turnUpdate', 
        currentPlayer: currentPlayer.nick,
        startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
    });
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
            }, 2 * 60 * 1000);
        }
    } else {
        if (shutdownTimer !== null) {
            clearTimeout(shutdownTimer);
            shutdownTimer = null;
            console.log('Odliczanie do wyłączenia zostało anulowane. Gracze są nadal aktywni.');
        }
    }
}

function endGame() {
    broadcastToAll({ type: 'gameEnd' });
    lobby.gameStarted = false;
    lobby.players.forEach(player => {
        player.cards = [];
        player.isActive = true;
        player.isAlive = true; // Resetujemy stan życia gracza
        player.randomNumber = 0; // Resetujemy losową liczbę
        player.roundNumber = 0; // Resetujemy numer rundy dla gracza
    });
    lobby.currentPlayerIndex = 0;
    lobby.startingCard = '';
    lobby.playedCardsCount = 0;
    lobby.lastPlayedCards = [];
    lobby.lastPlayerWhoPlayedCards = '';
    lobby.playersWithoutCards = 0;
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
                        existingPlayer.isAlive = true; // Ustawiamy gracza jako żywego
                    } else {
                        lobby.players.push({
                            ws,
                            nick: data.nick,
                            avatar: data.avatar,
                            isActive: true,
                            isAlive: true, // Nowy gracz jest żywy
                            position: lobby.players.length + 1,
                            cards: [],
                            randomNumber: Math.floor(Math.random() * 6) + 1, // Inicjalizujemy losową liczbę od 1 do 6
                            roundNumber: 0 // Inicjalizujemy roundNumber jako 0
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
                    gameStarted: lobby.gameStarted,
                    startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
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
                    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
                    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
                    if (currentPlayer.ws === ws) {
                        data.cards.forEach(card => {
                            const cardIndex = currentPlayer.cards.indexOf(card);
                            if (cardIndex !== -1) {
                                currentPlayer.cards.splice(cardIndex, 1);
                            }
                        });
                        lobby.playedCardsCount += data.cards.length;
                        lobby.lastPlayedCards = data.cards;
                        lobby.lastPlayerWhoPlayedCards = currentPlayer.nick;
                        broadcastToAll({ 
                            type: 'cardPlayed', 
                            count: data.cards.length, 
                            player: currentPlayer.nick, 
                            cards: data.cards,
                            lastPlayerWhoPlayedCards: currentPlayer.nick,
                            startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
                        });
                        console.log(`gracz ma ${currentPlayer.cards.length}`);
                        if (currentPlayer.cards.length === 0) {
                            currentPlayer.isActive = false;
                            lobby.playersWithoutCards++;
                        }
                        lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                        updateGameState();
                        startNextTurn();
                    }
                }
                break;
            case 'accuse':
                if (lobby.gameStarted) {
                    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
                    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
                    if (currentPlayer.ws === ws) {
                        const accusedPlayer = lobby.players.find(p => p.nick === lobby.lastPlayerWhoPlayedCards);
                        const lastPlayedCardsCorrect = lobby.lastPlayedCards.some(card => card === lobby.startingCard || card === 'joker');
                        
                        if (lastPlayedCardsCorrect) {
                            currentPlayer.roundNumber++; // Zwiększamy numer rundy dla oskarżającego gracza
                        } else if (accusedPlayer) {
                            accusedPlayer.roundNumber++; // Zwiększamy numer rundy dla oskarżonego gracza
                        }
                        
                        if (accusedPlayer && currentPlayer.roundNumber + 1 === accusedPlayer.randomNumber) {
                            accusedPlayer.isAlive = false; // Gracz staje się martwy
                            broadcastToAll({
                                type: 'playerDied',
                                player: accusedPlayer.nick
                            });
                        }
                        broadcastToAll({ 
                            type: 'accusation', 
                            player: currentPlayer.nick,
                            lastPlayedCards: lobby.lastPlayedCards,
                            lastPlayerWhoPlayedCards: lobby.lastPlayerWhoPlayedCards,
                            startingCard: lobby.startingCard // Dodajemy informację o aktualnej karcie gry
                        });
                        updateGameState();
                        lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                        startNextTurn();
                    }
                }
                break;
            case 'requestGameState':
                if (lobby.gameStarted) {
                    updateGameState();
                }
                break;
            case 'endTurn':
                if (lobby.gameStarted) {
                    const activePlayers = lobby.players.filter(player => player.isActive && player.cards.length > 0);
                    const currentPlayer = activePlayers[lobby.currentPlayerIndex];
                    if (currentPlayer.ws === ws) {
                        lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                        updateGameState();
                        startNextTurn();
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        const playerIndex = lobby.players.findIndex(p => p.ws === ws);
        if (playerIndex !== -1) {
            lobby.players[playerIndex].isActive = false;
            lobby.players[playerIndex].isAlive = false; // Ustawiamy gracza jako nieżywego po rozłączeniu
            if (lobby.gameStarted) {
                lobby.currentPlayerIndex = getNextActivePlayerIndex(lobby.currentPlayerIndex);
                updateGameState();
                startNextTurn();
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
