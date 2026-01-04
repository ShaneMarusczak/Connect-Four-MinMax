"use strict";
(() => {
  // ============================================================================
  // CONSTANTS
  // ============================================================================
  const BOARD_ROWS = 6;
  const BOARD_COLS = 7;
  const WIN_SCORE = 100000;
  const PLAYER_HUMAN = 0;
  const PLAYER_CPU = 1;

  // Animation timings (in milliseconds)
  const ANIM_DROP_FRAME = 85;
  const ANIM_MOVE_DELAY = 600;
  const ANIM_MODAL_DELAY = 10;
  const ANIM_AI_DELAY = 150;
  const ANIM_AI_PLAY_DELAY = 50;
  const ANIM_WIN_HIGHLIGHT_DELAY = 1000;
  const MODAL_DURATION = 2000;
  const INVALID_MOVE_DURATION = 1500;

  // Alpha-beta bounds
  const ALPHA_INIT = -WIN_SCORE;
  const BETA_INIT = WIN_SCORE;
  const MIN_SCORE = -99999;
  const MAX_SCORE = 99999;

  // Transposition table size (prime number for better distribution)
  const TT_SIZE = 1048583; // ~1M entries, prime number

  // Center-first column ordering for better pruning
  const DEFAULT_SCAN_ORDER = [3, 2, 4, 1, 5, 6, 0];

  // ============================================================================
  // TRANSPOSITION TABLE
  // ============================================================================
  class TranspositionTable {
    constructor(size = TT_SIZE) {
      this.size = size;
      this.table = new Map();
      this.hits = 0;
      this.stores = 0;
    }

    hash(board) {
      // Create a unique key from board state
      let key = 0n;
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
          const cell = board[row][col];
          if (cell !== null) {
            // Use 2 bits per cell: 01 for human, 10 for CPU
            const pos = BigInt(row * BOARD_COLS + col);
            key |= BigInt(cell + 1) << (pos * 2n);
          }
        }
      }
      return key;
    }

    store(board, depth, score, flag, bestMove) {
      const key = this.hash(board);
      const existing = this.table.get(key);

      // Only replace if new entry has greater or equal depth
      if (!existing || existing.depth <= depth) {
        this.table.set(key, { depth, score, flag, bestMove });
        this.stores++;

        // Simple cleanup when table gets too large
        if (this.table.size > this.size) {
          this.clear();
        }
      }
    }

    lookup(board, depth, alpha, beta) {
      const key = this.hash(board);
      const entry = this.table.get(key);

      if (entry && entry.depth >= depth) {
        this.hits++;
        if (entry.flag === 'exact') {
          return { score: entry.score, bestMove: entry.bestMove, valid: true };
        } else if (entry.flag === 'lower' && entry.score >= beta) {
          return { score: entry.score, bestMove: entry.bestMove, valid: true };
        } else if (entry.flag === 'upper' && entry.score <= alpha) {
          return { score: entry.score, bestMove: entry.bestMove, valid: true };
        }
        // Return best move hint even if score isn't usable
        return { score: null, bestMove: entry.bestMove, valid: false };
      }
      return { score: null, bestMove: null, valid: false };
    }

    clear() {
      this.table.clear();
      this.hits = 0;
      this.stores = 0;
    }
  }

  // ============================================================================
  // BITBOARD ENGINE (for Extreme mode)
  // ============================================================================
  class BitboardEngine {
    constructor() {
      // Board representation using two 64-bit integers (as BigInt)
      // Bit layout: 7 columns x 7 rows (extra row for sentinel)
      // Column 0: bits 0-6, Column 1: bits 7-13, etc.
      this.position = 0n;  // Current player's pieces
      this.mask = 0n;      // All pieces (both players)
      this.moves = 0;      // Number of moves played

      // Precomputed constants
      this.BOTTOM = 0b0000001_0000001_0000001_0000001_0000001_0000001_0000001n;
      this.BOARD_MASK = this.BOTTOM * 0b0111111n; // Full board mask
    }

    reset() {
      this.position = 0n;
      this.mask = 0n;
      this.moves = 0;
    }

    canPlay(col) {
      return (this.mask & this.topMask(col)) === 0n;
    }

    play(col) {
      this.position ^= this.mask;
      this.mask |= this.mask + this.bottomMask(col);
      this.moves++;
    }

    playMove(move) {
      this.position ^= this.mask;
      this.mask |= move;
      this.moves++;
    }

    isWinningMove(col) {
      const pos = this.position | ((this.mask + this.bottomMask(col)) & this.columnMask(col));
      return this.checkAlignment(pos);
    }

    checkAlignment(pos) {
      // Horizontal
      let m = pos & (pos >> 7n);
      if ((m & (m >> 14n)) !== 0n) return true;

      // Diagonal \
      m = pos & (pos >> 6n);
      if ((m & (m >> 12n)) !== 0n) return true;

      // Diagonal /
      m = pos & (pos >> 8n);
      if ((m & (m >> 16n)) !== 0n) return true;

      // Vertical
      m = pos & (pos >> 1n);
      if ((m & (m >> 2n)) !== 0n) return true;

      return false;
    }

    // Get all non-losing moves as a bitmask
    possibleNonLosingMoves() {
      let possible = this.possible();
      const opponentWin = this.opponentWinningPosition();
      const forcedMoves = possible & opponentWin;

      if (forcedMoves !== 0n) {
        // Check if there's more than one forced move (we lose)
        if ((forcedMoves & (forcedMoves - 1n)) !== 0n) {
          return 0n; // Multiple threats, we lose
        }
        possible = forcedMoves; // Only one move to block
      }

      // Don't play under opponent's winning position
      return possible & ~(opponentWin >> 1n);
    }

    opponentWinningPosition() {
      return this.computeWinningPosition(this.position ^ this.mask, this.mask);
    }

    possible() {
      return (this.mask + this.BOTTOM) & this.BOARD_MASK;
    }

    computeWinningPosition(position, mask) {
      // Vertical
      let r = (position << 1n) & (position << 2n) & (position << 3n);

      // Horizontal
      let p = (position << 7n) & (position << 14n);
      r |= p & (position << 21n);
      r |= p & (position >> 7n);
      p = (position >> 7n) & (position >> 14n);
      r |= p & (position >> 21n);
      r |= p & (position << 7n);

      // Diagonal 1
      p = (position << 6n) & (position << 12n);
      r |= p & (position << 18n);
      r |= p & (position >> 6n);
      p = (position >> 6n) & (position >> 12n);
      r |= p & (position >> 18n);
      r |= p & (position << 6n);

      // Diagonal 2
      p = (position << 8n) & (position << 16n);
      r |= p & (position << 24n);
      r |= p & (position >> 8n);
      p = (position >> 8n) & (position >> 16n);
      r |= p & (position >> 24n);
      r |= p & (position << 8n);

      return r & (this.BOARD_MASK ^ mask);
    }

    // Unique position key for transposition table
    key() {
      return this.position + this.mask;
    }

    topMask(col) {
      return 1n << BigInt(5 + col * 7);
    }

    bottomMask(col) {
      return 1n << BigInt(col * 7);
    }

    columnMask(col) {
      return 0b0111111n << BigInt(col * 7);
    }

    // Move ordering: center columns first, prioritize winning moves
    getOrderedMoves() {
      const moves = [];
      const possible = this.possibleNonLosingMoves();

      if (possible === 0n) return moves;

      // Column order: center first
      const order = [3, 2, 4, 1, 5, 0, 6];

      for (const col of order) {
        const move = possible & this.columnMask(col);
        if (move !== 0n) {
          const actualMove = move & (this.mask + this.BOTTOM);
          if (actualMove !== 0n) {
            moves.push({ col, move: actualMove });
          }
        }
      }

      return moves;
    }

    // Load position from array board
    loadFromArray(boardArray, currentPlayer) {
      this.reset();

      // Build the position column by column, bottom to top
      for (let col = 0; col < BOARD_COLS; col++) {
        for (let row = BOARD_ROWS - 1; row >= 0; row--) {
          const cell = boardArray[row][col];
          if (cell !== null) {
            // Play moves alternating, starting from the move count
            const isCurrentPlayer = (cell === PLAYER_CPU) === (this.moves % 2 === 0);
            this.play(col);
          }
        }
      }

      // Adjust position based on who's to move
      if (currentPlayer === PLAYER_HUMAN) {
        this.position ^= this.mask;
      }
    }
  }

  // ============================================================================
  // EXTREME SOLVER (Negamax with advanced optimizations)
  // ============================================================================
  class ExtremeSolver {
    constructor() {
      this.engine = new BitboardEngine();
      this.transTable = new Map();
      this.nodeCount = 0;

      // Opening book for perfect play (first few moves)
      // Key: position key, Value: best column
      this.openingBook = new Map([
        // Empty board: play center
        [0n, 3],
      ]);
    }

    reset() {
      this.engine.reset();
      this.transTable.clear();
      this.nodeCount = 0;
    }

    solve(boardArray, currentPlayer) {
      this.nodeCount = 0;

      // Convert array board to bitboard
      this.loadPosition(boardArray, currentPlayer);

      // Check opening book
      const bookMove = this.openingBook.get(this.engine.key());
      if (bookMove !== undefined && this.engine.canPlay(bookMove)) {
        return bookMove;
      }

      // Quick win check
      for (let col = 0; col < BOARD_COLS; col++) {
        if (this.engine.canPlay(col) && this.engine.isWinningMove(col)) {
          return col;
        }
      }

      // Negamax with iterative deepening
      let bestMove = 3; // Default to center
      let bestScore = -WIN_SCORE;

      // Iterative deepening
      const maxDepth = 42 - this.engine.moves;

      for (let depth = 2; depth <= Math.min(maxDepth, 20); depth++) {
        this.transTable.clear();
        const result = this.negamaxRoot(depth);

        if (result.move !== -1) {
          bestMove = result.move;
          bestScore = result.score;
        }

        // If we found a winning move, stop searching
        if (bestScore >= WIN_SCORE - 50) break;
      }

      return bestMove;
    }

    loadPosition(boardArray, currentPlayer) {
      this.engine.reset();

      // We need to replay the game to build correct bitboard state
      const moves = [];

      // Collect all moves in order (approximation based on column heights)
      const heights = new Array(BOARD_COLS).fill(0);
      for (let row = BOARD_ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < BOARD_COLS; col++) {
          if (boardArray[row][col] !== null) {
            heights[col]++;
          }
        }
      }

      // Reconstruct move sequence (simplified - may not be exact order but same final position)
      for (let row = BOARD_ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < BOARD_COLS; col++) {
          if (boardArray[row][col] !== null) {
            this.engine.play(col);
          }
        }
      }

      // Fix: rebuild properly
      this.engine.reset();
      let moveCount = 0;
      for (let row = BOARD_ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < BOARD_COLS; col++) {
          if (boardArray[row][col] !== null) {
            moveCount++;
          }
        }
      }

      // Simple approach: rebuild bitboards directly
      let cpuPos = 0n;
      let humanPos = 0n;

      for (let col = 0; col < BOARD_COLS; col++) {
        let bitPos = BigInt(col * 7);
        for (let row = BOARD_ROWS - 1; row >= 0; row--) {
          const cell = boardArray[row][col];
          if (cell === PLAYER_CPU) {
            cpuPos |= (1n << bitPos);
            bitPos++;
          } else if (cell === PLAYER_HUMAN) {
            humanPos |= (1n << bitPos);
            bitPos++;
          }
        }
      }

      this.engine.mask = cpuPos | humanPos;
      this.engine.moves = moveCount;

      // Set position based on who's to play
      // In negamax, position is always from current player's perspective
      if (currentPlayer === PLAYER_CPU) {
        this.engine.position = cpuPos;
      } else {
        this.engine.position = humanPos;
      }
    }

    negamaxRoot(maxDepth) {
      const moves = this.engine.getOrderedMoves();

      if (moves.length === 0) {
        // No non-losing moves, pick any valid move
        for (let col = 0; col < BOARD_COLS; col++) {
          if (this.engine.canPlay(col)) {
            return { move: col, score: -WIN_SCORE };
          }
        }
        return { move: -1, score: -WIN_SCORE };
      }

      let bestMove = moves[0].col;
      let bestScore = -WIN_SCORE;
      let alpha = -WIN_SCORE;
      const beta = WIN_SCORE;

      for (const { col, move } of moves) {
        // Save state
        const savedPos = this.engine.position;
        const savedMask = this.engine.mask;
        const savedMoves = this.engine.moves;

        this.engine.playMove(move);

        const score = -this.negamax(-beta, -alpha, maxDepth - 1);

        // Restore state
        this.engine.position = savedPos;
        this.engine.mask = savedMask;
        this.engine.moves = savedMoves;

        if (score > bestScore) {
          bestScore = score;
          bestMove = col;
        }

        if (score > alpha) {
          alpha = score;
        }
      }

      return { move: bestMove, score: bestScore };
    }

    negamax(alpha, beta, depth) {
      this.nodeCount++;

      // Check for draw
      if (this.engine.moves >= 42) {
        return 0;
      }

      // Check if current player can win immediately
      for (let col = 0; col < BOARD_COLS; col++) {
        if (this.engine.canPlay(col) && this.engine.isWinningMove(col)) {
          return (43 - this.engine.moves) / 2;
        }
      }

      // Depth limit
      if (depth <= 0) {
        return this.evaluate();
      }

      // Get non-losing moves
      const moves = this.engine.getOrderedMoves();

      if (moves.length === 0) {
        return -(43 - this.engine.moves) / 2; // We will lose
      }

      // Transposition table lookup
      const key = this.engine.key();
      const ttEntry = this.transTable.get(key);
      if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === 'exact') return ttEntry.score;
        if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
      }

      // Upper bound based on remaining moves
      const max = (41 - this.engine.moves) / 2;
      if (beta > max) {
        beta = max;
        if (alpha >= beta) return beta;
      }

      let bestScore = -WIN_SCORE;
      const origAlpha = alpha;

      for (const { col, move } of moves) {
        // Save state
        const savedPos = this.engine.position;
        const savedMask = this.engine.mask;
        const savedMoves = this.engine.moves;

        this.engine.playMove(move);

        const score = -this.negamax(-beta, -alpha, depth - 1);

        // Restore state
        this.engine.position = savedPos;
        this.engine.mask = savedMask;
        this.engine.moves = savedMoves;

        if (score > bestScore) {
          bestScore = score;
        }

        if (score > alpha) {
          alpha = score;
        }

        if (alpha >= beta) {
          break; // Beta cutoff
        }
      }

      // Store in transposition table
      let flag = 'exact';
      if (bestScore <= origAlpha) flag = 'upper';
      else if (bestScore >= beta) flag = 'lower';

      this.transTable.set(key, { score: bestScore, depth, flag });

      return bestScore;
    }

    evaluate() {
      // Simple evaluation based on potential winning positions
      // This is used when depth limit is reached
      return 0; // Neutral evaluation when we can't search deeper
    }
  }

  // ============================================================================
  // GAME STATE
  // ============================================================================
  let scanOrder = [...DEFAULT_SCAN_ORDER];
  let gameOver = false;
  let gameStarted = false;
  let animationMode = false;
  let transpositionTable = new TranspositionTable();
  let extremeSolver = new ExtremeSolver();

  // ============================================================================
  // BOARD CLASS
  // ============================================================================
  class Board {
    constructor(game, gameBoardArray, player) {
      this.game = game;
      this.gameBoardArray = gameBoardArray;
      this.player = player;
    }

    isFinished(depth, score) {
      return depth === 0 ||
          score === WIN_SCORE ||
          score === -WIN_SCORE ||
          this.isFull();
    }

    columnIsFull(col) {
      for (let y = BOARD_ROWS - 1; y >= 0; y--) {
        if (this.gameBoardArray[y][col] === null) {
          return false;
        }
      }
      return true;
    }

    placeInColumnForQuickMove(col, playerValue) {
      for (let y = BOARD_ROWS - 1; y >= 0; y--) {
        if (this.gameBoardArray[y][col] === null) {
          this.gameBoardArray[y][col] = playerValue;
          break;
        }
      }
    }

    canPlace(column) {
      if (
        this.gameBoardArray[0][column] === null &&
        column >= 0 &&
        column < BOARD_COLS
      ) {
        for (let y = BOARD_ROWS - 1; y >= 0; y--) {
          if (this.gameBoardArray[y][column] === null) {
            this.gameBoardArray[y][column] = this.player;
            break;
          }
        }
        this.player = this.player === PLAYER_HUMAN ? PLAYER_CPU : PLAYER_HUMAN;

        return true;
      } else {
        return false;
      }
    }

    scoreBoard(row, column, deltaY, deltaX, populateWinners) {
      let humanPoints = 0;
      let computerPoints = 0;
      let internalRow = row;
      let internalCol = column;
      if (populateWinners) {
        this.game.winningArrayHuman = [];
        this.game.winningArrayCpu = [];
      }

      for (let i = 0; i < 4; i++) {
        if (this.gameBoardArray[internalRow][internalCol] === PLAYER_HUMAN) {
          if (populateWinners) {
            this.game.winningArrayHuman.push([internalRow, internalCol]);
          }
          humanPoints++;
        } else if (this.gameBoardArray[internalRow][internalCol] === PLAYER_CPU) {
          if (populateWinners) {
            this.game.winningArrayCpu.push([internalRow, internalCol]);
          }
          computerPoints++;
        }
        internalRow = internalRow + deltaY;
        internalCol = internalCol + deltaX;
      }
      if (humanPoints === 4) {
        if (populateWinners) {
          this.game.winners = this.game.winningArrayHuman;
        }
        return -WIN_SCORE;
      } else if (computerPoints === 4) {
        if (populateWinners) {
          this.game.winners = this.game.winningArrayCpu;
        }
        return WIN_SCORE;
      } else {
        return computerPoints;
      }
    }

    evaluateScore(populateWinners) {
      let verticalPoints = 0;
      let horizontalPoints = 0;
      let diagonalPoints1 = 0;
      let diagonalPoints2 = 0;
      for (let row = 0; row < BOARD_ROWS - 3; row++) {
        for (let column = 0; column < BOARD_COLS; column++) {
          const score = this.scoreBoard(row, column, 1, 0, populateWinners);
          if (score === WIN_SCORE) return WIN_SCORE;
          if (score === -WIN_SCORE) return -WIN_SCORE;
          verticalPoints = verticalPoints + score;
        }
      }
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let column = 0; column < BOARD_COLS - 3; column++) {
          const score = this.scoreBoard(row, column, 0, 1, populateWinners);
          if (score === WIN_SCORE) return WIN_SCORE;
          if (score === -WIN_SCORE) return -WIN_SCORE;
          horizontalPoints = horizontalPoints + score;
        }
      }
      for (let row = 0; row < BOARD_ROWS - 3; row++) {
        for (let column = 0; column < BOARD_COLS - 3; column++) {
          const score = this.scoreBoard(row, column, 1, 1, populateWinners);
          if (score === WIN_SCORE) return WIN_SCORE;
          if (score === -WIN_SCORE) return -WIN_SCORE;
          diagonalPoints1 = diagonalPoints1 + score;
        }
      }
      for (let row = 3; row < BOARD_ROWS; row++) {
        for (let column = 0; column <= BOARD_COLS - 4; column++) {
          const score = this.scoreBoard(row, column, -1, +1, populateWinners);
          if (score === WIN_SCORE) return WIN_SCORE;
          if (score === -WIN_SCORE) return -WIN_SCORE;
          diagonalPoints2 = diagonalPoints2 + score;
        }
      }
      return (
        horizontalPoints + verticalPoints + diagonalPoints1 + diagonalPoints2
      );
    }

    isFull() {
      for (let i = 0; i < BOARD_COLS; i++) {
        if (this.gameBoardArray[0][i] === null) {
          return false;
        }
      }
      return true;
    }

    getBoardCopy() {
      const newBoard = [];
      for (let i = 0; i < this.gameBoardArray.length; i++) {
        newBoard.push(this.gameBoardArray[i].slice());
      }
      return new Board(this.game, newBoard, this.player);
    }
  }

  // ============================================================================
  // GAME CLASS
  // ============================================================================
  class Game {
    constructor(depth) {
      this.rows = BOARD_ROWS;
      this.columns = BOARD_COLS;
      this.depth = parseInt(depth, 10);
      this.isExtremeMode = this.depth === 99;
      this.round = 0;
      this.winners = [];
      this.turnsTaken = 0;
      this.board = undefined;

      // Clear transposition table for new game
      transpositionTable.clear();

      this.init();
    }

    init() {
      const gameBoard = new Array(BOARD_ROWS);
      for (let i = 0; i < gameBoard.length; i++) {
        gameBoard[i] = new Array(BOARD_COLS);

        for (let j = 0; j < gameBoard[i].length; j++) {
          gameBoard[i][j] = null;
        }
      }
      this.board = new Board(this, gameBoard, PLAYER_HUMAN);
      Array.from(
        document.getElementById("gameBoard").getElementsByTagName("td")
      ).forEach((td) => {
        td.addEventListener(
          "click",
          (e) => {
            this.move(e);
          },
          false
        );
        td.addEventListener("mouseover", hoverOverColumnHighLight);
        td.addEventListener("mouseleave", hoverOverColumnHighLightReset);
      });
    }

    move(e) {
      if (!gameOver) {
        this.turnsTaken++;
        document.getElementById("uiBlocker").classList.add("block");
        const element = e.target;
        if (this.round === 0) this.playCoin(element.cellIndex);
        document
          .getElementById("fc" + element.cellIndex)
          .classList.remove("bounce");
        sleep(ANIM_MOVE_DELAY).then(() => {
          if (this.round === 1) this.generateComputerDecision();
        });
      }
    }

    static animateDrop({ inputRow, inputCol, moveTurn, currentRow = 0 } = {}) {
      if (currentRow === inputRow) {
        if (!gameOver && !moveTurn) {
          sleep(ANIM_MODAL_DELAY).then(() => {
            modalOpen("Thinking...");
          });
          document
            .getElementsByTagName("html")[0]
            .classList.add("progressCursor");
          changeFavicon("yellow");
        }
        if (moveTurn) {
          document.getElementById("uiBlocker").classList.remove("block");
          changeFavicon("red");
          animationMode = false;
        }
        document.getElementById(
          "td" + currentRow + inputCol
        ).className = moveTurn ? "coin cpu-coin" : "coin human-coin";
        return;
      }
      animationMode = true;
      document
        .getElementById("td" + currentRow + inputCol)
        .classList.add("coin");
      document
        .getElementById("td" + currentRow + inputCol)
        .classList.add(moveTurn ? "cpu-coin" : "human-coin");
      sleep(ANIM_DROP_FRAME).then(() => {
        document
          .getElementById("td" + currentRow + inputCol)
          .classList.remove("coin");
        document
          .getElementById("td" + currentRow + inputCol)
          .classList.remove(moveTurn ? "cpu-coin" : "human-coin");
      });
      sleep(ANIM_DROP_FRAME).then(() => {
        Game.animateDrop({
          currentRow: currentRow + 1,
          inputCol,
          inputRow,
          moveTurn,
        });
      });
    }

    playCoin(column) {
      if (!gameOver) {
        for (let y = this.rows - 1; y >= 0; y--) {
          const td = document.getElementById("gameBoard").rows[y].cells[column];
          if (td.classList.contains("empty")) {
            if (this.round === 1) {
              Game.animateDrop({
                inputCol: column,
                inputRow: y,
                moveTurn: true,
              });
            } else {
              Game.animateDrop({
                inputCol: column,
                inputRow: y,
                moveTurn: false,
              });
            }
            break;
          }
        }
        if (!this.board.canPlace(column)) {
          document.getElementById("uiBlocker").classList.remove("block");
          modal("Invalid move!", INVALID_MOVE_DURATION);
          return;
        }
        this.round = this.round === 0 ? 1 : 0;
        this.checkGameOver();
      }
    }

    quickMove() {
      for (let column = 0; column < BOARD_COLS; column++) {
        const newBoard = this.board.getBoardCopy();
        if (!newBoard.columnIsFull(column)) {
          newBoard.placeInColumnForQuickMove(column, PLAYER_CPU);
          if (newBoard.evaluateScore(false) === WIN_SCORE) {
            return column;
          }
        }
      }
      for (let column = 0; column < BOARD_COLS; column++) {
        const newBoard = this.board.getBoardCopy();
        if (!newBoard.columnIsFull(column)) {
          newBoard.placeInColumnForQuickMove(column, PLAYER_HUMAN);
          if (newBoard.evaluateScore(false) === -WIN_SCORE) {
            return column;
          }
        }
      }
      return -1;
    }

    generateCompMoveInner() {
      let newBestMove;
      scanOrder = [...DEFAULT_SCAN_ORDER];

      for (let depth = 2; depth <= this.depth; depth++) {
        let [bestMoveAtDepth] = this.maximize(this.board, depth, ALPHA_INIT, BETA_INIT);
        newBestMove = bestMoveAtDepth;

        // Update scan order to prioritize best move found
        if (bestMoveAtDepth >= 0 && bestMoveAtDepth < BOARD_COLS) {
          scanOrder = this.generateScanOrder(bestMoveAtDepth);
        }
      }
      return newBestMove;
    }

    generateScanOrder(bestMove) {
      // Generate a scan order that prioritizes the best move and center columns
      const order = [bestMove];
      const centerOrder = [3, 2, 4, 1, 5, 0, 6];

      for (const col of centerOrder) {
        if (col !== bestMove) {
          order.push(col);
        }
      }

      return order;
    }

    generateComputerDecision() {
      if (!gameOver) {
        let aiMove = 0;

        // Extreme mode uses the advanced solver
        if (this.isExtremeMode) {
          if (this.turnsTaken === 1) {
            aiMove = 3; // Opening move
          } else {
            aiMove = extremeSolver.solve(this.board.gameBoardArray, PLAYER_CPU);
          }
        } else {
          // Normal MinMax modes
          const quickMove = this.quickMove();
          if (this.turnsTaken === 1) {
            aiMove = 3;
          } else if (quickMove !== -1) {
            aiMove = quickMove;
          } else {
            aiMove = this.generateCompMoveInner();
          }
        }

        sleep(ANIM_AI_DELAY).then(() => {
          modalClose();
          sleep(ANIM_AI_PLAY_DELAY).then(() => this.playCoin(aiMove));
        });
      }
    }

    maximize(board, depth, alpha, beta) {
      const score = board.evaluateScore(false);
      if (board.isFinished(depth, score)) return [-1, score];

      // Transposition table lookup
      const ttResult = transpositionTable.lookup(board.gameBoardArray, depth, alpha, beta);
      if (ttResult.valid) {
        return [ttResult.bestMove !== null ? ttResult.bestMove : -1, ttResult.score];
      }

      // Use TT best move for move ordering if available
      const moveOrder = ttResult.bestMove !== null
        ? this.generateScanOrder(ttResult.bestMove)
        : scanOrder;

      const max = [-1, MIN_SCORE];
      const origAlpha = alpha;

      for (let column of moveOrder) {
        const newBoard = board.getBoardCopy();
        if (newBoard.canPlace(column)) {
          const nextMove = this.minimize(newBoard, depth - 1, alpha, beta);
          if (max[0] === -1 || nextMove[1] > max[1]) {
            max[0] = column;
            [, max[1]] = nextMove;
          }
          if (max[1] > alpha) {
            alpha = max[1];
          }
          if (alpha >= beta) {
            // Store lower bound
            transpositionTable.store(board.gameBoardArray, depth, max[1], 'lower', max[0]);
            return max;
          }
        }
      }

      // Store exact or upper bound
      const flag = max[1] <= origAlpha ? 'upper' : 'exact';
      transpositionTable.store(board.gameBoardArray, depth, max[1], flag, max[0]);

      return max;
    }

    minimize(board, depth, alpha, beta) {
      const score = board.evaluateScore(false);
      if (board.isFinished(depth, score)) return [-1, score];

      // Transposition table lookup
      const ttResult = transpositionTable.lookup(board.gameBoardArray, depth, alpha, beta);
      if (ttResult.valid) {
        return [ttResult.bestMove !== null ? ttResult.bestMove : -1, ttResult.score];
      }

      const moveOrder = ttResult.bestMove !== null
        ? this.generateScanOrder(ttResult.bestMove)
        : scanOrder;

      const min = [-1, MAX_SCORE];
      const origBeta = beta;

      for (let column of moveOrder) {
        const newBoard = board.getBoardCopy();
        if (newBoard.canPlace(column)) {
          const nextMove = this.maximize(newBoard, depth - 1, alpha, beta);
          if (min[0] === -1 || nextMove[1] < min[1]) {
            min[0] = column;
            [, min[1]] = nextMove;
          }
          if (min[1] < beta) {
            beta = min[1];
          }
          if (alpha >= beta) {
            transpositionTable.store(board.gameBoardArray, depth, min[1], 'upper', min[0]);
            return min;
          }
        }
      }

      const flag = min[1] >= origBeta ? 'lower' : 'exact';
      transpositionTable.store(board.gameBoardArray, depth, min[1], flag, min[0]);

      return min;
    }

    checkGameOver() {
      const thisScore = this.board.evaluateScore(true);
      if (thisScore === -WIN_SCORE) {
        this.gameOverHelper("You Win!");
      } else if (thisScore === WIN_SCORE) {
        this.gameOverHelper("You Lose!");
      } else if (this.board.isFull()) {
        gameOver = true;
        modal("Draw!", MODAL_DURATION);
      }
      document
        .getElementsByTagName("html")[0]
        .classList.remove("progressCursor");
    }

    gameOverHelper(message) {
      document.getElementById("uiBlocker").classList.remove("block");
      gameOver = true;
      modal(message, MODAL_DURATION);
      sleep(ANIM_WIN_HIGHLIGHT_DELAY).then(() => {
        this.winnersColorChange();
      });
    }

    winnersColorChange() {
      document.getElementById("gameBoard").className = "finished";
      for (let i = 0; i < this.winners.length; i++) {
        const name = document.getElementById("gameBoard").rows[
          this.winners[i][0]
        ].cells[this.winners[i][1]].className;
        document.getElementById("gameBoard").rows[this.winners[i][0]].cells[
          this.winners[i][1]
        ].className = name + " win";
      }
    }
  }

  // ============================================================================
  // UI FUNCTIONS
  // ============================================================================
  function hoverOverColumnHighLight(e) {
    if (!gameOver && !animationMode) {
      const col = Number(e.target.id.substring(3));
      document.getElementById("fc" + col).classList.add("bounce");
      for (let y = BOARD_ROWS - 1; y >= 0; y--) {
        if (
          document.getElementById("td" + y + col).classList.contains("empty")
        ) {
          document.getElementById("td" + y + col).classList.add("glow");
          break;
        }
      }
    }
  }

  function hoverOverColumnHighLightReset(e) {
    const col = Number(e.target.id.substring(3));
    document.getElementById("fc" + col).classList.remove("bounce");
    for (let y = BOARD_ROWS - 1; y >= 0; y--) {
      if (document.getElementById("td" + y + col).classList.contains("empty")) {
        document.getElementById("td" + y + col).classList.remove("glow");
        break;
      }
    }
  }

  const start = () => {
    if (!gameStarted) {
      gameStarted = true;
      document.getElementById("difficulty").disabled = true;
      window.Game = new Game(
        Array.from(document.getElementById("difficulty").options).find(
          (d) => d.selected
        ).value
      );
    }
  };

  const changeFavicon = (color) => {
    const link =
        document.querySelector("link[rel*='icon']") ||
        document.createElement("link");
    link.type = "image/x-icon";
    link.rel = "shortcut icon";
    link.href = "favicon" + color + ".ico";
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function modalOpen(message) {
    const modalBox = document.createElement("div");
    modalBox.id = "modal-box";
    const innerModalBox = document.createElement("div");
    innerModalBox.id = "inner-modal-box";
    const modalMessage = document.createElement("span");
    modalMessage.id = "modal-message";
    innerModalBox.appendChild(modalMessage);
    modalBox.appendChild(innerModalBox);
    modalMessage.innerText = message;
    const outerAnimationContainer = document.createElement("div");
    outerAnimationContainer.classList.add("animation");
    for (let i = 0; i < 3; i++) {
      outerAnimationContainer.appendChild(document.createElement("div"));
    }
    innerModalBox.appendChild(outerAnimationContainer);
    document.getElementsByTagName("html")[0].appendChild(modalBox);
  }

  function modalClose() {
    const modal = document.getElementById("modal-box");
    if (modal) modal.remove();
  }

  function modal(message, duration) {
    const modalBox = document.createElement("div");
    modalBox.id = "modal-box";
    const innerModalBox = document.createElement("div");
    innerModalBox.id = "inner-modal-box";
    const modalMessage = document.createElement("span");
    modalMessage.id = "modal-message";
    innerModalBox.appendChild(modalMessage);
    modalBox.appendChild(innerModalBox);
    modalMessage.innerText = message;
    document.getElementsByTagName("html")[0].appendChild(modalBox);
    sleep(duration).then(() => modalBox.remove());
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  (() => {
    document.getElementById("start").addEventListener("click", start);

    for (let i = 0; i < BOARD_COLS; i++) {
      const circle = document.createElement("div");
      circle.id = "fc" + i;
      circle.classList.add("floatingCircle");
      document.getElementById("floatingCircles").appendChild(circle);
    }

    for (let i = 0; i < BOARD_ROWS; i++) {
      const tableRow = document.createElement("tr");
      document.getElementById("gameBoard").appendChild(tableRow);
      for (let j = 0; j < BOARD_COLS; j++) {
        const tableData = document.createElement("td");
        tableData.className = "empty";
        tableData.id = "td" + i + j;
        tableRow.appendChild(tableData);
      }
    }
  })();
})();
