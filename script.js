"use strict";

var selectedsquare = null;
var game = new Chess();
var board = Chessboard("chessboard", {
    draggable: false,
    position: "start",
    onSnapEnd: function() { return board.position(game.fen(), false); }
});

// --- CLOCK VARIABLES ---
var whiteTime = 300, blackTime = 300;
var whiteIncrement = 0, blackIncrement = 0;
var timerInterval = null, firstMoveMade = false, isPaused = false;
var lastTickTime = Date.now(), botTimeoutId = null, pauseStartTime = 0;

// --- CLOCK FUNCTIONS ---
function formatTime(seconds) {
    var isNeg = seconds < 0;
    seconds = Math.abs(seconds);
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return (isNeg ? "-" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function updateClockDisplay() {
    var wClock = document.getElementById("white-clock");
    var bClock = document.getElementById("black-clock");
    if (wClock) {
        wClock.textContent = formatTime(whiteTime);
        wClock.style.color = (game.turn() === 'w' && timerInterval && !isPaused) ? "red" : "black";
    }
    if (bClock) {
        bClock.textContent = formatTime(blackTime);
        bClock.style.color = (game.turn() === 'b' && timerInterval && !isPaused) ? "red" : "black";
    }
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; updateClockDisplay(); }
}

function startTimer() {
    stopTimer(); 
    updateClockDisplay();
    timerInterval = setInterval(function() {
        if (game.game_over() || isPaused) return;
        var now = Date.now();
        var elapsed = Math.floor((now - lastTickTime) / 1000);
        if (elapsed > 0) {
            if (game.turn() === 'w') whiteTime -= elapsed; else blackTime -= elapsed;
            lastTickTime += elapsed * 1000; // Preserve fractional seconds to prevent drift
            
            if (whiteTime <= 0) { document.getElementById("title").textContent = "Black Wins on Time!"; }
            if (blackTime <= 0) { document.getElementById("title").textContent = "White Wins on Time!"; }
            updateClockDisplay();
        }
    }, 250);
}

function applyClockSettings() {
    whiteTime = (parseInt(document.getElementById("white-start-time").value, 10) || 0) * 60;
    whiteIncrement = parseInt(document.getElementById("white-increment").value, 10) || 0;
    blackTime = (parseInt(document.getElementById("black-start-time").value, 10) || 0) * 60;
    blackIncrement = parseInt(document.getElementById("black-increment").value, 10) || 0;
    firstMoveMade = false;
    stopTimer();
    updateClockDisplay();
}

// --- MODE & BOT LOGIC ---
function getColorName(c) { return c === 'w' ? 'white' : 'black'; }
function getMode(c) { 
    var checked = document.querySelector('input[name="' + getColorName(c) + '-mode"]:checked');
    return checked ? checked.id : (getColorName(c) + "-human");
}

function checkAndTriggerBot() {
    if (game.game_over() || isPaused) return;
    var turn = game.turn();
    if (getMode(turn) === getColorName(turn) + "-robot") {
        if (!firstMoveMade) { 
          firstMoveMade = true; 
          lastTickTime = Date.now();
          startTimer(); 
        }
        if (botTimeoutId) clearTimeout(botTimeoutId);
        botTimeoutId = setTimeout(function () {
            if (game.game_over() || isPaused) return;
            var botColor = game.turn();
            var bm = minimaxroot(1, game, botColor === 'w');
            
            // Deduct exact thinking time using the unified lastTickTime baseline
            if (firstMoveMade) {
                var now = Date.now();
                var elapsed = Math.floor((now - lastTickTime) / 1000);
                if (elapsed > 0) {
                    if (botColor === 'w') whiteTime -= elapsed; else blackTime -= elapsed;
                    lastTickTime += elapsed * 1000;
                }
            }
            updateClockDisplay();

            if (bm) {
                game.move(bm);
                board.position(game.fen(), false);
                updateLog();
                if (botColor === 'w') whiteTime += whiteIncrement; else blackTime += blackIncrement;
                updateClockDisplay();
                handlegameover();
                if (!isPaused) checkAndTriggerBot(); 
            }
        }, 250);
    }
}

function resetgame() {
    if (botTimeoutId) { clearTimeout(botTimeoutId); botTimeoutId = null; }
    game.reset();
    board.position("start", false);
    removegreysquares();
    selectedsquare = null;
    document.getElementById("log").textContent = "";
    document.getElementById("white-captured").innerHTML = "";
    document.getElementById("black-captured").innerHTML = "";
    document.getElementById("eval-score").textContent = "Eval: 0.00";
    isPaused = false;
    document.getElementById("pause").textContent = "pause";
    document.getElementById("title").textContent = "Kindle chess";
    applyClockSettings();
    lastTickTime = Date.now(); // Reset time baseline
    setTimeout(checkAndTriggerBot, 500);
}

function undomove() {
    if (game.history().length === 0) return; // Don't undo if no moves have been made

    // Cancel any pending bot move so it doesn't fire while we are undoing
    if (botTimeoutId) { clearTimeout(botTimeoutId); botTimeoutId = null; }

    // Undo the last move
    game.undo();

    board.position(game.fen(), false);
    removegreysquares();
    selectedsquare = null;

    // Reset the title if the game was over or in check
    if (!game.game_over()) {
        document.getElementById("title").textContent = game.in_check() ? "Check!" : "Kindle chess";
    }

    updateLog(); // This will also update captured pieces and the eval score
    updateClockDisplay();
}

function handleModeChange() {
    if (game.game_over() || isPaused) return;
    var turn = game.turn();
    if (getMode(turn) === getColorName(turn) + "-robot") {
        if (!firstMoveMade) { 
          firstMoveMade = true; 
          lastTickTime = Date.now();
          startTimer(); 
        }
        checkAndTriggerBot();
    } else {
        if (botTimeoutId) { clearTimeout(botTimeoutId); botTimeoutId = null; }
    }
}

// --- CAPTURED PIECES ---
// Sort order: Queen, Rook, Bishop, Knight, Pawn
var pieceOrder = { 'q': 1, 'r': 2, 'b': 3, 'n': 4, 'p': 5 };

function updateCapturedPieces() {
    var history = game.history({ verbose: true });
    var whiteCaptures = [];
    var blackCaptures = [];

    for (var i = 0; i < history.length; i++) {
        if (history[i].captured) {
            var capturedPiece = history[i].captured; // e.g., 'p', 'n', 'q'
            var moverColor = history[i].color;       // 'w' or 'b'

            if (moverColor === 'w') {
                whiteCaptures.push(capturedPiece);
            } else {
                blackCaptures.push(capturedPiece);
            }
        }
    }

    whiteCaptures.sort(function(a, b) { return pieceOrder[a] - pieceOrder[b]; });
    blackCaptures.sort(function(a, b) { return pieceOrder[a] - pieceOrder[b]; });

    // Uppercase piece letters (e.g., bP.svg, wQ.svg) to match standard chessboard.js asset naming
    var whiteHTML = "";
    for (var w = 0; w < whiteCaptures.length; w++) {
        whiteHTML += '<img src="b' + whiteCaptures[w].toUpperCase() + '.svg" alt="captured">';
    }
    var blackHTML = "";
    for (var b = 0; b < blackCaptures.length; b++) {
        blackHTML += '<img src="w' + blackCaptures[b].toUpperCase() + '.svg" alt="captured">';
    }

    document.getElementById("white-captured").innerHTML = whiteHTML;
    document.getElementById("black-captured").innerHTML = blackHTML;
}

// --- LOG & HIGHLIGHTING ---
function updateLog() {
    var history = game.history(), logText = "";
    for (var i = 0; i < history.length; i++) {
        logText += (i % 2 === 0) ? (i / 2 + 1) + ". " + history[i] : "  " + history[i] + "\n";
    }
    document.getElementById("log").textContent = logText;
    updateCapturedPieces();
    updateEvalScore();
}

var highlightedSquares = [];
function removegreysquares() {
    for (var i = 0; i < highlightedSquares.length; i++) {
        var el = document.querySelector("#chessboard .square-" + highlightedSquares[i]);
        if (el) { el.style.outline = ""; el.style.outlineOffset = ""; }
    }
    highlightedSquares = [];
}
function greysquare(sq) {
    var el = document.querySelector("#chessboard .square-" + sq);
    if (el) { el.style.outline = "5px dashed black"; el.style.outlineOffset = "-5px"; highlightedSquares.push(sq); }
}

// --- CLICK HANDLERS ---
function findParentByClass(target, className, container) {
    while (target && target !== container) {
        if (target.className && target.className.indexOf(className) !== -1) return target;
        target = target.parentNode;
    }
    return null;
}

document.getElementById("chessboard").parentNode.addEventListener("click", function (e) {
    var boardEl = document.getElementById("chessboard");
    var squareEl = findParentByClass(e.target, "square-55d63", boardEl);
    if (!squareEl) { removegreysquares(); selectedsquare = null; return; }

    var turn = game.turn();
    if (getMode(turn) === getColorName(turn) + "-robot" || game.game_over() || isPaused) return;

    var sq = squareEl.getAttribute("data-square");
    var pc = game.get(sq);
    var lm = game.moves({ square: sq, verbose: true });
    var ip = pc && pc.color === turn;

    if (!selectedsquare) {
        if (!ip || lm.length === 0) return;
        selectedsquare = sq; removegreysquares(); greysquare(sq);
        lm.forEach(function (m) { greysquare(m.to); });
        return;
    }
    if (selectedsquare === sq) { removegreysquares(); selectedsquare = null; return; }
    if (ip) {
        if (lm.length === 0) { removegreysquares(); selectedsquare = null; return; }
        selectedsquare = sq; removegreysquares(); greysquare(sq);
        lm.forEach(function (m) { greysquare(m.to); });
        return;
    }
    
    var mv = game.move({ from: selectedsquare, to: sq, promotion: "q" });
    removegreysquares();
    if (!mv) {
        greysquare(selectedsquare);
        game.moves({ square: selectedsquare, verbose: true }).forEach(function (m) { greysquare(m.to); });
        return;
    }
    
    // Deduct exact time taken for the human move
    if (firstMoveMade) {
        var now = Date.now();
        var elapsed = Math.floor((now - lastTickTime) / 1000);
        if (elapsed > 0) {
            if (turn === 'w') whiteTime -= elapsed; else blackTime -= elapsed;
            lastTickTime += elapsed * 1000;
        }
    }

    board.position(game.fen(), false);
    selectedsquare = null;
    updateLog();
    
    if (turn === 'w') whiteTime += whiteIncrement; else blackTime += blackIncrement;
    
    if (!firstMoveMade) { 
      firstMoveMade = true; 
      lastTickTime = Date.now();
      startTimer(); 
    }
    updateClockDisplay();
    handlegameover();
    checkAndTriggerBot();
});

document.getElementById("pause").addEventListener("click", function() {
    if (game.game_over()) return;
    if (isPaused) {
        lastTickTime += (Date.now() - pauseStartTime);
        isPaused = false; this.textContent = "pause"; startTimer(); checkAndTriggerBot();
    } else {
        if (firstMoveMade) {
            var now = Date.now();
            var elapsed = Math.floor((now - lastTickTime) / 1000);
            if (elapsed > 0) {
                if (game.turn() === 'w') whiteTime -= elapsed; else blackTime -= elapsed;
                lastTickTime += elapsed * 1000;
            }
        }
        pauseStartTime = Date.now();
        isPaused = true; this.textContent = "resume"; 
        if (botTimeoutId) { clearTimeout(botTimeoutId); botTimeoutId = null; }
        stopTimer();
        updateClockDisplay();
    }
});

function handlegameover() {
    if (game.game_over()) {
        stopTimer(); 
        if (botTimeoutId) { clearTimeout(botTimeoutId); botTimeoutId = null; }
        document.getElementById("title").textContent = game.in_checkmate() ? (game.turn() === "w" ? "Black" : "White") + " Wins!" : "Draw!";
        return;
    }
    document.getElementById("title").textContent = game.in_check() ? "Check!" : "Kindle chess";
}

// --- SETTINGS LISTENERS ---
var modeEls = document.querySelectorAll('input[name="white-mode"], input[name="black-mode"]');
for (var i = 0; i < modeEls.length; i++) {
    modeEls[i].addEventListener("change", handleModeChange);
    modeEls[i].addEventListener("click", handleModeChange);
}

var incEls = document.querySelectorAll("#black-increment, #white-increment");
for (var i = 0; i < incEls.length; i++) {
    incEls[i].addEventListener("change", function() {
        whiteIncrement = parseInt(document.getElementById("white-increment").value, 10) || 0;
        blackIncrement = parseInt(document.getElementById("black-increment").value, 10) || 0;
    });
}

// --- AI MINIMAX LOGIC ---
var pawnevalwhite = [[0,0,0,0,0,0,0,0],[5,5,5,5,5,5,5,5],[1,1,2,3,3,2,1,1],[0.5,0.5,1,2.5,2.5,1,0.5,0.5],[0,0,0,2,2,0,0,0],[0.5,-0.5,-1,0,0,-1,-0.5,0.5],[0.5,1,1,-2,-2,1,1,0.5],[0,0,0,0,0,0,0,0]];
var pawnevalblack = pawnevalwhite.slice().reverse();

var knightevalwhite = [[-5,-4,-3,-3,-3,-3,-4,-5],[-4,-2,0,0,0,0,-2,-4],[-3,0,1,1.5,1.5,1,0,-3],[-3,0.5,1.5,2,2,1.5,0.5,-3],[-3,0,1.5,2,2,1.5,0,-3],[-3,0.5,1,1.5,1.5,1,0.5,-3],[-4,-2,0,0.5,0.5,0,-2,-4],[-5,-4,-3,-3,-3,-3,-4,-5]];
var knightevalblack = knightevalwhite.slice().reverse();

var bishopevalwhite = [[-2,-1,-1,-1,-1,-1,-1,-2],[-1,0,0,0,0,0,0,-1],[-1,0,0.5,1,1,0.5,0,-1],[-1,0.5,0.5,1,1,0.5,0.5,-1],[-1,0,1,1,1,1,0,-1],[-1,1,1,1,1,1,1,-1],[-1,0.5,0,0,0,0,0.5,-1],[-2,-1,-1,-1,-1,-1,-1,-2]];
var bishopevalblack = bishopevalwhite.slice().reverse();

var rookevalwhite = [[0,0,0,0,0,0,0,0],[0.5,1,1,1,1,1,1,0.5],[-0.5,0,0,0,0,0,0,-0.5],[-0.5,0,0,0,0,0,0,-0.5],[-0.5,0,0,0,0,0,0,-0.5],[-0.5,0,0,0,0,0,0,-0.5],[-0.5,0,0,0,0,0,0,-0.5],[0,0,0,0.5,0.5,0,0,0]];
var rookevalblack = rookevalwhite.slice().reverse();

var evalqueenwhite = [[-2,-1,-1,-0.5,-0.5,-1,-1,-2],[-1,0,0,0,0,0,0,-1],[-1,0,0.5,0.5,0.5,0.5,0,-1],[-0.5,0,0.5,0.5,0.5,0.5,0,-0.5],[0,0,0.5,0.5,0.5,0.5,0,-0.5],[-1,0.5,0.5,0.5,0.5,0.5,0,-1],[-1,0,0.5,0,0,0,0,-1],[-2,-1,-1,-0.5,-0.5,-1,-1,-2]];
var evalqueenblack = evalqueenwhite.slice().reverse();

var kingevalwhite = [[-3,-4,-4,-5,-5,-4,-4,-3],[-3,-4,-4,-5,-5,-4,-4,-3],[-3,-4,-4,-5,-5,-4,-4,-3],[-3,-4,-4,-5,-5,-4,-4,-3],[-2,-3,-3,-4,-4,-3,-3,-2],[-1,-2,-2,-2,-2,-2,-2,-1],[2,2,0,0,0,0,2,2],[2,3,1,0,0,1,3,2]];
var kingevalblack = kingevalwhite.slice().reverse();

function getpiecevalue(p, x, y) {
    if (!p) return 0;
    var w = p.color === "w", b = 0;
    switch (p.type) {
        case "p": b = 10 + (w ? pawnevalwhite[y][x] : pawnevalblack[y][x]); break;
        case "n": b = 30 + (w ? knightevalwhite[y][x] : knightevalblack[y][x]); break;
        case "b": b = 30 + (w ? bishopevalwhite[y][x] : bishopevalblack[y][x]); break;
        case "r": b = 50 + (w ? rookevalwhite[y][x] : rookevalblack[y][x]); break;
        case "q": b = 90 + (w ? evalqueenwhite[y][x] : evalqueenblack[y][x]); break;
        case "k": b = 900 + (w ? kingevalwhite[y][x] : kingevalblack[y][x]); break;
        default: return 0;
    }
    return w ? b : -b;
}

function minimaxroot(d, g, max) {
    var m = g.moves({ verbose: true });
    var bv = max ? -Infinity : Infinity, bm = null;
    var a = -1e4, b = 1e4;

    for (var i = 0; i < m.length; i++) {
        g.move(m[i]);
        var v = minimax(d - 1, g,  a, b, !max);
        g.undo();
        
        if (v === bv && Math.random() < 0.3) {
            bm = m[i];
        } else if (max ? v > bv : v < bv) {
            bv = v;
            bm = m[i];
        }

        // Narrow bounds at root for subsequent move searches
        if (max) a = Math.max(a, bv);
        else b = Math.min(b, bv);
    }
    return bm;
}

function minimax(d, g, a, b, max) {
    var m = g.moves({ verbose: true });

    // Distinguish checkmate loss from draw/stalemate
    if (m.length === 0) {
        if (g.in_checkmate()) {
            return max ? -99999 : 99999;
        }
        return 0; // Stalemate / Draw evaluate neutrally
    }
    
    if (d === 0) return evaluateboard(g.board()); 
    
    if (max) {
        var best = -Infinity;
        for (var i = 0; i < m.length; i++) {
            g.move(m[i]);
            best = Math.max(best, minimax(d - 1, g, a, b, false));
            g.undo();
            a = Math.max(a, best);
            if (b <= a) break;
        }
        return best;
    } else {
        var _best = Infinity;
        for (var i = 0; i < m.length; i++) {
            g.move(m[i]);
            _best = Math.min(_best, minimax(d - 1, g, a, b, true));
            g.undo();
            b = Math.min(b, _best);
            if (b <= a) break;
        }
        return _best;
    }
}

function evaluateboard(bd) {
    var t = 0;
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) t += getpiecevalue(bd[y][x], x, y);
    return t;
}

// --- EVALUATION SCORE ---
function updateEvalScore() {
    var score = evaluateboard(game.board());
    var pawns = (score / 10).toFixed(2);
    
    var displayScore = (score > 0 ? "+" : "") + pawns;
    document.getElementById("eval-score").textContent = "Eval: " + displayScore;
}

window.addEventListener("resize", function() {
    if (board) {
        board.resize();
    }
});

// --- INIT ---
applyClockSettings();
document.getElementById("reset").addEventListener("click", resetgame);
document.getElementById("undo").addEventListener("click", undomove);
