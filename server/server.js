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
const rankValue = { A: 14, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
function classify(cards) {
  const values = cards.map((card) => rankValue[card.chosenRank || card.rank]).sort((a, b) => a - b);
  const same = values.every((value) => value === values[0]);
  if (cards.length === 4 && same) return { type: "star", level: 5, value: values[0] };
  if (cards.length === 3 && values[0] === 14 && values[1] === 4 && values[2] === 4) return { type: "pierce", level: 4, value: 14 };
  if (cards.length === 3 && same && values[0] === 12) return { type: "cannon", level: 3, value: 12 };
  if (cards.length === 3 && same && values[0] === 6) return { type: "smallCannon", level: 2, value: 6 };
  if (same && cards.length === 3) return { type: "triple", level: 1, value: values[0] };
  if (same && cards.length === 2) return { type: "pair", level: 1, value: values[0] };
  if (cards.length >= 3 && values.every((value, index) => index === 0 || value === values[index - 1] + 1) && !values.includes(15)) return { type: `straight${cards.length}`, level: 1, value: values.at(-1) };
  if (cards.length === 1) return { type: "single", level: 1, value: values[0] };
  return null;
}
function canBeat(previous, next) { return !previous || next.level > previous.level || (next.level === previous.level && next.type === previous.type && next.value > previous.value); }
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
    const hand = game.hands.get(number) || []; const indexes = Array.isArray(message.indexes) ? message.indexes : [message.index];
    if (!indexes.length || indexes.some((index) => !Number.isInteger(index) || !hand[index])) return;
    const selected = indexes.map((index) => ({ ...hand[index] }));
    const chosenRank = message.asRank;
    if (selected.some((card) => card.joker) && !chosenRank) return;
    selected.forEach((card) => { if (card.joker) card.chosenRank = chosenRank; });
    const combo = classify(selected);
    if (!combo || !canBeat(game.lastPlay?.combo, combo)) return;
    indexes.sort((a, b) => b - a).forEach((index) => hand.splice(index, 1));
    game.lastPlay = { player: number, cards: selected, combo };
    game.turn = (number % 3) + 1; sendState();
    for (const [client, owner] of players) sendHand(client, owner);
    if (hand.length === 0) { game.started = false; for (const client of players.keys()) client.send(JSON.stringify({ type: "winner", player: number })); }
  });
  socket.on("close", () => { players.delete(socket); game = { started: false, hands: new Map(), turn: 1, lastPlay: null }; sendState(); });
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, "0.0.0.0", () => console.log(`Card game running on port ${port}`));
