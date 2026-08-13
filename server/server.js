const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const root = path.join(__dirname, "..", "client");
const httpServer = http.createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(root, requested);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const contentType = filePath.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(response);
});

const webSocketServer = new WebSocket.Server({ server: httpServer });
const players = new Map();
let game = { started: false, hands: new Map(), turn: 1, lastPlay: null };

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return [...suits.flatMap((suit) => ranks.map((rank) => ({ suit, rank, value: ranks.indexOf(rank) + 1 }))),
    { suit: "", rank: "小王", value: 14, joker: true }, { suit: "", rank: "大王", value: 15, joker: true }];
}

function shuffle(cards) { return cards.sort(() => Math.random() - 0.5); }
function publicState() {
  return { type: "state", count: players.size, started: game.started, turn: game.turn,
    lastPlay: game.lastPlay, players: [...players.values()].map((number) => ({ player: number, cards: game.hands.get(number)?.length || 0 })) };
}
function sendState() { const state = publicState(); for (const socket of players.keys()) socket.send(JSON.stringify(state)); }
function sendHand(socket, number) { socket.send(JSON.stringify({ type: "hand", cards: game.hands.get(number) || [] })); }
function startGame() {
  const deck = shuffle(createDeck()); game = { started: true, hands: new Map(), turn: 1, lastPlay: null };
  for (let number = 1; number <= 3; number += 1) game.hands.set(number, deck.splice(0, 18));
  for (const [socket, number] of players) { socket.send(JSON.stringify({ type: "started" })); sendHand(socket, number); }
  sendState();
}

webSocketServer.on("connection", (socket) => {
  if (players.size >= 3) { socket.send(JSON.stringify({ type: "full" })); socket.close(); return; }
  const number = players.size + 1; players.set(socket, number);
  socket.send(JSON.stringify({ type: "welcome", player: number })); sendState();
  if (players.size === 3 && !game.started) startGame();
  socket.on("message", (raw) => {
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.type !== "play" || !game.started || number !== game.turn) return;
    const hand = game.hands.get(number) || []; const index = Number(message.index);
    if (!Number.isInteger(index) || !hand[index]) return;
    const card = hand[index];
    if (card.joker && !["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].includes(message.asRank)) return;
    hand.splice(index, 1); game.lastPlay = { player: number, card: { ...card, chosenRank: card.joker ? message.asRank : null } };
    game.turn = (number % 3) + 1; sendState();
    for (const [client, owner] of players) sendHand(client, owner);
    if (hand.length === 0) { game.started = false; for (const client of players.keys()) client.send(JSON.stringify({ type: "winner", player: number })); }
  });
  socket.on("close", () => { players.delete(socket); game = { started: false, hands: new Map(), turn: 1, lastPlay: null }; sendState(); });
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, "0.0.0.0", () => console.log(`Card game running on port ${port}`));
