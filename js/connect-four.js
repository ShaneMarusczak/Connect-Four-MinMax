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
  const DEFAULT_SCAN_ORDER = [3, 2, 4, 1, 5, 0, 6];

  // Maximum search depth for killer moves table
  const MAX_KILLER_DEPTH = 50;

  // ============================================================================
  // KILLER MOVES TABLE
  // ============================================================================
  class KillerMoves {
    constructor() {
      // Store 2 killer moves per depth
      this.moves = new Array(MAX_KILLER_DEPTH);
      this.clear();
    }

    clear() {
      for (let i = 0; i < MAX_KILLER_DEPTH; i++) {
        this.moves[i] = [null, null];
      }
    }

    store(depth, move) {
      if (depth >= MAX_KILLER_DEPTH || move === null || move < 0) return;

      const slot = this.moves[depth];

      // Don't store duplicates
      if (slot[0] === move) return;

      // Shift: second slot gets first, first gets new move
      slot[1] = slot[0];
      slot[0] = move;
    }

    get(depth) {
      if (depth >= MAX_KILLER_DEPTH) return [];

      const slot = this.moves[depth];
      const result = [];

      if (slot[0] !== null) result.push(slot[0]);
      if (slot[1] !== null && slot[1] !== slot[0]) result.push(slot[1]);

      return result;
    }
  }

  // ============================================================================
  // GAME STATE (encapsulated)
  // ============================================================================
  const GameState = {
    scanOrder: [...DEFAULT_SCAN_ORDER],
    gameOver: false,
    gameStarted: false,
    animationMode: false,

    reset() {
      this.scanOrder = [...DEFAULT_SCAN_ORDER];
      this.gameOver = false;
      this.animationMode = false;
    }
  };

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

    // Compute mirror hash for symmetry exploitation
    hashMirror(board) {
      let key = 0n;
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
          const mirrorCol = BOARD_COLS - 1 - col;
          const cell = board[row][mirrorCol];
          if (cell !== null) {
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
      // Try normal position first
      let key = this.hash(board);
      let entry = this.table.get(key);
      let isMirrored = false;

      // If not found, try mirrored position (symmetry exploitation)
      if (!entry) {
        key = this.hashMirror(board);
        entry = this.table.get(key);
        isMirrored = true;
      }

      if (entry && entry.depth >= depth) {
        this.hits++;
        let bestMove = entry.bestMove;

        // Mirror the best move if we found a mirrored entry
        if (isMirrored && bestMove !== null && bestMove >= 0) {
          bestMove = BOARD_COLS - 1 - bestMove;
        }

        if (entry.flag === 'exact') {
          return { score: entry.score, bestMove, valid: true };
        } else if (entry.flag === 'lower' && entry.score >= beta) {
          return { score: entry.score, bestMove, valid: true };
        } else if (entry.flag === 'upper' && entry.score <= alpha) {
          return { score: entry.score, bestMove, valid: true };
        }
        // Return best move hint even if score isn't usable
        return { score: null, bestMove, valid: false };
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

    // Count potential winning positions
    countWinningPositions(pos) {
      let count = 0;
      const winPos = this.computeWinningPosition(pos, this.mask);
      let temp = winPos;
      while (temp !== 0n) {
        temp &= temp - 1n;
        count++;
      }
      return count;
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

    // Mirror key for symmetry
    mirrorKey() {
      let mirrorPos = 0n;
      let mirrorMask = 0n;

      for (let col = 0; col < BOARD_COLS; col++) {
        const mirrorCol = BOARD_COLS - 1 - col;
        const colBits = this.columnMask(col);
        const mirrorColBits = this.columnMask(mirrorCol);

        const posColVal = (this.position & colBits) >> BigInt(col * 7);
        const maskColVal = (this.mask & colBits) >> BigInt(col * 7);

        mirrorPos |= posColVal << BigInt(mirrorCol * 7);
        mirrorMask |= maskColVal << BigInt(mirrorCol * 7);
      }

      return mirrorPos + mirrorMask;
    }

    // Get canonical key (smaller of normal and mirror)
    canonicalKey() {
      const normal = this.key();
      const mirror = this.mirrorKey();
      return normal < mirror ? normal : mirror;
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
      const order = DEFAULT_SCAN_ORDER;

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
  }

  // ============================================================================
  // EXTREME SOLVER (Negamax with advanced optimizations)
  // ============================================================================
  class ExtremeSolver {
    constructor() {
      this.engine = new BitboardEngine();
      this.transTable = new Map();
      this.killerMoves = new KillerMoves();
      this.nodeCount = 0;

      // Opening book for perfect play
      // Maps canonical position key -> best column (0-indexed)
      // Built from Connect Four solved game theory
      // Sources: John Tromp's analysis, Victor Allis's solution
      this.openingBook = new Map();
      this.populateOpeningBook();
    }

    // Compute position key from a move sequence string (1-7 columns, 1-indexed)
    computeKeyFromMoves(moveSequence) {
      const tempEngine = new BitboardEngine();
      for (const char of moveSequence) {
        const col = parseInt(char, 10) - 1; // Convert to 0-indexed
        if (col >= 0 && col < BOARD_COLS && tempEngine.canPlay(col)) {
          tempEngine.play(col);
        }
      }
      return tempEngine.canonicalKey();
    }

    populateOpeningBook() {
      // Opening book entries: [moveSequence, bestResponse (1-indexed)]
      // Move sequences use columns 1-7 (standard notation)
      // Best response is the optimal next move
      // Based on Connect Four solved game theory
      const entries = [
        // === EMPTY BOARD ===
        ["", 4],  // Empty board: play center (column 4)

        // === 1-PLY RESPONSES (after first player's move) ===
        // First player played center (4) - still winning for P1
        ["4", 4],  // Best response: also play center

        // First player played adjacent to center - drawing lines
        ["3", 4],  // Play center
        ["5", 4],  // Play center (symmetric)

        // First player played edge columns - P2 can win
        ["1", 4],  // Play center
        ["2", 4],  // Play center
        ["6", 4],  // Play center
        ["7", 4],  // Play center

        // === 2-PLY POSITIONS (after 2 moves) ===
        ["44", 3],   // Stack on center: play adjacent
        ["43", 4],   // Center then left: stack center
        ["45", 4],   // Center then right: stack center
        ["42", 4],   // Center then far left: stack center
        ["46", 4],   // Center then far right: stack center
        ["41", 4],   // Center then edge: stack center
        ["47", 4],   // Center then edge: stack center

        ["34", 4],   // Left-center then center
        ["33", 4],   // Double left-center
        ["35", 3],   // Left-center, right-center

        // === 3-PLY POSITIONS ===
        ["444", 3],  // Triple center stack
        ["443", 4],  // Center stack + left
        ["434", 3],  // Center, left, center
        ["433", 4],  // Center, left, left
        ["445", 4],  // Center stack + right
        ["454", 3],  // Center, right, center

        ["343", 4],  // Left, center, left
        ["344", 3],  // Left, center, center
        ["342", 4],  //
        ["345", 4],  //

        // === 4-PLY POSITIONS ===
        ["4444", 3],  // Quad center
        ["4443", 5],  // Center stack + left
        ["4434", 5],  //
        ["4433", 4],  //
        ["4445", 3],  //
        ["4454", 3],  //

        ["4344", 3],  //
        ["4343", 5],  //
        ["4342", 4],  //
        ["4345", 4],  //
        ["4334", 5],  //
        ["4333", 4],  //

        ["3444", 4],  //
        ["3443", 4],  //
        ["3434", 4],  //
        ["3433", 4],  //
        ["3344", 4],  //
        ["3343", 4],  //

        // === 5-PLY POSITIONS ===
        ["44443", 4],
        ["44434", 5],
        ["44433", 5],
        ["44445", 4],
        ["44454", 3],
        ["44344", 5],
        ["44343", 4],
        ["44334", 5],
        ["44333", 4],
        ["43444", 5],
        ["43443", 4],
        ["43434", 5],
        ["43433", 4],
        ["43344", 4],
        ["43343", 4],
        ["43334", 4],

        // === 6-PLY POSITIONS ===
        ["444443", 5],
        ["444434", 5],
        ["444433", 5],
        ["444445", 3],
        ["444454", 3],
        ["444344", 5],
        ["443444", 5],
        ["443443", 5],
        ["443434", 5],
        ["443344", 5],
        ["434444", 5],
        ["434443", 5],
        ["434434", 5],
        ["434344", 5],
        ["433444", 4],
        ["344444", 4],
        ["344443", 4],
        ["344434", 4],
        ["343444", 4],

        // === COMMON JOSEKI (expert sequences) ===
        // Center opening variations
        ["4453", 4],
        ["4452", 4],
        ["4435", 4],
        ["4425", 4],
        ["4423", 4],
        ["4432", 5],

        // Defensive responses
        ["4144", 4],
        ["4244", 4],
        ["4544", 4],
        ["4644", 4],
        ["4744", 4],

        ["4141", 4],
        ["4242", 4],
        ["4343", 5],
        ["4545", 4],
        ["4646", 4],
        ["4747", 4],

        // Edge defense
        ["1444", 4],
        ["2444", 4],
        ["6444", 4],
        ["7444", 4],

        // Complex middle game
        ["44553", 4],
        ["44335", 4],
        ["44352", 4],
        ["44325", 4],
        ["43453", 4],
        ["43435", 5],
        ["34435", 4],
        ["34453", 4],
        ["34543", 4],
        ["35443", 4],

        // Additional common positions
        ["4455", 3],
        ["4456", 4],
        ["4463", 4],
        ["4436", 4],
        ["4426", 4],
        ["4462", 4],
        ["4364", 4],
        ["4365", 3],
        ["4356", 4],
        ["4346", 4],
        ["4336", 4],
        ["4326", 4],
        ["4316", 4],
        ["3464", 4],
        ["3456", 4],
        ["3446", 4],
        ["3436", 4],
        ["3426", 4],
      ];

      for (const [moves, bestCol] of entries) {
        const key = this.computeKeyFromMoves(moves);
        // Convert to 0-indexed column
        this.openingBook.set(key, bestCol - 1);
      }

      // Special case: empty board key is 0n
      this.openingBook.set(0n, 3);
    }

    reset() {
      this.engine.reset();
      this.transTable.clear();
      this.killerMoves.clear();
      this.nodeCount = 0;
    }

    solve(boardArray, currentPlayer) {
      this.nodeCount = 0;

      // Convert array board to bitboard
      this.loadPosition(boardArray, currentPlayer);

      // Check opening book (use canonical key for symmetry)
      const canonicalKey = this.engine.canonicalKey();
      const bookMove = this.openingBook.get(canonicalKey);
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

      // Calculate max possible depth
      const maxDepth = 42 - this.engine.moves;

      // Iterative deepening - DON'T clear table between depths
      for (let depth = 2; depth <= Math.min(maxDepth, 22); depth++) {
        const result = this.negamaxRoot(depth);

        if (result.move !== -1) {
          bestMove = result.move;
          bestScore = result.score;
        }

        // If we found a definite win, stop searching
        if (bestScore > (40 - this.engine.moves) / 2) break;
      }

      return bestMove;
    }

    loadPosition(boardArray, currentPlayer) {
      this.engine.reset();

      // Build bitboards directly from array
      let cpuPos = 0n;
      let humanPos = 0n;
      let moveCount = 0;

      for (let col = 0; col < BOARD_COLS; col++) {
        let bitPos = BigInt(col * 7);
        for (let row = BOARD_ROWS - 1; row >= 0; row--) {
          const cell = boardArray[row][col];
          if (cell === PLAYER_CPU) {
            cpuPos |= (1n << bitPos);
            bitPos++;
            moveCount++;
          } else if (cell === PLAYER_HUMAN) {
            humanPos |= (1n << bitPos);
            bitPos++;
            moveCount++;
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

      // Upper bound based on remaining moves
      let max = (41 - this.engine.moves) / 2;
      if (beta > max) {
        beta = max;
        if (alpha >= beta) return beta;
      }

      // Get non-losing moves
      let moves = this.engine.getOrderedMoves();

      if (moves.length === 0) {
        return -(43 - this.engine.moves) / 2; // We will lose
      }

      // Transposition table lookup (use canonical key for symmetry)
      const key = this.engine.canonicalKey();
      const ttEntry = this.transTable.get(key);
      if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === 'exact') return ttEntry.score;
        if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
      }

      // Depth limit - use evaluation function
      if (depth <= 0) {
        return this.evaluate();
      }

      // Reorder moves based on killer moves
      const killers = this.killerMoves.get(depth);
      if (killers.length > 0) {
        moves = this.reorderWithKillers(moves, killers);
      }

      let bestScore = -WIN_SCORE;
      let bestCol = -1;
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
          bestCol = col;
        }

        if (score > alpha) {
          alpha = score;
        }

        if (alpha >= beta) {
          // Store killer move on cutoff
          this.killerMoves.store(depth, bestCol);
          break;
        }
      }

      // Store in transposition table
      let flag = 'exact';
      if (bestScore <= origAlpha) flag = 'upper';
      else if (bestScore >= beta) flag = 'lower';

      this.transTable.set(key, { score: bestScore, depth, flag });

      return bestScore;
    }

    reorderWithKillers(moves, killers) {
      // Move killer moves to the front
      const killerSet = new Set(killers);
      const killerMoves = [];
      const otherMoves = [];

      for (const move of moves) {
        if (killerSet.has(move.col)) {
          killerMoves.push(move);
        } else {
          otherMoves.push(move);
        }
      }

      return [...killerMoves, ...otherMoves];
    }

    evaluate() {
      // Heuristic evaluation when depth limit is reached
      // Count potential winning positions for both players

      const myWinPos = this.engine.countWinningPositions(this.engine.position);
      const oppPos = this.engine.position ^ this.engine.mask;
      const oppWinPos = this.engine.countWinningPositions(oppPos);

      // Normalize to a small score range
      const score = (myWinPos - oppWinPos) * 0.1;

      // Add positional bonus for center control
      let centerBonus = 0;
      const centerMask = this.engine.columnMask(3);
      const myCenter = this.engine.position & centerMask;
      const oppCenter = oppPos & centerMask;

      // Count bits in center column
      let temp = myCenter;
      while (temp !== 0n) {
        temp &= temp - 1n;
        centerBonus += 0.05;
      }
      temp = oppCenter;
      while (temp !== 0n) {
        temp &= temp - 1n;
        centerBonus -= 0.05;
      }

      return score + centerBonus;
    }
  }

  // ============================================================================
  // SHARED INSTANCES
  // ============================================================================
  const transpositionTable = new TranspositionTable();
  const extremeSolver = new ExtremeSolver();
  const killerMoves = new KillerMoves();

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
        return -this.game.score;
      } else if (computerPoints === 4) {
        if (populateWinners) {
          this.game.winners = this.game.winningArrayCpu;
        }
        return this.game.score;
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
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          verticalPoints = verticalPoints + score;
        }
      }
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let column = 0; column < BOARD_COLS - 3; column++) {
          const score = this.scoreBoard(row, column, 0, 1, populateWinners);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          horizontalPoints = horizontalPoints + score;
        }
      }
      for (let row = 0; row < BOARD_ROWS - 3; row++) {
        for (let column = 0; column < BOARD_COLS - 3; column++) {
          const score = this.scoreBoard(row, column, 1, 1, populateWinners);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          diagonalPoints1 = diagonalPoints1 + score;
        }
      }
      for (let row = 3; row < BOARD_ROWS; row++) {
        for (let column = 0; column <= BOARD_COLS - 4; column++) {
          const score = this.scoreBoard(row, column, -1, +1, populateWinners);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
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
      this.score = WIN_SCORE; // Restore this property for Board class
      this.depth = parseInt(depth, 10);
      this.isExtremeMode = this.depth === 99;
      this.round = 0;
      this.winners = [];
      this.turnsTaken = 0;
      this.board = undefined;

      // Clear transposition table and killer moves for new game
      transpositionTable.clear();
      extremeSolver.transTable.clear();
      extremeSolver.killerMoves.clear();
      killerMoves.clear();

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
      if (!GameState.gameOver) {
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
        if (!GameState.gameOver && !moveTurn) {
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
          GameState.animationMode = false;
        }
        document.getElementById(
          "td" + currentRow + inputCol
        ).className = moveTurn ? "coin cpu-coin" : "coin human-coin";
        return;
      }
      GameState.animationMode = true;
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
      if (!GameState.gameOver) {
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
          if (newBoard.evaluateScore(false) === this.score) {
            return column;
          }
        }
      }
      for (let column = 0; column < BOARD_COLS; column++) {
        const newBoard = this.board.getBoardCopy();
        if (!newBoard.columnIsFull(column)) {
          newBoard.placeInColumnForQuickMove(column, PLAYER_HUMAN);
          if (newBoard.evaluateScore(false) === -this.score) {
            return column;
          }
        }
      }
      return -1;
    }

    generateCompMoveInner() {
      let newBestMove;
      GameState.scanOrder = [...DEFAULT_SCAN_ORDER];

      for (let depth = 2; depth <= this.depth; depth++) {
        let [bestMoveAtDepth] = this.maximize(this.board, depth, ALPHA_INIT, BETA_INIT);
        newBestMove = bestMoveAtDepth;

        // Update scan order to prioritize best move found
        if (bestMoveAtDepth >= 0 && bestMoveAtDepth < BOARD_COLS) {
          GameState.scanOrder = this.generateScanOrder(bestMoveAtDepth);
        }
      }
      return newBestMove;
    }

    generateScanOrder(bestMove, depth = 0) {
      // Generate a scan order that prioritizes:
      // 1. Best move from TT (if any)
      // 2. Killer moves at this depth
      // 3. Center-first default order

      const order = [];
      const added = new Set();

      // 1. TT best move first
      if (bestMove !== null && bestMove >= 0 && bestMove < BOARD_COLS) {
        order.push(bestMove);
        added.add(bestMove);
      }

      // 2. Killer moves
      const killers = killerMoves.get(depth);
      for (const killer of killers) {
        if (!added.has(killer) && killer >= 0 && killer < BOARD_COLS) {
          order.push(killer);
          added.add(killer);
        }
      }

      // 3. Remaining columns in center-first order
      for (const col of DEFAULT_SCAN_ORDER) {
        if (!added.has(col)) {
          order.push(col);
        }
      }

      return order;
    }

    generateComputerDecision() {
      if (!GameState.gameOver) {
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

      // Use TT best move + killer moves for move ordering
      const moveOrder = this.generateScanOrder(ttResult.bestMove, depth);

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
            // Store killer move on beta cutoff
            killerMoves.store(depth, max[0]);
            // Store lower bound in TT
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

      // Use TT best move + killer moves for move ordering
      const moveOrder = this.generateScanOrder(ttResult.bestMove, depth);

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
            // Store killer move on alpha cutoff
            killerMoves.store(depth, min[0]);
            // Store upper bound in TT
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
      if (thisScore === -this.score) {
        this.gameOverHelper("You Win!");
      } else if (thisScore === this.score) {
        this.gameOverHelper("You Lose!");
      } else if (this.board.isFull()) {
        GameState.gameOver = true;
        modal("Draw!", MODAL_DURATION);
      }
      document
        .getElementsByTagName("html")[0]
        .classList.remove("progressCursor");
    }

    gameOverHelper(message) {
      document.getElementById("uiBlocker").classList.remove("block");
      GameState.gameOver = true;
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
    if (!GameState.gameOver && !GameState.animationMode) {
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
    if (!GameState.gameStarted) {
      GameState.gameStarted = true;
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
    // Prevent duplicate modals
    if (document.getElementById("modal-box")) return;

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
    // Prevent duplicate modals
    modalClose();

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
